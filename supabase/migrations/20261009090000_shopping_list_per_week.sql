-- B6 (roadmap steps 12 and 14, audit H7): each shopping list belongs to its calendar week, items are
-- updated one by one, and a list is reused while the week's dishes are the same.
-- Additive: one column, one CHECK and one index on shopping_lists, and two SECURITY INVOKER
-- functions (RLS and ownership apply as for any client write). Existing lists are not modified:
-- older lists of a week stay as history until a cleanup policy is decided.
-- Applied remotely only by Sergio (becook-preview first, then becook with explicit OK).
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '120s';

-- week_signature: canonical content the list was generated for (week, dishes, servings,
-- restrictions, ingredient source; never presented dates). Written by the client; NULL on lists
-- created before B6, which keep the previous freshness rule (generated after the last week change).
ALTER TABLE public.shopping_lists
  ADD COLUMN week_signature text;
ALTER TABLE public.shopping_lists
  ADD CONSTRAINT shopping_lists_week_signature_len_chk
  CHECK (week_signature IS NULL OR char_length(week_signature) BETWEEN 1 AND 8000);

-- The current list of a week is its most recent one (created_at, then id).
CREATE INDEX shopping_lists_week_id_created_at_idx
  ON public.shopping_lists USING btree (week_id, created_at DESC, id DESC);

-- Stores the list generated for the caller's calendar week, unless the week already has it.
-- p_items: [{name, quantity, unit, category}], 1–300 items.
-- Result: {status, list, week_version}.
--   created: a new current list (previous lists of the week are kept as history).
--   existing: the current list already has p_week_signature; nothing is written (double
--             generation, two devices, a retried save) and list is that one, with its checks.
--   week_changed: p_expected_week_version is not the week's version (the week changed while the
--                 list was being generated); nothing is written.
--   no_week: the caller has no such week; nothing is written.
-- The week row is locked: list saves and week writes of the same week run one at a time.
CREATE FUNCTION public.save_shopping_list(
  p_iso_year integer,
  p_iso_week integer,
  p_week_signature text,
  p_items jsonb,
  p_expected_week_version bigint DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
  v_user uuid := auth.uid();
  v_categories constant text[] := ARRAY['frutería','carnicería','pescadería','lácteos','despensa','congelados','otros'];
  v_week public.weeks%ROWTYPE;
  v_list public.shopping_lists%ROWTYPE;
  v_count integer;
  v_now timestamptz;
  v_status text;
BEGIN
  IF v_user IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'save_shopping_list: authentication required';
  END IF;
  IF p_week_signature IS NULL OR char_length(p_week_signature) NOT BETWEEN 1 AND 8000 THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'save_shopping_list: week signature required';
  END IF;
  IF jsonb_typeof(p_items) IS DISTINCT FROM 'array' OR jsonb_array_length(p_items) NOT BETWEEN 1 AND 300 THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'save_shopping_list: 1 to 300 items required';
  END IF;

  SELECT count(*) INTO v_count
  FROM jsonb_to_recordset(p_items) AS i(name text, quantity numeric, unit text, category text)
  WHERE char_length(btrim(coalesce(i.name, ''))) BETWEEN 1 AND 120
    AND i.quantity > 0 AND i.quantity <= 100000
    AND char_length(btrim(coalesce(i.unit, ''))) BETWEEN 1 AND 40
    AND i.category = ANY (v_categories);
  IF v_count <> jsonb_array_length(p_items) THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'save_shopping_list: invalid item';
  END IF;

  SELECT * INTO v_week FROM public.weeks
  WHERE user_id = v_user AND iso_year = p_iso_year AND iso_week = p_iso_week
  FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('status', 'no_week', 'list', NULL, 'week_version', NULL);
  END IF;
  IF p_expected_week_version IS NOT NULL AND v_week.version <> p_expected_week_version THEN
    RETURN jsonb_build_object('status', 'week_changed', 'list', NULL, 'week_version', v_week.version);
  END IF;

  SELECT * INTO v_list FROM public.shopping_lists
  WHERE week_id = v_week.id
  ORDER BY created_at DESC, id DESC
  LIMIT 1;
  IF FOUND AND v_list.week_signature IS NOT DISTINCT FROM p_week_signature THEN
    v_status := 'existing';
  ELSE
    -- clock_timestamp, not now(): a save that waited for the lock is newer than the one it waited for.
    v_now := clock_timestamp();
    INSERT INTO public.shopping_lists (week_id, generated_at, created_at, updated_at, week_signature)
    VALUES (v_week.id, v_now, v_now, v_now, p_week_signature)
    RETURNING * INTO v_list;

    INSERT INTO public.shopping_items (shopping_list_id, name, quantity, unit, category, checked)
    SELECT v_list.id, btrim(i.name), i.quantity, btrim(i.unit), i.category, false
    FROM jsonb_to_recordset(p_items) AS i(name text, quantity numeric, unit text, category text);
    v_status := 'created';
  END IF;

  RETURN jsonb_build_object(
    'status', v_status,
    'week_version', v_week.version,
    'list', jsonb_build_object(
      'id', v_list.id,
      'week_id', v_list.week_id,
      'generated_at', v_list.generated_at,
      'week_signature', v_list.week_signature,
      'items', (
        SELECT coalesce(jsonb_agg(jsonb_build_object('id', s.id, 'name', s.name, 'quantity', s.quantity,
          'unit', s.unit, 'category', s.category, 'checked', s.checked) ORDER BY s.created_at, s.id), '[]')
        FROM public.shopping_items s WHERE s.shopping_list_id = v_list.id)));
END;
$$;

-- Marks or unmarks items of one list, only if that list is still the current list of its week.
-- Setting a value (not toggling) makes a resend harmless; different items never overwrite each
-- other. Result: {status, list_id, current_list_id}.
--   applied: written (also when the items already had that value).
--   stale: a newer list replaced this one (another device regenerated it); nothing is written.
--   missing: an item is not visible to the caller or the items belong to several lists.
CREATE FUNCTION public.set_shopping_items_checked(
  p_item_ids uuid[],
  p_checked boolean
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
  v_user uuid := auth.uid();
  v_list_ids uuid[];
  v_found integer;
  v_week_id uuid;
  v_current uuid;
BEGIN
  IF v_user IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'set_shopping_items_checked: authentication required';
  END IF;
  IF p_checked IS NULL OR p_item_ids IS NULL OR cardinality(p_item_ids) NOT BETWEEN 1 AND 50
     OR array_position(p_item_ids, NULL) IS NOT NULL THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'set_shopping_items_checked: invalid items';
  END IF;

  SELECT count(*), array_agg(DISTINCT shopping_list_id) INTO v_found, v_list_ids
  FROM public.shopping_items
  WHERE id = ANY (p_item_ids);
  IF v_found <> (SELECT count(DISTINCT x) FROM unnest(p_item_ids) AS x) OR cardinality(v_list_ids) <> 1 THEN
    RETURN jsonb_build_object('status', 'missing', 'list_id', NULL, 'current_list_id', NULL);
  END IF;

  -- Shared lock on the week: waits for a list save of the same week in progress.
  SELECT w.id INTO v_week_id
  FROM public.weeks w JOIN public.shopping_lists l ON l.week_id = w.id
  WHERE l.id = v_list_ids[1]
  FOR SHARE OF w;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('status', 'missing', 'list_id', NULL, 'current_list_id', NULL);
  END IF;

  SELECT id INTO v_current FROM public.shopping_lists
  WHERE week_id = v_week_id
  ORDER BY created_at DESC, id DESC
  LIMIT 1;
  IF v_current <> v_list_ids[1] THEN
    RETURN jsonb_build_object('status', 'stale', 'list_id', v_list_ids[1], 'current_list_id', v_current);
  END IF;

  UPDATE public.shopping_items
  SET checked = p_checked
  WHERE id = ANY (p_item_ids) AND checked IS DISTINCT FROM p_checked;

  RETURN jsonb_build_object('status', 'applied', 'list_id', v_current, 'current_list_id', v_current);
END;
$$;

REVOKE ALL ON FUNCTION public.save_shopping_list(integer, integer, text, jsonb, bigint)
  FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.save_shopping_list(integer, integer, text, jsonb, bigint)
  TO authenticated;
REVOKE ALL ON FUNCTION public.set_shopping_items_checked(uuid[], boolean)
  FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.set_shopping_items_checked(uuid[], boolean)
  TO authenticated;
