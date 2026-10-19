-- Breakfasts, mid-mornings and snacks of a week (the optional ones of Crear menú and a
-- nutritionist's plan), so Semana can show today's alongside lunch and dinner on every device.
-- Additive: a new table, one row per user and ISO week; the days are the proposal's own
-- [{dayName, meals: [{meal, option, options, text}]}] (src/lib/data/dailyMeals.ts validates it).
-- A week applied without them is saved with days [] (no deletes from the client). No existing
-- table, row or function changes. Apply on becook-preview first, then production.
CREATE TABLE public.week_daily_meals (
  user_id uuid NOT NULL DEFAULT auth.uid() REFERENCES auth.users (id) ON DELETE CASCADE,
  iso_year integer NOT NULL CONSTRAINT week_daily_meals_iso_year_chk CHECK (iso_year BETWEEN 2000 AND 2100),
  iso_week integer NOT NULL CONSTRAINT week_daily_meals_iso_week_chk CHECK (iso_week BETWEEN 1 AND 53),
  days jsonb NOT NULL
    CONSTRAINT week_daily_meals_days_chk CHECK (jsonb_typeof(days) = 'array' AND octet_length(days::text) <= 16384),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, iso_year, iso_week)
);

ALTER TABLE public.week_daily_meals ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.week_daily_meals FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE ON TABLE public.week_daily_meals TO authenticated;

CREATE POLICY week_daily_meals_select_own ON public.week_daily_meals
  FOR SELECT TO authenticated USING ((SELECT auth.uid()) = user_id);
CREATE POLICY week_daily_meals_insert_own ON public.week_daily_meals
  FOR INSERT TO authenticated WITH CHECK ((SELECT auth.uid()) = user_id);
CREATE POLICY week_daily_meals_update_own ON public.week_daily_meals
  FOR UPDATE TO authenticated USING ((SELECT auth.uid()) = user_id) WITH CHECK ((SELECT auth.uid()) = user_id);

-- Rollback (loses the saved breakfasts; the menus and lists are not affected):
-- DROP TABLE public.week_daily_meals;
