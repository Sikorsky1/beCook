-- D5 (roadmap steps 30 and 31): the user can add items by hand to the week's list and change
-- quantities, and a reconciliation of the dishes never removes or changes what the user added.
-- Convention (no new columns): an item added by hand has item_key 'manual|<normalised name>' and
-- origins [{"kind":"manual","quantity":…}]; a quantity adjusted on an item of the dishes keeps its
-- dish origins plus {"kind":"user_adjust","quantity":…} (the client keeps it while those dishes
-- stay the same).
-- Additive: one trigger with its function and one new function. No existing function is redefined
-- and no existing row is modified (no row has a 'manual|' key before this migration).
-- edit_shopping_items is the only function that removes rows here (DELETE of items added by hand,
-- with the transaction-local permission becook.shopping_edit); it is SECURITY INVOKER (RLS applies).
-- Applied remotely only by Sergio (becook-preview first, then becook with explicit OK); see
-- PROGRESS.md (D5, «Aplicación remota») for the remote procedure: with the Supabase connector only
-- BEGIN and COMMIT are removed (it opens its own transaction); the SET LOCAL lines stay.
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '120s';

-- Items added by hand are the user's: no client path other than edit_shopping_items may remove them
-- or change what they are. In particular the deployed C4 client, whose reconciliation asks to
-- remove every row the dishes do not need, cannot take them away: those removals are skipped
-- silently (its answer stays valid; the row simply stays).
--   DELETE: skipped, unless edit_shopping_items set becook.shopping_edit, or the row goes with its
--     list, week or owner (cascade: trigger depth > 1, as recipe_versions_guard in C2).
--   UPDATE: skipped unless only the mark changes (checked, checked_quantity, needs_review and
--     updated_at, as set_shopping_items_checked and the trigger shopping_items_check_state write),
--     or becook.shopping_edit is set.
CREATE FUNCTION public.shopping_items_guard_manual()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  IF OLD.item_key IS NULL OR OLD.item_key NOT LIKE 'manual|%'
     OR coalesce(current_setting('becook.shopping_edit', true), '') = 'on' THEN
    RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
  END IF;
  IF TG_OP = 'DELETE' THEN
    IF pg_trigger_depth() > 1 THEN
      RETURN OLD;
    END IF;
    RETURN NULL;
  END IF;
  IF (to_jsonb(NEW) - ARRAY['checked', 'checked_quantity', 'needs_review', 'updated_at'])
     = (to_jsonb(OLD) - ARRAY['checked', 'checked_quantity', 'needs_review', 'updated_at']) THEN
    RETURN NEW;
  END IF;
  RETURN NULL;
END;
$$;
REVOKE ALL ON FUNCTION public.shopping_items_guard_manual() FROM PUBLIC, anon, authenticated, service_role;

CREATE TRIGGER shopping_items_guard_manual BEFORE UPDATE OR DELETE ON public.shopping_items
  FOR EACH ROW EXECUTE FUNCTION public.shopping_items_guard_manual();

-- The user's edits of the current list of the caller's week.
-- p_ops: {add: [{id, name, quantity, unit, category, item_key}] (≤ 50),
--         set_quantity: [{id, quantity, unit, origins}] (≤ 50),
--         remove: [{id}] (≤ 50)}; ids are not repeated within a kind.
--   add: an item added by hand, with an id chosen by the client and item_key 'manual|…'; stored
--     with origins [{"kind":"manual","quantity":…}], unmarked. Result per item:
--     created · duplicate (that id already exists: a resend) · existing (the list already has an
--     active row with that key; nothing written).
--   set_quantity: any active row of the list. An item added by hand takes the quantity and unit and
--     origins [{"kind":"manual","quantity":…}]; an item of the dishes keeps its unit (and so its
--     key) and takes the quantity and the given origins. Marks are not changed.
--     Result: applied · missing (not an active row of this list).
--   remove: items added by hand only. Result: applied · missing · not_manual (nothing written).
--   Applied in this order: add, set_quantity, remove (an add and a remove of the same id in one call
--   leave nothing).
-- Never changes the list's week_signature, ingredient_basis or reconciled_at.
-- Result: {status, list, results: [{id, result}], current_list_id}.
--   applied: something was written · duplicate / existing: nothing to write (a resend, or the item
--     is already there) · stale: p_list_id is not the week's current list; nothing written ·
--   no_week: the caller has no such week.
-- The week row is locked FOR SHARE (like set_shopping_items_checked): waits for a list save or a
-- reconciliation of the same week (FOR UPDATE) in progress.
CREATE FUNCTION public.edit_shopping_items(
  p_iso_year integer,
  p_iso_week integer,
  p_list_id uuid,
  p_ops jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
  v_user uuid := auth.uid();
  v_add jsonb := coalesce(p_ops -> 'add', '[]'::jsonb);
  v_set jsonb := coalesce(p_ops -> 'set_quantity', '[]'::jsonb);
  v_remove jsonb := coalesce(p_ops -> 'remove', '[]'::jsonb);
  v_week_id uuid;
  v_current uuid;
  v_op record;
  v_row public.shopping_items%ROWTYPE;
  v_results jsonb := '[]';
  v_result text;
  v_wrote boolean := false;
  v_existing boolean := false;
  v_now timestamptz;
BEGIN
  IF v_user IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'edit_shopping_items: authentication required';
  END IF;
  IF p_list_id IS NULL OR jsonb_typeof(p_ops) IS DISTINCT FROM 'object'
     OR jsonb_typeof(v_add) IS DISTINCT FROM 'array' OR jsonb_array_length(v_add) > 50
     OR jsonb_typeof(v_set) IS DISTINCT FROM 'array' OR jsonb_array_length(v_set) > 50
     OR jsonb_typeof(v_remove) IS DISTINCT FROM 'array' OR jsonb_array_length(v_remove) > 50
     OR jsonb_array_length(v_add) + jsonb_array_length(v_set) + jsonb_array_length(v_remove) = 0 THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'edit_shopping_items: invalid operations';
  END IF;

  -- Adds: valid items with an id and a manual key; ids and keys not repeated.
  IF (SELECT count(*) FROM jsonb_to_recordset(v_add)
        AS i(id uuid, name text, quantity numeric, unit text, category text, item_key text)
      WHERE i.id IS NOT NULL AND i.item_key LIKE 'manual|%'
        AND public.shopping_item_valid(i.name, i.quantity, i.unit, i.category, i.item_key,
          jsonb_build_array(jsonb_build_object('kind', 'manual', 'quantity', i.quantity)))) <> jsonb_array_length(v_add)
     OR (SELECT count(DISTINCT i.id) FROM jsonb_to_recordset(v_add) AS i(id uuid)) <> jsonb_array_length(v_add)
     OR (SELECT count(DISTINCT i.item_key) FROM jsonb_to_recordset(v_add) AS i(item_key text)) <> jsonb_array_length(v_add) THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'edit_shopping_items: invalid item';
  END IF;
  -- Quantities: an amount (or NULL only with «al gusto»), a unit and origins as array of objects.
  IF (SELECT count(*) FROM jsonb_to_recordset(v_set) AS i(id uuid, quantity numeric, unit text, origins jsonb)
      WHERE i.id IS NOT NULL
        AND public.shopping_item_valid('x', i.quantity, i.unit, 'otros', NULL, coalesce(i.origins, '[]'::jsonb))) <> jsonb_array_length(v_set)
     OR (SELECT count(DISTINCT i.id) FROM jsonb_to_recordset(v_set) AS i(id uuid)) <> jsonb_array_length(v_set)
     OR (SELECT count(*) FROM jsonb_to_recordset(v_remove) AS i(id uuid) WHERE i.id IS NOT NULL) <> jsonb_array_length(v_remove)
     OR (SELECT count(DISTINCT i.id) FROM jsonb_to_recordset(v_remove) AS i(id uuid)) <> jsonb_array_length(v_remove) THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'edit_shopping_items: invalid item';
  END IF;

  SELECT id INTO v_week_id FROM public.weeks
  WHERE user_id = v_user AND iso_year = p_iso_year AND iso_week = p_iso_week
  FOR SHARE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('status', 'no_week', 'list', NULL, 'current_list_id', NULL);
  END IF;
  SELECT id INTO v_current FROM public.shopping_lists
  WHERE week_id = v_week_id
  ORDER BY created_at DESC, id DESC
  LIMIT 1;
  IF v_current IS DISTINCT FROM p_list_id THEN
    RETURN jsonb_build_object('status', 'stale', 'list', NULL, 'current_list_id', v_current);
  END IF;

  v_now := clock_timestamp();
  -- The permission of the guard, for the writes of this function only.
  PERFORM set_config('becook.shopping_edit', 'on', true);

  FOR v_op IN
    SELECT * FROM jsonb_to_recordset(v_add)
      AS i(id uuid, name text, quantity numeric, unit text, category text, item_key text)
  LOOP
    IF EXISTS (SELECT 1 FROM public.shopping_items WHERE id = v_op.id) THEN
      v_result := 'duplicate';
    ELSIF EXISTS (SELECT 1 FROM public.shopping_items
                  WHERE shopping_list_id = p_list_id AND item_key = v_op.item_key AND removed_at IS NULL) THEN
      v_result := 'existing';
      v_existing := true;
    ELSE
      BEGIN
        INSERT INTO public.shopping_items (id, shopping_list_id, name, quantity, unit, category, checked, item_key,
          origins, created_at, updated_at)
        VALUES (v_op.id, p_list_id, btrim(v_op.name), v_op.quantity, btrim(v_op.unit), v_op.category, false,
          v_op.item_key, jsonb_build_array(jsonb_build_object('kind', 'manual', 'quantity', v_op.quantity)), v_now, v_now);
        v_result := 'created';
        v_wrote := true;
      EXCEPTION WHEN unique_violation THEN
        -- Two devices adding the same item at once: one row, the other answer is «existing».
        v_result := 'existing';
        v_existing := true;
      END;
    END IF;
    v_results := v_results || jsonb_build_array(jsonb_build_object('id', v_op.id, 'result', v_result));
  END LOOP;

  FOR v_op IN
    SELECT * FROM jsonb_to_recordset(v_set) AS i(id uuid, quantity numeric, unit text, origins jsonb)
  LOOP
    SELECT * INTO v_row FROM public.shopping_items
    WHERE id = v_op.id AND shopping_list_id = p_list_id AND removed_at IS NULL;
    IF NOT FOUND THEN
      v_result := 'missing';
    ELSIF v_row.item_key LIKE 'manual|%' THEN
      UPDATE public.shopping_items
      SET quantity = v_op.quantity, unit = btrim(v_op.unit),
          origins = jsonb_build_array(jsonb_build_object('kind', 'manual', 'quantity', v_op.quantity)), updated_at = v_now
      WHERE id = v_row.id;
      v_result := 'applied';
      v_wrote := true;
    ELSIF NOT public.shopping_item_valid(v_row.name, v_op.quantity, v_row.unit, v_row.category, v_row.item_key, v_op.origins) THEN
      RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'edit_shopping_items: invalid quantity';
    ELSE
      UPDATE public.shopping_items
      SET quantity = v_op.quantity, origins = v_op.origins, updated_at = v_now
      WHERE id = v_row.id;
      v_result := 'applied';
      v_wrote := true;
    END IF;
    v_results := v_results || jsonb_build_array(jsonb_build_object('id', v_op.id, 'result', v_result));
  END LOOP;

  FOR v_op IN SELECT * FROM jsonb_to_recordset(v_remove) AS i(id uuid)
  LOOP
    SELECT * INTO v_row FROM public.shopping_items WHERE id = v_op.id AND shopping_list_id = p_list_id;
    IF NOT FOUND THEN
      v_result := 'missing';
    ELSIF v_row.item_key IS NULL OR v_row.item_key NOT LIKE 'manual|%' THEN
      v_result := 'not_manual';
    ELSE
      DELETE FROM public.shopping_items WHERE id = v_row.id;
      v_result := 'applied';
      v_wrote := true;
    END IF;
    v_results := v_results || jsonb_build_array(jsonb_build_object('id', v_op.id, 'result', v_result));
  END LOOP;

  PERFORM set_config('becook.shopping_edit', '', true);

  RETURN jsonb_build_object(
    'status', CASE WHEN v_wrote THEN 'applied' WHEN v_existing THEN 'existing' ELSE 'duplicate' END,
    'list', public.shopping_list_json(p_list_id),
    'results', v_results,
    'current_list_id', v_current);
END;
$$;

REVOKE ALL ON FUNCTION public.edit_shopping_items(integer, integer, uuid, jsonb) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.edit_shopping_items(integer, integer, uuid, jsonb) TO authenticated;

COMMIT;
