-- D2 (roadmap steps 24 and 25): optional body data, confirmed profile sections and onboarding
-- progress that resumes on another device.
-- Additive only: drops four NOT NULL (the CHECKs already accept NULL), adds one column with a
-- constant default (no table rewrite) and one new table with its function. No row is modified or
-- deleted; existing profiles keep their values and start with no confirmed section ("assumed").
-- Safe with the client of main: it writes every body column, never confirmed_sections (kept as
-- is by its upsert) and never reads onboarding_progress. Order: migration → code. Once the new
-- code saves a profile without body data, the client of main can no longer read that profile.
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '120s';

ALTER TABLE public.profiles
  ALTER COLUMN sex DROP NOT NULL,
  ALTER COLUMN birth_date DROP NOT NULL,
  ALTER COLUMN height_cm DROP NOT NULL,
  ALTER COLUMN weight_kg DROP NOT NULL,
  -- Sections the user has answered or confirmed. Empty = a profile saved by the previous form,
  -- whose values may be the ones it pre-selected: shown as "assumed" until confirmed.
  ADD COLUMN confirmed_sections text[] NOT NULL DEFAULT '{}'::text[]
    CONSTRAINT profiles_confirmed_sections_chk
    CHECK (confirmed_sections <@ ARRAY['household', 'goals', 'restrictions', 'allergies', 'training', 'body']::text[]);

-- One row per account that started the onboarding; accounts created before it have none.
CREATE TABLE public.onboarding_progress (
  user_id uuid PRIMARY KEY DEFAULT auth.uid() REFERENCES auth.users (id) ON DELETE CASCADE,
  step text NOT NULL
    CONSTRAINT onboarding_progress_step_chk CHECK (step IN ('about', 'profile', 'pantry', 'done')),
  completed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT onboarding_progress_completed_chk CHECK ((step = 'done') = (completed_at IS NOT NULL))
);

ALTER TABLE public.onboarding_progress ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.onboarding_progress FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE ON TABLE public.onboarding_progress TO authenticated;

CREATE POLICY onboarding_progress_select_own ON public.onboarding_progress
  FOR SELECT TO authenticated USING ((SELECT auth.uid()) = user_id);
CREATE POLICY onboarding_progress_insert_own ON public.onboarding_progress
  FOR INSERT TO authenticated WITH CHECK ((SELECT auth.uid()) = user_id);
CREATE POLICY onboarding_progress_update_own ON public.onboarding_progress
  FOR UPDATE TO authenticated USING ((SELECT auth.uid()) = user_id) WITH CHECK ((SELECT auth.uid()) = user_id);

-- Moves the caller's onboarding forward, never back: a device that stayed on an earlier step
-- cannot undo what another device saved. Returns the step the account is on.
CREATE FUNCTION public.advance_onboarding(p_step text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
  v_user uuid := auth.uid();
  v_steps constant text[] := ARRAY['about', 'profile', 'pantry', 'done'];
  v_row public.onboarding_progress%ROWTYPE;
BEGIN
  IF v_user IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'advance_onboarding: authentication required';
  END IF;
  IF p_step IS NULL OR array_position(v_steps, p_step) IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'advance_onboarding: invalid step';
  END IF;

  INSERT INTO public.onboarding_progress AS o (user_id, step, completed_at)
  VALUES (v_user, p_step, CASE WHEN p_step = 'done' THEN now() END)
  ON CONFLICT (user_id) DO UPDATE
    SET step = EXCLUDED.step, completed_at = EXCLUDED.completed_at, updated_at = now()
    WHERE array_position(v_steps, EXCLUDED.step) > array_position(v_steps, o.step)
  RETURNING * INTO v_row;

  IF NOT FOUND THEN
    SELECT * INTO v_row FROM public.onboarding_progress WHERE user_id = v_user;
  END IF;

  RETURN jsonb_build_object('step', v_row.step, 'completed_at', v_row.completed_at);
END;
$$;

REVOKE ALL ON FUNCTION public.advance_onboarding(text) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.advance_onboarding(text) TO authenticated;

COMMIT;

-- Rollback (code that no longer uses them must be deployed first; restoring NOT NULL needs
-- every profile to have body data: SELECT count(*) FROM public.profiles WHERE sex IS NULL OR
-- birth_date IS NULL OR height_cm IS NULL OR weight_kg IS NULL):
-- DROP FUNCTION public.advance_onboarding(text);
-- DROP TABLE public.onboarding_progress;
-- ALTER TABLE public.profiles DROP COLUMN confirmed_sections;
-- ALTER TABLE public.profiles ALTER COLUMN sex SET NOT NULL, ALTER COLUMN birth_date SET NOT NULL,
--   ALTER COLUMN height_cm SET NOT NULL, ALTER COLUMN weight_kg SET NOT NULL;
