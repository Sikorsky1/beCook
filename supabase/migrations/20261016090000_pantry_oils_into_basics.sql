-- The pantry no longer has the section «Aceites y vinagres»: its items move to «Básicos».
-- 1. add_pantry_items still accepts 'aceites y vinagres' (a client deployed before this change, or
--    a device copy saved with it) but stores and matches it as 'básicos'. Same signature, same
--    SECURITY INVOKER and grants (CREATE OR REPLACE keeps them); only the category of each item read
--    from p_items changes.
-- 2. Rows saved with 'aceites y vinagres' move to 'básicos' (UPDATE; the version trigger bumps their
--    version, so a device with a change based on the old version gets a conflict and re-reads).
--    If the same item already exists in 'básicos', both rows stay and the client shows them as one
--    item (rows of one item are grouped by category and name, B7).
-- No column, constraint, policy or grant changes and no row is deleted.
-- Hosted (connector apply_migration): remove ONLY the BEGIN; and COMMIT; lines and keep the two
-- SET LOCAL lines. In production, copy the affected rows to backup_20261012 first (PROGRESS.md).
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '120s';

CREATE OR REPLACE FUNCTION public.add_pantry_items(p_items jsonb)
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
    SELECT (e.value->>'id')::uuid AS id, e.value->>'name' AS name,
      CASE WHEN e.value->>'category' = 'aceites y vinagres' THEN 'básicos' ELSE e.value->>'category' END AS category,
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

UPDATE public.pantry_items SET category = 'básicos' WHERE category = 'aceites y vinagres';

COMMIT;
