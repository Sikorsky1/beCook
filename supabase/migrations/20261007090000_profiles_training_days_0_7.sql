-- B2 (roadmap step 08): the profile form and types allow 0–7 training days, the CHECK only 0–5.
-- Additive: replaces the CHECK with a strictly wider one. Every row valid under 0–5 is valid
-- under 0–7, so validation cannot fail; no columns or data change.
-- Apply on becook-preview first, then production, before the code that saves 6–7 is merged.
ALTER TABLE public.profiles DROP CONSTRAINT IF EXISTS profiles_weekly_training_days_check;
ALTER TABLE public.profiles ADD CONSTRAINT profiles_weekly_training_days_check
  CHECK (weekly_training_days >= 0 AND weekly_training_days <= 7);

-- Rollback (only if no row has 6 or 7: SELECT count(*) FROM public.profiles WHERE weekly_training_days > 5):
-- ALTER TABLE public.profiles DROP CONSTRAINT profiles_weekly_training_days_check;
-- ALTER TABLE public.profiles ADD CONSTRAINT profiles_weekly_training_days_check
--   CHECK (weekly_training_days >= 0 AND weekly_training_days <= 5);
