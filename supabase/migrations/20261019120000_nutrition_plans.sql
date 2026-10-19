-- The breakfast, mid-morning, snack and bedtime options of the user's nutritionist plan, read from
-- the PDF when it is imported, so «Planificar también desayunos…» in Crear menú uses them instead of
-- beCook's own. One row per user; the client replaces it when another plan is imported and deletes
-- it when the user stops using the plan. Additive: a new table, nothing else changes.
-- options: {"breakfast": [{"text", "fillings": [..]}], "midMorning": [...], "snack": [...], "bedtime": [...]}
-- (src/lib/data/nutritionPlanStore.ts validates it).
CREATE TABLE public.nutrition_plans (
  user_id uuid PRIMARY KEY DEFAULT auth.uid() REFERENCES auth.users (id) ON DELETE CASCADE,
  options jsonb NOT NULL
    CONSTRAINT nutrition_plans_options_chk CHECK (jsonb_typeof(options) = 'object' AND octet_length(options::text) <= 16384),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.nutrition_plans ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.nutrition_plans FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.nutrition_plans TO authenticated;

CREATE POLICY nutrition_plans_select_own ON public.nutrition_plans
  FOR SELECT TO authenticated USING ((SELECT auth.uid()) = user_id);
CREATE POLICY nutrition_plans_insert_own ON public.nutrition_plans
  FOR INSERT TO authenticated WITH CHECK ((SELECT auth.uid()) = user_id);
CREATE POLICY nutrition_plans_update_own ON public.nutrition_plans
  FOR UPDATE TO authenticated USING ((SELECT auth.uid()) = user_id) WITH CHECK ((SELECT auth.uid()) = user_id);
CREATE POLICY nutrition_plans_delete_own ON public.nutrition_plans
  FOR DELETE TO authenticated USING ((SELECT auth.uid()) = user_id);

-- Rollback (the users import their PDF again): DROP TABLE public.nutrition_plans;
