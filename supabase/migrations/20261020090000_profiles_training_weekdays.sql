-- Perfil → Entrenamiento asks for the days of the week the user trains (L M X J V S D) instead of
-- how many, and offers «Cardio». Crear menú reads the days from current_food_context() to put the
-- starchy dishes on them (src/lib/menu-generation/carbs.ts). Additive:
-- - training_weekdays: new nullable column (1 = Monday … 7 = Sunday). NULL in every existing row:
--   the code reads a spread of weekly_training_days for them (src/lib/trainingDays.ts) until the
--   user saves their days. weekly_training_days stays, as the count of the days.
-- - profiles_training_types_check: replaced by a strictly wider one ('cardio'); every valid row
--   stays valid.
-- - current_food_context(): same result plus preferences.trainingWeekdays (null when not saved).
-- Apply on becook-preview first, then production, before the code that reads the column.
ALTER TABLE public.profiles ADD COLUMN training_weekdays smallint[];
ALTER TABLE public.profiles ADD CONSTRAINT profiles_training_weekdays_chk
  CHECK (training_weekdays IS NULL OR (training_weekdays <@ ARRAY[1, 2, 3, 4, 5, 6, 7]::smallint[]
    AND cardinality(training_weekdays) <= 7));

ALTER TABLE public.profiles DROP CONSTRAINT IF EXISTS profiles_training_types_check;
ALTER TABLE public.profiles ADD CONSTRAINT profiles_training_types_check
  CHECK (training_types <@ ARRAY['strength', 'crossfit', 'hyrox', 'running', 'cycling', 'padel', 'swimming',
    'team_sports', 'hiking', 'yoga_pilates', 'other', 'cardio']::text[]);

CREATE OR REPLACE FUNCTION public.current_food_context()
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
        'trainingWeekdays', to_jsonb(p.training_weekdays),
        'trainingTypes', to_jsonb(p.training_types)),
      'updatedAt', p.updated_at)
    FROM public.profiles AS p
    CROSS JOIN LATERAL (SELECT public.food_context_restrictions(
      p.dietary_restrictions, p.allergies, p.other_allergies, p.disliked_foods) AS restrictions) AS r
    WHERE p.user_id = (SELECT auth.uid())
    LIMIT 1
  ), jsonb_build_object('found', false));
$$;

-- Rollback (only if no row uses 'cardio': SELECT count(*) FROM public.profiles WHERE 'cardio' = ANY(training_types)):
-- CREATE OR REPLACE FUNCTION public.current_food_context() … (definition of 20261011090000_week_food_context)
-- ALTER TABLE public.profiles DROP CONSTRAINT profiles_training_types_check;
-- ALTER TABLE public.profiles ADD CONSTRAINT profiles_training_types_check
--   CHECK (training_types <@ ARRAY['strength','crossfit','hyrox','running','cycling','padel','swimming','team_sports','hiking','yoga_pilates','other']::text[]);
-- ALTER TABLE public.profiles DROP CONSTRAINT profiles_training_weekdays_chk;
-- ALTER TABLE public.profiles DROP COLUMN training_weekdays;
