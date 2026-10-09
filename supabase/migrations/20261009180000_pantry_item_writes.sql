-- B7 (roadmap step 13, audit H8 §8): the pantry is written item by item.
-- Additive: one column and one trigger on pantry_items, and three SECURITY INVOKER functions
-- (RLS and ownership apply as for any client write). Existing rows are not modified (they get
-- version 1). No unique index on the item name: production may hold duplicated items written by
-- the previous client (delete → insert); the functions avoid new duplicates instead, and the
-- client shows the rows of one item together.
-- Applied remotely only by Sergio (becook-preview first, then becook with explicit OK).
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '120s';

-- version: integer bumped by every UPDATE of the row, whatever the write path (functions below,
-- or the previous client still deployed while this rolls out).
ALTER TABLE public.pantry_items
  ADD COLUMN version bigint NOT NULL DEFAULT 1;

CREATE FUNCTION public.pantry_items_set_version()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    NEW.version := 1;
  ELSE
    NEW.version := OLD.version + 1;
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.pantry_items_set_version() FROM PUBLIC, anon, authenticated, service_role;

CREATE TRIGGER set_pantry_items_version BEFORE INSERT OR UPDATE ON public.pantry_items
  FOR EACH ROW EXECUTE FUNCTION public.pantry_items_set_version();

-- Every write below takes the same per-user transaction lock: the pantry writes of one user run
-- one at a time (two devices adding the same item end with one row).
--
-- Adds items to the caller's pantry. p_items: [{id, name, category, active}], 1–100; id is chosen
-- by the client, so sending the same request again changes nothing.
-- Result: {status: 'applied', items: [{id, result, row}]}, in the order sent:
--   created: inserted with that id.
--   duplicate: that id was already added (a retried request); row is how it is now.
--   existing: the pantry already has an item with that category and name (another device, or a
--             row of the previous client); nothing is written and row is that item.
-- The name is stored trimmed with single spaces; the match ignores case, accents and spaces.
CREATE FUNCTION public.add_pantry_items(p_items jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
  v_user uuid := auth.uid();
  v_categories constant text[] := ARRAY['básicos','especias','aceites y vinagres','salsas','conservas','congelados','otros'];
  v_profile uuid;
  v_count integer;
  v_item record;
  v_name text;
  v_row public.pantry_items%ROWTYPE;
  v_result text;
  v_results jsonb := '[]';
BEGIN
  IF v_user IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'add_pantry_items: authentication required';
  END IF;
  IF jsonb_typeof(p_items) IS DISTINCT FROM 'array' OR jsonb_array_length(p_items) NOT BETWEEN 1 AND 100 THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'add_pantry_items: 1 to 100 items required';
  END IF;

  SELECT count(*) INTO v_count
  FROM jsonb_to_recordset(p_items) AS i(id uuid, name text, category text, active boolean)
  WHERE i.id IS NOT NULL
    AND char_length(regexp_replace(btrim(coalesce(i.name, '')), '\s+', ' ', 'g')) BETWEEN 1 AND 80
    AND i.category = ANY (v_categories)
    AND i.active IS NOT NULL;
  IF v_count <> jsonb_array_length(p_items)
     OR (SELECT count(DISTINCT i.id) FROM jsonb_to_recordset(p_items) AS i(id uuid)) <> v_count THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'add_pantry_items: invalid or repeated item';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended('pantry_items:' || v_user::text, 0));

  -- The pantry links to the caller's own profile, never one sent by the client.
  SELECT id INTO v_profile FROM public.profiles
  WHERE user_id = v_user
  ORDER BY updated_at DESC
  LIMIT 1;

  FOR v_item IN
    SELECT (e.value->>'id')::uuid AS id, e.value->>'name' AS name, e.value->>'category' AS category,
      (e.value->>'active')::boolean AS active
    FROM jsonb_array_elements(p_items) WITH ORDINALITY AS e(value, ord)
    ORDER BY e.ord
  LOOP
    v_name := regexp_replace(btrim(v_item.name), '\s+', ' ', 'g');
    SELECT * INTO v_row FROM public.pantry_items WHERE id = v_item.id AND user_id = v_user;
    IF FOUND THEN
      v_result := 'duplicate';
    ELSE
      SELECT * INTO v_row FROM public.pantry_items p
      WHERE p.user_id = v_user AND p.category = v_item.category
        AND regexp_replace(normalize(lower(regexp_replace(btrim(p.name), '\s+', ' ', 'g')), NFD), '[̀-ͯ]', '', 'g')
          = regexp_replace(normalize(lower(v_name), NFD), '[̀-ͯ]', '', 'g')
      ORDER BY p.created_at, p.id
      LIMIT 1;
      IF FOUND THEN
        v_result := 'existing';
      ELSE
        INSERT INTO public.pantry_items (id, user_id, profile_id, name, category, active)
        VALUES (v_item.id, v_user, v_profile, v_name, v_item.category, v_item.active)
        RETURNING * INTO v_row;
        v_result := 'created';
      END IF;
    END IF;
    v_results := v_results || jsonb_build_array(jsonb_build_object(
      'id', v_item.id,
      'result', v_result,
      'row', jsonb_build_object('id', v_row.id, 'name', v_row.name, 'category', v_row.category,
        'active', v_row.active, 'version', v_row.version)));
  END LOOP;

  RETURN jsonb_build_object('status', 'applied', 'items', v_results);
END;
$$;

-- Marks the rows of one visible item as in the pantry or used up. p_rows: [{id, version}], 1–20
-- (an item can have several rows, written by the previous client). Setting a value (not toggling)
-- makes a resend harmless. Result: {status, rows: [{id, name, category, active, version}]}.
--   applied: written, or every row already had that value (nothing written).
--   conflict: a row changed since that version (another device); nothing is written and rows is
--             how the item is now.
--   missing: a row no longer exists (deleted elsewhere); nothing is written.
CREATE FUNCTION public.set_pantry_items_active(p_rows jsonb, p_active boolean)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
  v_user uuid := auth.uid();
  v_ids uuid[];
  v_found integer;
  v_changed integer;
  v_unchanged integer;
BEGIN
  IF v_user IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'set_pantry_items_active: authentication required';
  END IF;
  IF p_active IS NULL OR jsonb_typeof(p_rows) IS DISTINCT FROM 'array' OR jsonb_array_length(p_rows) NOT BETWEEN 1 AND 20 THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'set_pantry_items_active: 1 to 20 rows required';
  END IF;
  SELECT array_agg(DISTINCT r.id) INTO v_ids
  FROM jsonb_to_recordset(p_rows) AS r(id uuid, version bigint)
  WHERE r.id IS NOT NULL AND r.version IS NOT NULL;
  IF cardinality(v_ids) IS DISTINCT FROM jsonb_array_length(p_rows) THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'set_pantry_items_active: invalid or repeated row';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended('pantry_items:' || v_user::text, 0));

  SELECT count(*),
         count(*) FILTER (WHERE p.version <> r.version),
         count(*) FILTER (WHERE p.active = p_active)
    INTO v_found, v_changed, v_unchanged
  FROM jsonb_to_recordset(p_rows) AS r(id uuid, version bigint)
  JOIN public.pantry_items p ON p.id = r.id AND p.user_id = v_user;

  IF v_found <> cardinality(v_ids) THEN
    RETURN jsonb_build_object('status', 'missing', 'rows', '[]'::jsonb);
  END IF;
  IF v_unchanged = v_found THEN
    -- Already so (a retried request, or the same change made on another device).
    NULL;
  ELSIF v_changed > 0 THEN
    RETURN jsonb_build_object('status', 'conflict', 'rows', (
      SELECT jsonb_agg(jsonb_build_object('id', p.id, 'name', p.name, 'category', p.category,
        'active', p.active, 'version', p.version) ORDER BY p.created_at, p.id)
      FROM public.pantry_items p WHERE p.id = ANY (v_ids) AND p.user_id = v_user));
  ELSE
    UPDATE public.pantry_items
    SET active = p_active
    WHERE id = ANY (v_ids) AND user_id = v_user AND active IS DISTINCT FROM p_active;
  END IF;

  RETURN jsonb_build_object('status', 'applied', 'rows', (
    SELECT jsonb_agg(jsonb_build_object('id', p.id, 'name', p.name, 'category', p.category,
      'active', p.active, 'version', p.version) ORDER BY p.created_at, p.id)
    FROM public.pantry_items p WHERE p.id = ANY (v_ids) AND p.user_id = v_user));
END;
$$;

-- Deletes the rows of one visible item. p_rows: [{id, version}], 1–20.
-- Result: {status, rows}.
--   applied: deleted, or already gone (a retried request, or deleted on another device).
--   conflict: a row changed since that version (another device); nothing is deleted and rows is
--             how the item is now.
CREATE FUNCTION public.delete_pantry_items(p_rows jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
  v_user uuid := auth.uid();
  v_ids uuid[];
  v_changed integer;
BEGIN
  IF v_user IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'delete_pantry_items: authentication required';
  END IF;
  IF jsonb_typeof(p_rows) IS DISTINCT FROM 'array' OR jsonb_array_length(p_rows) NOT BETWEEN 1 AND 20 THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'delete_pantry_items: 1 to 20 rows required';
  END IF;
  SELECT array_agg(DISTINCT r.id) INTO v_ids
  FROM jsonb_to_recordset(p_rows) AS r(id uuid, version bigint)
  WHERE r.id IS NOT NULL AND r.version IS NOT NULL;
  IF cardinality(v_ids) IS DISTINCT FROM jsonb_array_length(p_rows) THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'delete_pantry_items: invalid or repeated row';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended('pantry_items:' || v_user::text, 0));

  SELECT count(*) INTO v_changed
  FROM jsonb_to_recordset(p_rows) AS r(id uuid, version bigint)
  JOIN public.pantry_items p ON p.id = r.id AND p.user_id = v_user
  WHERE p.version <> r.version;

  IF v_changed > 0 THEN
    RETURN jsonb_build_object('status', 'conflict', 'rows', (
      SELECT jsonb_agg(jsonb_build_object('id', p.id, 'name', p.name, 'category', p.category,
        'active', p.active, 'version', p.version) ORDER BY p.created_at, p.id)
      FROM public.pantry_items p WHERE p.id = ANY (v_ids) AND p.user_id = v_user));
  END IF;

  DELETE FROM public.pantry_items WHERE id = ANY (v_ids) AND user_id = v_user;
  RETURN jsonb_build_object('status', 'applied', 'rows', '[]'::jsonb);
END;
$$;

REVOKE ALL ON FUNCTION public.add_pantry_items(jsonb) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.add_pantry_items(jsonb) TO authenticated;
REVOKE ALL ON FUNCTION public.set_pantry_items_active(jsonb, boolean) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.set_pantry_items_active(jsonb, boolean) TO authenticated;
REVOKE ALL ON FUNCTION public.delete_pantry_items(jsonb) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.delete_pantry_items(jsonb) TO authenticated;
