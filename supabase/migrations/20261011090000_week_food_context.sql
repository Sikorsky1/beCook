-- C1 (roadmap step 16, audit H6): the food context of each week, frozen when its menu is applied.
-- Additive: one table, four functions. Weeks, days, profiles and apply_week / update_week_slot are
-- not modified (no row is changed; existing weeks simply have no frozen context).
-- Applied remotely only by Sergio (becook-preview first, then becook with explicit OK).
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '120s';

-- Canonical restrictions and preferences of a profile that a menu and its shopping depend on.
-- Order, case, spacing and 'none' do not change it; version = 'fc1:' + md5 of the canonical JSON.
-- disliked_foods: canonical text «pollo, brócoli» (B2), or the older JSON / array literal forms.
CREATE FUNCTION public.food_context_restrictions(
  p_dietary_restrictions text[],
  p_allergies text[],
  p_other_allergies text,
  p_disliked_foods text
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SET search_path = ''
AS $$
DECLARE
  v_text text := btrim(coalesce(p_disliked_foods, ''));
  v_foods text[];
BEGIN
  BEGIN
    IF v_text LIKE '[%' THEN
      v_foods := ARRAY(SELECT jsonb_array_elements_text(v_text::jsonb));
    ELSIF v_text LIKE '{%' THEN
      v_foods := v_text::text[];
    END IF;
  EXCEPTION WHEN others THEN
    v_foods := NULL;
  END;
  IF v_foods IS NULL THEN
    v_foods := regexp_split_to_array(v_text, '[,;\n]');
  END IF;

  RETURN jsonb_build_object(
    'dietaryRestrictions', coalesce((
      SELECT jsonb_agg(DISTINCT r ORDER BY r) FROM unnest(p_dietary_restrictions) AS r
      WHERE r IS NOT NULL AND r <> 'none'), '[]'::jsonb),
    'allergies', coalesce((
      SELECT jsonb_agg(DISTINCT a ORDER BY a) FROM unnest(p_allergies) AS a WHERE a IS NOT NULL), '[]'::jsonb),
    'otherAllergies', regexp_replace(btrim(coalesce(p_other_allergies, '')), '\s+', ' ', 'g'),
    'dislikedFoods', coalesce((
      SELECT jsonb_agg(DISTINCT f ORDER BY f)
      FROM (SELECT lower(regexp_replace(btrim(food), '\s+', ' ', 'g')) AS f FROM unnest(v_foods) AS food) AS cleaned
      WHERE f IS NOT NULL AND f <> ''), '[]'::jsonb)
  );
END;
$$;

CREATE FUNCTION public.food_context_version(p_restrictions jsonb)
RETURNS text
LANGUAGE sql
IMMUTABLE
SET search_path = ''
AS $$
  SELECT CASE WHEN p_restrictions IS NULL THEN 'fc1:none' ELSE 'fc1:' || md5(p_restrictions::text) END;
$$;

-- One row per week, written only by freeze_week_food_context (no client grants to write).
--   servings: people the menu was planned for (the generation request's choice; otherwise the
--             profile's household; otherwise 2).
--   household_size / restrictions / profile_updated_at: the caller's profile when frozen
--             (NULL restrictions: there was no profile, nothing is known about allergies).
--   request_key: the apply_week request this context belongs to (a repeated freeze is a no-op).
CREATE TABLE public.week_food_contexts (
  week_id uuid PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  servings smallint NOT NULL CHECK (servings BETWEEN 1 AND 10),
  servings_source text NOT NULL CHECK (servings_source IN ('generation', 'profile', 'default')),
  household_size smallint CHECK (household_size BETWEEN 1 AND 10),
  restrictions jsonb CHECK (restrictions IS NULL OR jsonb_typeof(restrictions) = 'object'),
  context_version text NOT NULL CHECK (char_length(context_version) <= 40),
  profile_updated_at timestamptz,
  request_key uuid NOT NULL,
  frozen_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT week_food_contexts_week_owner_fkey FOREIGN KEY (week_id, user_id)
    REFERENCES public.weeks(id, user_id) ON DELETE CASCADE
);
CREATE INDEX week_food_contexts_user_id_idx ON public.week_food_contexts (user_id);

ALTER TABLE public.week_food_contexts ENABLE ROW LEVEL SECURITY;
CREATE POLICY week_food_contexts_select_own ON public.week_food_contexts
  FOR SELECT TO authenticated USING (user_id = (SELECT auth.uid()));
REVOKE ALL ON TABLE public.week_food_contexts FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.week_food_contexts TO authenticated;

-- The caller's current context from their saved profile (server side: never from the browser).
-- {found: false} without a profile.
CREATE FUNCTION public.current_food_context()
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = ''
AS $$
  SELECT coalesce((
    SELECT jsonb_build_object(
      'found', true,
      'householdSize', p.household_size,
      'restrictions', r.restrictions,
      'version', public.food_context_version(r.restrictions),
      'preferences', jsonb_build_object(
        'goals', to_jsonb(p.goals),
        'otherGoal', coalesce(p.other_goal, ''),
        'weeklyTrainingDays', p.weekly_training_days,
        'trainingTypes', to_jsonb(p.training_types)),
      'updatedAt', p.updated_at)
    FROM public.profiles AS p
    CROSS JOIN LATERAL (SELECT public.food_context_restrictions(
      p.dietary_restrictions, p.allergies, p.other_allergies, p.disliked_foods) AS restrictions) AS r
    WHERE p.user_id = (SELECT auth.uid())
    LIMIT 1
  ), jsonb_build_object('found', false));
$$;

-- Freezes the context of the caller's week right after apply_week wrote p_request_key to it.
-- Never bumps weeks.version (the week row is only locked). Result:
--   frozen | duplicate (this request was already frozen) | superseded (a newer apply of this week
--   is already frozen) | not_applied (the key is not one of the week's writes, or no such week). Servings come from p_generation_request_id only if
--   that request is the caller's and was applied to this week.
CREATE FUNCTION public.freeze_week_food_context(
  p_iso_year integer,
  p_iso_week integer,
  p_request_key uuid,
  p_generation_request_id uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_user uuid := auth.uid();
  v_week public.weeks%ROWTYPE;
  v_existing public.week_food_contexts%ROWTYPE;
  v_profile public.profiles%ROWTYPE;
  v_restrictions jsonb;
  v_servings integer;
  v_source text;
BEGIN
  IF v_user IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'freeze_week_food_context: authentication required';
  END IF;
  IF p_request_key IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'freeze_week_food_context: request key required';
  END IF;

  SELECT * INTO v_week FROM public.weeks
  WHERE user_id = v_user AND iso_year = p_iso_year AND iso_week = p_iso_week
  FOR UPDATE;
  IF NOT FOUND OR NOT (p_request_key = ANY (v_week.request_keys)) THEN
    RETURN jsonb_build_object('status', 'not_applied');
  END IF;

  SELECT * INTO v_existing FROM public.week_food_contexts WHERE week_id = v_week.id;
  IF FOUND AND v_existing.request_key = p_request_key THEN
    RETURN jsonb_build_object('status', 'duplicate', 'servings', v_existing.servings,
      'version', v_existing.context_version);
  END IF;
  -- request_keys is newest first: a late retry of an older apply never replaces a newer context.
  IF FOUND AND array_position(v_week.request_keys, v_existing.request_key)
      < array_position(v_week.request_keys, p_request_key) THEN
    RETURN jsonb_build_object('status', 'superseded', 'servings', v_existing.servings,
      'version', v_existing.context_version);
  END IF;

  SELECT * INTO v_profile FROM public.profiles WHERE user_id = v_user LIMIT 1;
  IF FOUND THEN
    v_restrictions := public.food_context_restrictions(v_profile.dietary_restrictions,
      v_profile.allergies, v_profile.other_allergies, v_profile.disliked_foods);
  END IF;

  IF p_generation_request_id IS NOT NULL THEN
    SELECT people_count INTO v_servings FROM public.menu_generation_requests
    WHERE id = p_generation_request_id AND user_id = v_user AND created_week_id = v_week.id;
  END IF;
  IF v_servings IS NOT NULL THEN
    v_source := 'generation';
  ELSIF v_profile.household_size IS NOT NULL THEN
    v_servings := v_profile.household_size;
    v_source := 'profile';
  ELSE
    v_servings := 2;
    v_source := 'default';
  END IF;

  INSERT INTO public.week_food_contexts (week_id, user_id, servings, servings_source, household_size,
    restrictions, context_version, profile_updated_at, request_key, frozen_at)
  VALUES (v_week.id, v_user, least(greatest(v_servings, 1), 10), v_source, v_profile.household_size,
    v_restrictions, public.food_context_version(v_restrictions), v_profile.updated_at, p_request_key, now())
  ON CONFLICT (week_id) DO UPDATE
  SET servings = EXCLUDED.servings, servings_source = EXCLUDED.servings_source,
      household_size = EXCLUDED.household_size, restrictions = EXCLUDED.restrictions,
      context_version = EXCLUDED.context_version, profile_updated_at = EXCLUDED.profile_updated_at,
      request_key = EXCLUDED.request_key, frozen_at = EXCLUDED.frozen_at;

  RETURN jsonb_build_object('status', 'frozen', 'servings', least(greatest(v_servings, 1), 10),
    'version', public.food_context_version(v_restrictions));
END;
$$;

-- The caller's week context next to their current profile, compared on the server.
--   frozen: null for weeks applied before C1 (or whose freeze never arrived).
--   restrictionsChanged / householdChanged: the profile changed after the week was frozen.
CREATE FUNCTION public.week_food_context_status(p_iso_year integer, p_iso_week integer)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = ''
AS $$
  WITH week AS (
    SELECT w.id FROM public.weeks AS w
    WHERE w.user_id = (SELECT auth.uid()) AND w.iso_year = p_iso_year AND w.iso_week = p_iso_week
    LIMIT 1
  ), frozen AS (
    SELECT c.* FROM public.week_food_contexts AS c JOIN week ON week.id = c.week_id
  ), current_context AS (
    SELECT public.current_food_context() AS ctx
  )
  SELECT jsonb_build_object(
    'week', EXISTS (SELECT 1 FROM week),
    'frozen', (SELECT jsonb_build_object(
      'servings', f.servings, 'servingsSource', f.servings_source, 'householdSize', f.household_size,
      'restrictions', f.restrictions, 'version', f.context_version, 'frozenAt', f.frozen_at)
      FROM frozen AS f),
    'current', (SELECT ctx - 'preferences' FROM current_context),
    'restrictionsChanged', coalesce((
      SELECT f.context_version IS DISTINCT FROM
        CASE WHEN (cc.ctx ->> 'found')::boolean THEN cc.ctx ->> 'version' ELSE 'fc1:none' END
      FROM frozen AS f, current_context AS cc), false),
    'householdChanged', coalesce((
      SELECT f.household_size IS NOT NULL AND (cc.ctx ->> 'found')::boolean
        AND f.household_size <> (cc.ctx ->> 'householdSize')::integer
      FROM frozen AS f, current_context AS cc), false)
  );
$$;

REVOKE ALL ON FUNCTION public.food_context_restrictions(text[], text[], text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.food_context_restrictions(text[], text[], text, text) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.food_context_version(jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.food_context_version(jsonb) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.current_food_context() FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.current_food_context() TO authenticated;
REVOKE ALL ON FUNCTION public.freeze_week_food_context(integer, integer, uuid, uuid) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.freeze_week_food_context(integer, integer, uuid, uuid) TO authenticated;
REVOKE ALL ON FUNCTION public.week_food_context_status(integer, integer) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.week_food_context_status(integer, integer) TO authenticated;
