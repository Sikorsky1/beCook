-- C4 (roadmap steps 19 and 20): the shopping list comes from the dish cards where there are any, and
-- a change of dishes updates the current list in place (a delta per ingredient) without losing what
-- was already bought.
-- Additive: five nullable/defaulted columns on shopping_items, two on shopping_lists, CHECKs, one
-- partial unique index, one trigger and new functions. save_shopping_list is redefined with the
-- SAME signature (CREATE OR REPLACE; it also reads the optional item_key / origins of each item and
-- accepts «al gusto» rows); set_shopping_items_checked is not modified. No existing row is modified:
-- lists made before C4 keep NULL keys and origins and are reconciled in place by the new client.
-- Applied remotely only by Sergio (becook-preview first, then becook with explicit OK).
-- The last function of this file (shopping_items_discard_unbought) is the only one that removes
-- rows; it is kept apart so that it can be applied on its own (SQL Editor).
-- One explicit transaction, so that the SET LOCAL limits below apply to every statement.
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '120s';

-- item_key: «category|normalised name|dimension» (src/lib/shopping/units.ts shoppingItemKey). One
--   active row per key and list. NULL on rows made before C4 (the client computes it).
-- origins: [{day 0-6, meal, dish (title key), kind card_reviewed|card_inferred|ai_title,
--   versionId?, quantity|null}] — which planned dishes need this item and how much each.
-- checked_quantity: how much was bought when it was marked (base units: g, ml or the row's unit).
-- needs_review: bought, but the dishes now need more than that.
-- removed_at: bought, and no dish needs it any more («Comprado, ya no hace falta»).
ALTER TABLE public.shopping_items
  ADD COLUMN item_key text,
  ADD COLUMN origins jsonb,
  ADD COLUMN checked_quantity numeric,
  ADD COLUMN needs_review boolean NOT NULL DEFAULT false,
  ADD COLUMN removed_at timestamptz;
ALTER TABLE public.shopping_items
  ADD CONSTRAINT shopping_items_item_key_len_chk
  CHECK (item_key IS NULL OR char_length(item_key) BETWEEN 1 AND 200);
ALTER TABLE public.shopping_items
  ADD CONSTRAINT shopping_items_origins_chk
  CHECK (origins IS NULL OR (jsonb_typeof(origins) = 'array' AND octet_length(origins::text) <= 16384));
ALTER TABLE public.shopping_items
  ADD CONSTRAINT shopping_items_checked_quantity_chk
  CHECK (checked_quantity IS NULL OR checked_quantity >= 0);

-- ingredient_basis: NULL = list made from dish titles only (before C4, or by the previous client);
--   'mixed-v1' = items with keys and origins (cards where there are any, AI per dish otherwise).
-- reconciled_at: last in-place update by reconcile_shopping_list.
ALTER TABLE public.shopping_lists
  ADD COLUMN ingredient_basis text,
  ADD COLUMN reconciled_at timestamptz;
ALTER TABLE public.shopping_lists
  ADD CONSTRAINT shopping_lists_ingredient_basis_chk
  CHECK (ingredient_basis IS NULL OR ingredient_basis = 'mixed-v1');

CREATE UNIQUE INDEX shopping_items_list_item_key_idx
  ON public.shopping_items USING btree (shopping_list_id, item_key)
  WHERE item_key IS NOT NULL AND removed_at IS NULL;

-- Quantity in base units, so that «1 kg» and «800 g» compare: kg/l ×1000, cl ×10, anything else as
-- is (the same item_key always has the same dimension). Same table as src/lib/shopping/units.ts.
CREATE FUNCTION public.shopping_quantity_base(p_quantity numeric, p_unit text)
RETURNS numeric
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
SET search_path = ''
AS $$
  SELECT p_quantity * CASE lower(btrim(coalesce(p_unit, '')))
    WHEN 'kg' THEN 1000 WHEN 'kilo' THEN 1000 WHEN 'kilos' THEN 1000
    WHEN 'kilogramo' THEN 1000 WHEN 'kilogramos' THEN 1000
    WHEN 'l' THEN 1000 WHEN 'litro' THEN 1000 WHEN 'litros' THEN 1000
    WHEN 'cl' THEN 10
    ELSE 1 END;
$$;

-- One shopping item as sent by a client: name 1–120, quantity 0–100000 (NULL only with the unit
-- «al gusto»), unit 1–40, a supermarket category, optional key 1–200 and optional origins (array of
-- objects, ≤ 16 KB). Same rules as the columns and as save_shopping_list before C4.
CREATE FUNCTION public.shopping_item_valid(
  p_name text,
  p_quantity numeric,
  p_unit text,
  p_category text,
  p_item_key text,
  p_origins jsonb
)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
SET search_path = ''
AS $$
  SELECT char_length(btrim(coalesce(p_name, ''))) BETWEEN 1 AND 120
    AND char_length(btrim(coalesce(p_unit, ''))) BETWEEN 1 AND 40
    AND ((p_quantity > 0 AND p_quantity <= 100000)
         OR (p_quantity IS NULL AND lower(btrim(p_unit)) = 'al gusto'))
    AND coalesce(p_category IN ('frutería', 'carnicería', 'pescadería', 'lácteos', 'despensa', 'congelados', 'otros'), false)
    AND (p_item_key IS NULL OR char_length(p_item_key) BETWEEN 1 AND 200)
    AND (p_origins IS NULL OR (
      jsonb_typeof(p_origins) = 'array'
      AND octet_length(p_origins::text) <= 16384
      AND NOT EXISTS (SELECT 1 FROM jsonb_array_elements(p_origins) AS o(origin)
                      WHERE jsonb_typeof(o.origin) IS DISTINCT FROM 'object')));
$$;

-- Marking or unmarking (any client, including set_shopping_items_checked of the deployed client):
-- a mark records how much was bought, and any change of the mark settles a pending review.
CREATE FUNCTION public.shopping_items_check_state()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  IF NEW.checked IS DISTINCT FROM OLD.checked THEN
    NEW.needs_review := false;
    NEW.checked_quantity := CASE WHEN NEW.checked THEN public.shopping_quantity_base(NEW.quantity, NEW.unit) END;
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.shopping_items_check_state() FROM PUBLIC, anon, authenticated, service_role;

CREATE TRIGGER shopping_items_check_state BEFORE UPDATE OF checked ON public.shopping_items
  FOR EACH ROW EXECUTE FUNCTION public.shopping_items_check_state();

-- A list and its items as the clients read it (RLS applies: SECURITY INVOKER).
CREATE FUNCTION public.shopping_list_json(p_list_id uuid)
RETURNS jsonb
LANGUAGE sql
STABLE
SET search_path = ''
AS $$
  SELECT jsonb_build_object(
    'id', l.id,
    'week_id', l.week_id,
    'generated_at', l.generated_at,
    'week_signature', l.week_signature,
    'ingredient_basis', l.ingredient_basis,
    'reconciled_at', l.reconciled_at,
    'items', (
      SELECT coalesce(jsonb_agg(jsonb_build_object('id', s.id, 'name', s.name, 'quantity', s.quantity,
        'unit', s.unit, 'category', s.category, 'checked', s.checked, 'item_key', s.item_key,
        'origins', s.origins, 'checked_quantity', s.checked_quantity, 'needs_review', s.needs_review,
        'removed_at', s.removed_at) ORDER BY s.created_at, s.id), '[]')
      FROM public.shopping_items s WHERE s.shopping_list_id = l.id))
  FROM public.shopping_lists l
  WHERE l.id = p_list_id;
$$;

-- Same signature and results as B6 (20261009090000_shopping_list_per_week). Changes: each item may
-- carry item_key and origins (absent for the deployed client), a quantity may be NULL with the unit
-- «al gusto», and the list records its ingredient basis ('mixed-v1' when every item has a key).
CREATE OR REPLACE FUNCTION public.save_shopping_list(
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
  v_week public.weeks%ROWTYPE;
  v_list public.shopping_lists%ROWTYPE;
  v_count integer;
  v_keys integer;
  v_keyed integer;
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

  SELECT count(*) FILTER (WHERE public.shopping_item_valid(i.name, i.quantity, i.unit, i.category, i.item_key, i.origins)),
         count(DISTINCT i.item_key), count(i.item_key)
  INTO v_count, v_keys, v_keyed
  FROM jsonb_to_recordset(p_items) AS i(name text, quantity numeric, unit text, category text, item_key text, origins jsonb);
  IF v_count <> jsonb_array_length(p_items) THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'save_shopping_list: invalid item';
  END IF;
  IF v_keys <> v_keyed THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'save_shopping_list: duplicate item key';
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
    INSERT INTO public.shopping_lists (week_id, generated_at, created_at, updated_at, week_signature, ingredient_basis)
    VALUES (v_week.id, v_now, v_now, v_now, p_week_signature,
      CASE WHEN v_keyed = jsonb_array_length(p_items) THEN 'mixed-v1' END)
    RETURNING * INTO v_list;

    INSERT INTO public.shopping_items (shopping_list_id, name, quantity, unit, category, checked, item_key, origins)
    SELECT v_list.id, btrim(i.name), i.quantity, btrim(i.unit), i.category, false, i.item_key, i.origins
    FROM jsonb_to_recordset(p_items) AS i(name text, quantity numeric, unit text, category text, item_key text, origins jsonb);
    v_status := 'created';
  END IF;

  RETURN jsonb_build_object(
    'status', v_status,
    'week_version', v_week.version,
    'list', public.shopping_list_json(v_list.id));
END;
$$;

-- Updates the current list of the caller's week in place: the delta between what it has and what
-- the dishes need now, computed by the client (src/lib/shopping/reconcile.ts) by item_key.
-- p_ops: {add: [{name, quantity, unit, category, item_key, origins}] (≤ 300, unmarked),
--         update: [{id, name, quantity, unit, category, item_key, origins}] (≤ 300),
--         remove: [{id}] (≤ 300)}.
--   update of a marked item: stays marked; if it now needs more than what was bought
--     (checked_quantity, else its quantity before), needs_review. A review only clears when the item
--     is marked or unmarked again. An update also brings back an item bought and no longer needed.
--   remove of an unmarked item: it goes (shopping_items_discard_unbought); of a marked one:
--     removed_at («Comprado, ya no hace falta»).
-- The list keeps its id and created_at; week_signature becomes p_to_signature, ingredient_basis
-- 'mixed-v1' and reconciled_at now. p_from_signature = p_to_signature is allowed (dishes computed
-- later, e.g. «Calcular (IA)»).
-- Result: {status, week_version, list, current_list_id, summary}.
--   applied: written; summary {added, removed, keptBought, changed, review}.
--   existing: the list already has p_to_signature (another device did it); nothing is written.
--   stale: the list is not the week's current list, its signature is not p_from_signature, or an
--          item of p_ops is not in it; nothing is written (the client reads the list again).
--   week_changed: p_expected_week_version is not the week's version; nothing is written.
--   no_week: the caller has no such week; nothing is written.
-- The week row is locked (FOR UPDATE), like save_shopping_list and apply_week; marks
-- (set_shopping_items_checked, FOR SHARE) wait for it.
CREATE FUNCTION public.reconcile_shopping_list(
  p_iso_year integer,
  p_iso_week integer,
  p_list_id uuid,
  p_from_signature text,
  p_to_signature text,
  p_ops jsonb,
  p_expected_week_version bigint DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
  v_user uuid := auth.uid();
  v_week public.weeks%ROWTYPE;
  v_list public.shopping_lists%ROWTYPE;
  v_item public.shopping_items%ROWTYPE;
  v_op record;
  v_add jsonb := coalesce(p_ops -> 'add', '[]'::jsonb);
  v_update jsonb := coalesce(p_ops -> 'update', '[]'::jsonb);
  v_remove jsonb := coalesce(p_ops -> 'remove', '[]'::jsonb);
  v_ids uuid[];
  v_remove_ids uuid[];
  v_count integer;
  v_keys integer;
  v_now timestamptz;
  v_bought numeric;
  v_review boolean;
  v_added integer := 0;
  v_removed integer := 0;
  v_kept integer := 0;
  v_changed integer := 0;
  v_reviews integer := 0;
BEGIN
  IF v_user IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'reconcile_shopping_list: authentication required';
  END IF;
  IF p_list_id IS NULL OR p_to_signature IS NULL OR char_length(p_to_signature) NOT BETWEEN 1 AND 8000
     OR (p_from_signature IS NOT NULL AND char_length(p_from_signature) NOT BETWEEN 1 AND 8000) THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'reconcile_shopping_list: list and signatures required';
  END IF;
  IF jsonb_typeof(p_ops) IS DISTINCT FROM 'object'
     OR jsonb_typeof(v_add) IS DISTINCT FROM 'array' OR jsonb_array_length(v_add) > 300
     OR jsonb_typeof(v_update) IS DISTINCT FROM 'array' OR jsonb_array_length(v_update) > 300
     OR jsonb_typeof(v_remove) IS DISTINCT FROM 'array' OR jsonb_array_length(v_remove) > 300 THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'reconcile_shopping_list: invalid operations';
  END IF;

  -- Every added or updated item is valid and has a key; keys and ids are not repeated.
  SELECT count(*) INTO v_count
  FROM jsonb_to_recordset(v_add || v_update) AS i(name text, quantity numeric, unit text, category text, item_key text, origins jsonb)
  WHERE i.item_key IS NOT NULL AND public.shopping_item_valid(i.name, i.quantity, i.unit, i.category, i.item_key, i.origins);
  SELECT count(DISTINCT i.item_key) INTO v_keys
  FROM jsonb_to_recordset(v_add || v_update) AS i(item_key text);
  IF v_count <> jsonb_array_length(v_add) + jsonb_array_length(v_update)
     OR v_keys <> jsonb_array_length(v_add) + jsonb_array_length(v_update) THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'reconcile_shopping_list: invalid item';
  END IF;
  SELECT array_agg(o.id) INTO v_ids FROM jsonb_to_recordset(v_update || v_remove) AS o(id uuid);
  SELECT array_agg(o.id) INTO v_remove_ids FROM jsonb_to_recordset(v_remove) AS o(id uuid);
  IF array_position(v_ids, NULL) IS NOT NULL
     OR cardinality(v_ids) <> (SELECT count(DISTINCT x) FROM unnest(v_ids) AS x) THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'reconcile_shopping_list: invalid item ids';
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
  IF NOT FOUND OR v_list.id <> p_list_id THEN
    RETURN jsonb_build_object('status', 'stale', 'list', NULL, 'week_version', v_week.version,
      'current_list_id', v_list.id);
  END IF;
  IF p_from_signature IS DISTINCT FROM p_to_signature AND v_list.week_signature IS NOT DISTINCT FROM p_to_signature THEN
    RETURN jsonb_build_object('status', 'existing', 'week_version', v_week.version,
      'list', public.shopping_list_json(v_list.id), 'current_list_id', v_list.id);
  END IF;
  IF v_list.week_signature IS DISTINCT FROM p_from_signature
     OR coalesce(cardinality(v_ids), 0) <> (SELECT count(*) FROM public.shopping_items
                                           WHERE shopping_list_id = v_list.id AND id = ANY (v_ids)) THEN
    RETURN jsonb_build_object('status', 'stale', 'list', NULL, 'week_version', v_week.version,
      'current_list_id', v_list.id);
  END IF;

  v_now := clock_timestamp();

  -- Removes: a bought item stays, marked as no longer needed; an unbought one goes.
  IF v_remove_ids IS NOT NULL THEN
    UPDATE public.shopping_items
    SET removed_at = v_now, needs_review = false, updated_at = v_now
    WHERE shopping_list_id = v_list.id AND id = ANY (v_remove_ids) AND checked AND removed_at IS NULL;
    GET DIAGNOSTICS v_kept = ROW_COUNT;
    v_removed := public.shopping_items_discard_unbought(v_list.id, v_remove_ids);
  END IF;

  -- Updates, one by one: a marked item that now needs more than what was bought is to review.
  FOR v_op IN
    SELECT * FROM jsonb_to_recordset(v_update)
      AS u(id uuid, name text, quantity numeric, unit text, category text, item_key text, origins jsonb)
  LOOP
    SELECT * INTO v_item FROM public.shopping_items WHERE id = v_op.id;
    v_review := false;
    IF v_item.checked THEN
      v_review := v_item.needs_review;
      IF v_op.quantity IS NOT NULL THEN
        v_bought := coalesce(v_item.checked_quantity, public.shopping_quantity_base(v_item.quantity, v_item.unit));
        IF v_bought IS NULL OR public.shopping_quantity_base(v_op.quantity, v_op.unit) > v_bought THEN
          v_review := true;
        END IF;
      END IF;
    END IF;
    IF v_review AND NOT v_item.needs_review THEN
      v_reviews := v_reviews + 1;
    END IF;
    IF v_item.quantity IS DISTINCT FROM v_op.quantity OR v_item.unit IS DISTINCT FROM btrim(v_op.unit)
       OR v_item.name IS DISTINCT FROM btrim(v_op.name) OR v_item.removed_at IS NOT NULL THEN
      v_changed := v_changed + 1;
    END IF;
    UPDATE public.shopping_items
    SET name = btrim(v_op.name), quantity = v_op.quantity, unit = btrim(v_op.unit), category = v_op.category,
        item_key = v_op.item_key, origins = v_op.origins, removed_at = NULL, needs_review = v_review,
        updated_at = v_now
    WHERE id = v_op.id;
  END LOOP;

  INSERT INTO public.shopping_items (shopping_list_id, name, quantity, unit, category, checked, item_key, origins,
    created_at, updated_at)
  SELECT v_list.id, btrim(i.name), i.quantity, btrim(i.unit), i.category, false, i.item_key, i.origins, v_now, v_now
  FROM jsonb_to_recordset(v_add) AS i(name text, quantity numeric, unit text, category text, item_key text, origins jsonb);
  GET DIAGNOSTICS v_added = ROW_COUNT;

  UPDATE public.shopping_lists
  SET week_signature = p_to_signature, ingredient_basis = 'mixed-v1', reconciled_at = v_now, updated_at = v_now
  WHERE id = v_list.id;

  RETURN jsonb_build_object(
    'status', 'applied',
    'week_version', v_week.version,
    'current_list_id', v_list.id,
    'list', public.shopping_list_json(v_list.id),
    'summary', jsonb_build_object('added', v_added, 'removed', v_removed, 'keptBought', v_kept,
      'changed', v_changed, 'review', v_reviews));
END;
$$;

REVOKE ALL ON FUNCTION public.shopping_quantity_base(numeric, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.shopping_quantity_base(numeric, text) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.shopping_item_valid(text, numeric, text, text, text, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.shopping_item_valid(text, numeric, text, text, text, jsonb) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.shopping_list_json(uuid) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.shopping_list_json(uuid) TO authenticated;
REVOKE ALL ON FUNCTION public.reconcile_shopping_list(integer, integer, uuid, text, text, jsonb, bigint)
  FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.reconcile_shopping_list(integer, integer, uuid, text, text, jsonb, bigint)
  TO authenticated;

-- ---------------------------------------------------------------------------------------------
-- Separate part: the only function of this migration that removes rows. Called by
-- reconcile_shopping_list for items of the list that are not marked (a marked item is never
-- removed: it stays as «Comprado, ya no hace falta»). SECURITY INVOKER: RLS applies exactly as for
-- a direct client write (shopping_items_delete_own). Returns how many rows went.
CREATE FUNCTION public.shopping_items_discard_unbought(p_list_id uuid, p_item_ids uuid[])
RETURNS integer
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
  v_count integer;
BEGIN
  DELETE FROM public.shopping_items
  WHERE shopping_list_id = p_list_id AND id = ANY (p_item_ids) AND NOT checked;
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$$;
REVOKE ALL ON FUNCTION public.shopping_items_discard_unbought(uuid, uuid[]) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.shopping_items_discard_unbought(uuid, uuid[]) TO authenticated;

COMMIT;
