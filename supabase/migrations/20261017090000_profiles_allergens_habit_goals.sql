-- Nutritional analysis, phase 1 (N02 and N06). Additive: both CHECKs are replaced by strictly wider
-- ones. Every row valid before stays valid, so validation cannot fail; no columns or data change.
-- - allergies: the 14 EU allergens (Regulation 1169/2011, annex II) apart, «milk» (allergy to milk
--   protein) apart from «lactose» (intolerance). «shellfish» stays valid for existing profiles.
-- - goals: habit goals instead of body-composition ones. The old values stay valid (the form maps
--   them to «healthy_eating» and only saves the new ones when the person saves that section).
-- Apply on becook-preview first, then production, before the code that saves the new values.
ALTER TABLE public.profiles DROP CONSTRAINT IF EXISTS profiles_allergies_check;
ALTER TABLE public.profiles ADD CONSTRAINT profiles_allergies_check
  CHECK (allergies <@ ARRAY['gluten', 'crustaceans', 'egg', 'fish', 'peanuts', 'soy', 'milk', 'lactose', 'nuts',
    'celery', 'mustard', 'sesame', 'sulphites', 'lupin', 'molluscs', 'shellfish', 'other']::text[]);

ALTER TABLE public.profiles DROP CONSTRAINT IF EXISTS profiles_goals_allowed_chk;
ALTER TABLE public.profiles ADD CONSTRAINT profiles_goals_allowed_chk
  CHECK (goals <@ ARRAY['fat_loss', 'muscle_gain', 'sports_performance', 'healthy_eating', 'other',
    'varied', 'more_plants', 'cook_home', 'save_time', 'save_money', 'with_kids']::text[]);

-- Rollback (only if no row uses a new value:
--   SELECT count(*) FROM public.profiles WHERE NOT allergies <@ ARRAY['gluten','lactose','nuts','shellfish','egg','other']
--      OR NOT goals <@ ARRAY['fat_loss','muscle_gain','sports_performance','healthy_eating','other']):
-- ALTER TABLE public.profiles DROP CONSTRAINT profiles_allergies_check;
-- ALTER TABLE public.profiles ADD CONSTRAINT profiles_allergies_check
--   CHECK (allergies <@ ARRAY['gluten','lactose','nuts','shellfish','egg','other']::text[]);
-- ALTER TABLE public.profiles DROP CONSTRAINT profiles_goals_allowed_chk;
-- ALTER TABLE public.profiles ADD CONSTRAINT profiles_goals_allowed_chk
--   CHECK (goals <@ ARRAY['fat_loss','muscle_gain','sports_performance','healthy_eating','other']::text[]);
