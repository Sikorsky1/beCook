-- Metadata-only baseline inspected 2026-09-23. LOCAL EMPTY DATABASES ONLY.
-- Kept outside migrations: never push this baseline to an existing remote.
set search_path = public, extensions;
DO $$ BEGIN
 IF EXISTS (SELECT FROM pg_tables WHERE schemaname='public') THEN
  RAISE EXCEPTION 'Baseline requires an empty public schema';
 END IF;
END $$;
CREATE TABLE public."week_days" (
  "id" uuid DEFAULT gen_random_uuid() NOT NULL,
  "week_id" uuid NOT NULL,
  "day_name" text NOT NULL,
  "position" integer NOT NULL,
  "lunch_status" text NOT NULL,
  "lunch_dish_name" text DEFAULT ''::text NOT NULL,
  "dinner_status" text NOT NULL,
  "dinner_dish_name" text DEFAULT ''::text NOT NULL,
  "created_at" timestamp with time zone DEFAULT now()
);
CREATE TABLE public."profiles" (
  "id" uuid DEFAULT gen_random_uuid() NOT NULL,
  "sex" text NOT NULL,
  "birth_date" date NOT NULL,
  "height_cm" integer NOT NULL,
  "weight_kg" integer NOT NULL,
  "household_size" integer DEFAULT 2 NOT NULL,
  "weekly_training_days" integer DEFAULT 0 NOT NULL,
  "training_types" text[] DEFAULT '{}'::text[] NOT NULL,
  "other_training_type" text,
  "goal" text NOT NULL,
  "dietary_restrictions" text[] DEFAULT '{}'::text[] NOT NULL,
  "allergies" text[] DEFAULT '{}'::text[] NOT NULL,
  "other_allergies" text,
  "disliked_foods" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  "user_id" uuid,
  "active_week_id" uuid,
  "goals" text[] DEFAULT '{}'::text[] NOT NULL,
  "other_goal" text
);
CREATE TABLE public."pantry_items" (
  "id" uuid DEFAULT gen_random_uuid() NOT NULL,
  "profile_id" uuid,
  "name" text NOT NULL,
  "category" text DEFAULT 'otros'::text NOT NULL,
  "active" boolean DEFAULT true NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  "user_id" uuid
);
CREATE TABLE public."shopping_lists" (
  "id" uuid DEFAULT gen_random_uuid() NOT NULL,
  "week_id" uuid NOT NULL,
  "generated_at" timestamp with time zone DEFAULT now() NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
CREATE TABLE public."shopping_items" (
  "id" uuid DEFAULT gen_random_uuid() NOT NULL,
  "shopping_list_id" uuid NOT NULL,
  "name" text NOT NULL,
  "quantity" numeric,
  "unit" text,
  "category" text DEFAULT 'otros'::text NOT NULL,
  "checked" boolean DEFAULT false NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
CREATE TABLE public."weeks" (
  "id" uuid DEFAULT gen_random_uuid() NOT NULL,
  "title" text,
  "created_at" timestamp with time zone DEFAULT now(),
  "profile_id" uuid,
  "generation_request_id" uuid,
  "source" text DEFAULT 'manual'::text NOT NULL,
  "start_date" date,
  "end_date" date,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  "user_id" uuid,
  "iso_year" integer,
  "iso_week" integer
);
CREATE TABLE public."menu_generation_requests" (
  "id" uuid DEFAULT gen_random_uuid() NOT NULL,
  "profile_id" uuid,
  "people_count" integer DEFAULT 2 NOT NULL,
  "menu_style" text,
  "free_text_prompt" text,
  "status" text DEFAULT 'draft'::text NOT NULL,
  "created_week_id" uuid,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  "user_id" uuid,
  "model_used" text,
  "prompt_tokens" integer,
  "completion_tokens" integer,
  "total_tokens" integer,
  "estimated_cost_usd" numeric(10,6),
  "response_time_ms" integer
);
ALTER TABLE public."weeks" ADD CONSTRAINT "weeks_pkey" PRIMARY KEY (id);
ALTER TABLE public."week_days" ADD CONSTRAINT "week_days_lunch_status_check" CHECK ((lunch_status = ANY (ARRAY['planned'::text, 'free'::text])));
ALTER TABLE public."week_days" ADD CONSTRAINT "week_days_dinner_status_check" CHECK ((dinner_status = ANY (ARRAY['planned'::text, 'free'::text])));
ALTER TABLE public."week_days" ADD CONSTRAINT "week_days_pkey" PRIMARY KEY (id);
ALTER TABLE public."profiles" ADD CONSTRAINT "profiles_sex_check" CHECK ((sex = ANY (ARRAY['male'::text, 'female'::text])));
ALTER TABLE public."shopping_lists" ADD CONSTRAINT "shopping_lists_pkey" PRIMARY KEY (id);
ALTER TABLE public."profiles" ADD CONSTRAINT "profiles_height_cm_check" CHECK (((height_cm >= 120) AND (height_cm <= 230)));
ALTER TABLE public."profiles" ADD CONSTRAINT "profiles_weight_kg_check" CHECK (((weight_kg >= 45) AND (weight_kg <= 200)));
ALTER TABLE public."profiles" ADD CONSTRAINT "profiles_household_size_check" CHECK (((household_size >= 1) AND (household_size <= 6)));
ALTER TABLE public."profiles" ADD CONSTRAINT "profiles_weekly_training_days_check" CHECK (((weekly_training_days >= 0) AND (weekly_training_days <= 5)));
ALTER TABLE public."profiles" ADD CONSTRAINT "profiles_training_types_check" CHECK ((training_types <@ ARRAY['strength'::text, 'crossfit'::text, 'hyrox'::text, 'running'::text, 'cycling'::text, 'padel'::text, 'swimming'::text, 'team_sports'::text, 'hiking'::text, 'yoga_pilates'::text, 'other'::text]));
ALTER TABLE public."profiles" ADD CONSTRAINT "profiles_goal_check" CHECK ((goal = ANY (ARRAY['fat_loss'::text, 'maintenance'::text, 'muscle_gain'::text, 'sports_performance'::text, 'healthy_eating'::text])));
ALTER TABLE public."profiles" ADD CONSTRAINT "profiles_dietary_restrictions_check" CHECK ((dietary_restrictions <@ ARRAY['none'::text, 'vegetarian'::text, 'vegan'::text, 'pescatarian'::text, 'no_pork'::text, 'no_alcohol'::text]));
ALTER TABLE public."profiles" ADD CONSTRAINT "profiles_allergies_check" CHECK ((allergies <@ ARRAY['gluten'::text, 'lactose'::text, 'nuts'::text, 'shellfish'::text, 'egg'::text, 'other'::text]));
ALTER TABLE public."profiles" ADD CONSTRAINT "profiles_disliked_foods_check" CHECK (((disliked_foods IS NULL) OR (char_length(disliked_foods) <= 150)));
ALTER TABLE public."profiles" ADD CONSTRAINT "profiles_pkey" PRIMARY KEY (id);
ALTER TABLE public."weeks" ADD CONSTRAINT "weeks_source_check" CHECK ((source = ANY (ARRAY['manual'::text, 'imported'::text, 'generated'::text])));
ALTER TABLE public."menu_generation_requests" ADD CONSTRAINT "menu_generation_requests_people_count_check" CHECK (((people_count >= 1) AND (people_count <= 10)));
ALTER TABLE public."menu_generation_requests" ADD CONSTRAINT "menu_generation_requests_free_text_prompt_check" CHECK (((free_text_prompt IS NULL) OR (char_length(free_text_prompt) <= 500)));
ALTER TABLE public."menu_generation_requests" ADD CONSTRAINT "menu_generation_requests_status_check" CHECK ((status = ANY (ARRAY['draft'::text, 'generating'::text, 'generated'::text, 'failed'::text, 'applied'::text])));
ALTER TABLE public."menu_generation_requests" ADD CONSTRAINT "menu_generation_requests_pkey" PRIMARY KEY (id);
ALTER TABLE public."shopping_items" ADD CONSTRAINT "shopping_items_quantity_check" CHECK (((quantity IS NULL) OR (quantity >= (0)::numeric)));
ALTER TABLE public."shopping_items" ADD CONSTRAINT "shopping_items_pkey" PRIMARY KEY (id);
ALTER TABLE public."pantry_items" ADD CONSTRAINT "pantry_items_pkey" PRIMARY KEY (id);
ALTER TABLE public."profiles" ADD CONSTRAINT "profiles_user_id_unique" UNIQUE (user_id);
ALTER TABLE public."weeks" ADD CONSTRAINT "weeks_iso_week_range_chk" CHECK ((((iso_year IS NULL) AND (iso_week IS NULL)) OR (((iso_year >= 2000) AND (iso_year <= 2100)) AND ((iso_week >= 1) AND (iso_week <= 53)))));
ALTER TABLE public."menu_generation_requests" ADD CONSTRAINT "menu_generation_requests_openai_usage_non_negative_chk" CHECK ((((prompt_tokens IS NULL) OR (prompt_tokens >= 0)) AND ((completion_tokens IS NULL) OR (completion_tokens >= 0)) AND ((total_tokens IS NULL) OR (total_tokens >= 0)) AND ((estimated_cost_usd IS NULL) OR (estimated_cost_usd >= (0)::numeric)) AND ((response_time_ms IS NULL) OR (response_time_ms >= 0))));
ALTER TABLE public."profiles" ADD CONSTRAINT "profiles_goals_allowed_chk" CHECK ((goals <@ ARRAY['fat_loss'::text, 'muscle_gain'::text, 'sports_performance'::text, 'healthy_eating'::text, 'other'::text]));
ALTER TABLE public."profiles" ADD CONSTRAINT "profiles_other_goal_length_chk" CHECK (((other_goal IS NULL) OR (char_length(other_goal) <= 150)));
ALTER TABLE public."week_days" ADD CONSTRAINT "week_days_week_id_fkey" FOREIGN KEY (week_id) REFERENCES weeks(id) ON DELETE CASCADE;
ALTER TABLE public."weeks" ADD CONSTRAINT "weeks_generation_request_id_fkey" FOREIGN KEY (generation_request_id) REFERENCES menu_generation_requests(id) ON DELETE SET NULL;
ALTER TABLE public."shopping_lists" ADD CONSTRAINT "shopping_lists_week_id_fkey" FOREIGN KEY (week_id) REFERENCES weeks(id) ON DELETE CASCADE;
ALTER TABLE public."weeks" ADD CONSTRAINT "weeks_profile_id_fkey" FOREIGN KEY (profile_id) REFERENCES profiles(id) ON DELETE SET NULL;
ALTER TABLE public."menu_generation_requests" ADD CONSTRAINT "menu_generation_requests_profile_id_fkey" FOREIGN KEY (profile_id) REFERENCES profiles(id) ON DELETE SET NULL;
ALTER TABLE public."menu_generation_requests" ADD CONSTRAINT "menu_generation_requests_created_week_id_fkey" FOREIGN KEY (created_week_id) REFERENCES weeks(id) ON DELETE SET NULL;
ALTER TABLE public."shopping_items" ADD CONSTRAINT "shopping_items_shopping_list_id_fkey" FOREIGN KEY (shopping_list_id) REFERENCES shopping_lists(id) ON DELETE CASCADE;
ALTER TABLE public."pantry_items" ADD CONSTRAINT "pantry_items_profile_id_fkey" FOREIGN KEY (profile_id) REFERENCES profiles(id) ON DELETE SET NULL;
ALTER TABLE public."profiles" ADD CONSTRAINT "profiles_user_id_fkey" FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;
ALTER TABLE public."weeks" ADD CONSTRAINT "weeks_user_id_fkey" FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;
ALTER TABLE public."menu_generation_requests" ADD CONSTRAINT "menu_generation_requests_user_id_fkey" FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;
ALTER TABLE public."pantry_items" ADD CONSTRAINT "pantry_items_user_id_fkey" FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;
ALTER TABLE public."profiles" ADD CONSTRAINT "profiles_active_week_id_fkey" FOREIGN KEY (active_week_id) REFERENCES weeks(id) ON DELETE SET NULL;
CREATE INDEX week_days_week_id_idx ON public.week_days USING btree (week_id);
CREATE INDEX week_days_position_idx ON public.week_days USING btree ("position");
CREATE UNIQUE INDEX profiles_user_id_unique_idx ON public.profiles USING btree (user_id) WHERE (user_id IS NOT NULL);
CREATE INDEX profiles_created_at_idx ON public.profiles USING btree (created_at DESC);
CREATE INDEX profiles_user_id_idx ON public.profiles USING btree (user_id);
CREATE INDEX profiles_active_week_id_idx ON public.profiles USING btree (active_week_id);
CREATE INDEX pantry_items_profile_id_idx ON public.pantry_items USING btree (profile_id);
CREATE INDEX pantry_items_active_idx ON public.pantry_items USING btree (active);
CREATE INDEX pantry_items_user_id_idx ON public.pantry_items USING btree (user_id);
CREATE INDEX shopping_lists_week_id_idx ON public.shopping_lists USING btree (week_id);
CREATE INDEX shopping_items_shopping_list_id_idx ON public.shopping_items USING btree (shopping_list_id);
CREATE INDEX shopping_items_category_idx ON public.shopping_items USING btree (category);
CREATE INDEX weeks_profile_id_idx ON public.weeks USING btree (profile_id);
CREATE INDEX weeks_generation_request_id_idx ON public.weeks USING btree (generation_request_id);
CREATE INDEX weeks_created_at_idx ON public.weeks USING btree (created_at DESC);
CREATE INDEX weeks_user_id_idx ON public.weeks USING btree (user_id);
CREATE UNIQUE INDEX weeks_user_iso_week_unique_idx ON public.weeks USING btree (user_id, iso_year, iso_week) WHERE ((user_id IS NOT NULL) AND (iso_year IS NOT NULL) AND (iso_week IS NOT NULL));
CREATE INDEX weeks_user_iso_lookup_idx ON public.weeks USING btree (user_id, iso_year, iso_week);
CREATE INDEX weeks_user_created_at_idx ON public.weeks USING btree (user_id, created_at DESC);
CREATE INDEX menu_generation_requests_profile_id_idx ON public.menu_generation_requests USING btree (profile_id);
CREATE INDEX menu_generation_requests_created_week_id_idx ON public.menu_generation_requests USING btree (created_week_id);
CREATE INDEX menu_generation_requests_user_id_idx ON public.menu_generation_requests USING btree (user_id);
ALTER TABLE public."week_days" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."profiles" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."pantry_items" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."shopping_lists" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."shopping_items" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."weeks" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."menu_generation_requests" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "week_days_delete_own" ON public."week_days" AS PERMISSIVE FOR DELETE TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM weeks
  WHERE ((weeks.id = week_days.week_id) AND (weeks.user_id = auth.uid())))));
CREATE POLICY "week_days_insert_own" ON public."week_days" AS PERMISSIVE FOR INSERT TO "authenticated" WITH CHECK ((EXISTS ( SELECT 1
   FROM weeks
  WHERE ((weeks.id = week_days.week_id) AND (weeks.user_id = auth.uid())))));
CREATE POLICY "week_days_select_own" ON public."week_days" AS PERMISSIVE FOR SELECT TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM weeks
  WHERE ((weeks.id = week_days.week_id) AND (weeks.user_id = auth.uid())))));
CREATE POLICY "week_days_update_own" ON public."week_days" AS PERMISSIVE FOR UPDATE TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM weeks
  WHERE ((weeks.id = week_days.week_id) AND (weeks.user_id = auth.uid()))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM weeks
  WHERE ((weeks.id = week_days.week_id) AND (weeks.user_id = auth.uid())))));
CREATE POLICY "profiles_delete_own" ON public."profiles" AS PERMISSIVE FOR DELETE TO "authenticated" USING ((( SELECT auth.uid() AS uid) = user_id));
CREATE POLICY "profiles_insert_own" ON public."profiles" AS PERMISSIVE FOR INSERT TO "authenticated" WITH CHECK ((( SELECT auth.uid() AS uid) = user_id));
CREATE POLICY "profiles_select_own" ON public."profiles" AS PERMISSIVE FOR SELECT TO "authenticated" USING ((( SELECT auth.uid() AS uid) = user_id));
CREATE POLICY "profiles_update_own" ON public."profiles" AS PERMISSIVE FOR UPDATE TO "authenticated" USING ((( SELECT auth.uid() AS uid) = user_id)) WITH CHECK ((( SELECT auth.uid() AS uid) = user_id));
CREATE POLICY "pantry_items_delete_own" ON public."pantry_items" AS PERMISSIVE FOR DELETE TO "authenticated" USING ((( SELECT auth.uid() AS uid) = user_id));
CREATE POLICY "pantry_items_insert_own" ON public."pantry_items" AS PERMISSIVE FOR INSERT TO "authenticated" WITH CHECK ((( SELECT auth.uid() AS uid) = user_id));
CREATE POLICY "pantry_items_select_own" ON public."pantry_items" AS PERMISSIVE FOR SELECT TO "authenticated" USING ((( SELECT auth.uid() AS uid) = user_id));
CREATE POLICY "pantry_items_update_own" ON public."pantry_items" AS PERMISSIVE FOR UPDATE TO "authenticated" USING ((( SELECT auth.uid() AS uid) = user_id)) WITH CHECK ((( SELECT auth.uid() AS uid) = user_id));
CREATE POLICY "shopping_lists_delete_own" ON public."shopping_lists" AS PERMISSIVE FOR DELETE TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM weeks
  WHERE ((weeks.id = shopping_lists.week_id) AND (weeks.user_id = auth.uid())))));
CREATE POLICY "shopping_lists_insert_own" ON public."shopping_lists" AS PERMISSIVE FOR INSERT TO "authenticated" WITH CHECK ((EXISTS ( SELECT 1
   FROM weeks
  WHERE ((weeks.id = shopping_lists.week_id) AND (weeks.user_id = auth.uid())))));
CREATE POLICY "shopping_lists_select_own" ON public."shopping_lists" AS PERMISSIVE FOR SELECT TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM weeks
  WHERE ((weeks.id = shopping_lists.week_id) AND (weeks.user_id = auth.uid())))));
CREATE POLICY "shopping_lists_update_own" ON public."shopping_lists" AS PERMISSIVE FOR UPDATE TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM weeks
  WHERE ((weeks.id = shopping_lists.week_id) AND (weeks.user_id = auth.uid()))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM weeks
  WHERE ((weeks.id = shopping_lists.week_id) AND (weeks.user_id = auth.uid())))));
CREATE POLICY "shopping_items_delete_own" ON public."shopping_items" AS PERMISSIVE FOR DELETE TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM (shopping_lists
     JOIN weeks ON ((weeks.id = shopping_lists.week_id)))
  WHERE ((shopping_lists.id = shopping_items.shopping_list_id) AND (weeks.user_id = auth.uid())))));
CREATE POLICY "shopping_items_insert_own" ON public."shopping_items" AS PERMISSIVE FOR INSERT TO "authenticated" WITH CHECK ((EXISTS ( SELECT 1
   FROM (shopping_lists
     JOIN weeks ON ((weeks.id = shopping_lists.week_id)))
  WHERE ((shopping_lists.id = shopping_items.shopping_list_id) AND (weeks.user_id = auth.uid())))));
CREATE POLICY "shopping_items_select_own" ON public."shopping_items" AS PERMISSIVE FOR SELECT TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM (shopping_lists
     JOIN weeks ON ((weeks.id = shopping_lists.week_id)))
  WHERE ((shopping_lists.id = shopping_items.shopping_list_id) AND (weeks.user_id = auth.uid())))));
CREATE POLICY "shopping_items_update_own" ON public."shopping_items" AS PERMISSIVE FOR UPDATE TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM (shopping_lists
     JOIN weeks ON ((weeks.id = shopping_lists.week_id)))
  WHERE ((shopping_lists.id = shopping_items.shopping_list_id) AND (weeks.user_id = auth.uid()))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM (shopping_lists
     JOIN weeks ON ((weeks.id = shopping_lists.week_id)))
  WHERE ((shopping_lists.id = shopping_items.shopping_list_id) AND (weeks.user_id = auth.uid())))));
CREATE POLICY "weeks_delete_own" ON public."weeks" AS PERMISSIVE FOR DELETE TO "authenticated" USING ((( SELECT auth.uid() AS uid) = user_id));
CREATE POLICY "weeks_insert_own" ON public."weeks" AS PERMISSIVE FOR INSERT TO "authenticated" WITH CHECK ((( SELECT auth.uid() AS uid) = user_id));
CREATE POLICY "weeks_select_own" ON public."weeks" AS PERMISSIVE FOR SELECT TO "authenticated" USING ((( SELECT auth.uid() AS uid) = user_id));
CREATE POLICY "weeks_update_own" ON public."weeks" AS PERMISSIVE FOR UPDATE TO "authenticated" USING ((( SELECT auth.uid() AS uid) = user_id)) WITH CHECK ((( SELECT auth.uid() AS uid) = user_id));
CREATE POLICY "menu_generation_requests_delete_own" ON public."menu_generation_requests" AS PERMISSIVE FOR DELETE TO "authenticated" USING ((( SELECT auth.uid() AS uid) = user_id));
CREATE POLICY "menu_generation_requests_insert_own" ON public."menu_generation_requests" AS PERMISSIVE FOR INSERT TO "authenticated" WITH CHECK ((( SELECT auth.uid() AS uid) = user_id));
CREATE POLICY "menu_generation_requests_select_own" ON public."menu_generation_requests" AS PERMISSIVE FOR SELECT TO "authenticated" USING ((( SELECT auth.uid() AS uid) = user_id));
CREATE POLICY "menu_generation_requests_update_own" ON public."menu_generation_requests" AS PERMISSIVE FOR UPDATE TO "authenticated" USING ((( SELECT auth.uid() AS uid) = user_id)) WITH CHECK ((( SELECT auth.uid() AS uid) = user_id));
CREATE OR REPLACE FUNCTION public.rls_auto_enable()
 RETURNS event_trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
DECLARE
  cmd record;
BEGIN
  FOR cmd IN
    SELECT *
    FROM pg_event_trigger_ddl_commands()
    WHERE command_tag IN ('CREATE TABLE', 'CREATE TABLE AS', 'SELECT INTO')
      AND object_type IN ('table','partitioned table')
  LOOP
     IF cmd.schema_name IS NOT NULL AND cmd.schema_name IN ('public') AND cmd.schema_name NOT IN ('pg_catalog','information_schema') AND cmd.schema_name NOT LIKE 'pg_toast%' AND cmd.schema_name NOT LIKE 'pg_temp%' THEN
      BEGIN
        EXECUTE format('alter table if exists %s enable row level security', cmd.object_identity);
        RAISE LOG 'rls_auto_enable: enabled RLS on %', cmd.object_identity;
      EXCEPTION
        WHEN OTHERS THEN
          RAISE LOG 'rls_auto_enable: failed to enable RLS on %', cmd.object_identity;
      END;
     ELSE
        RAISE LOG 'rls_auto_enable: skip % (either system schema or not in enforced list: %.)', cmd.object_identity, cmd.schema_name;
     END IF;
  END LOOP;
END;
$function$
;
CREATE OR REPLACE FUNCTION public.set_updated_at()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
begin
  new.updated_at = now();
  return new;
end;
$function$
;
CREATE TRIGGER set_weeks_updated_at BEFORE UPDATE ON public.weeks FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER set_profiles_updated_at BEFORE UPDATE ON public.profiles FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER set_menu_generation_requests_updated_at BEFORE UPDATE ON public.menu_generation_requests FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER set_shopping_lists_updated_at BEFORE UPDATE ON public.shopping_lists FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER set_shopping_items_updated_at BEFORE UPDATE ON public.shopping_items FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER set_pantry_items_updated_at BEFORE UPDATE ON public.pantry_items FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE EVENT TRIGGER ensure_rls ON ddl_command_end WHEN TAG IN ('CREATE TABLE', 'CREATE TABLE AS', 'SELECT INTO') EXECUTE FUNCTION public.rls_auto_enable();
REVOKE ALL ON public."week_days" FROM PUBLIC, anon, authenticated, service_role;
GRANT INSERT ON public."week_days" TO "postgres";
GRANT SELECT ON public."week_days" TO "postgres";
GRANT UPDATE ON public."week_days" TO "postgres";
GRANT DELETE ON public."week_days" TO "postgres";
GRANT TRUNCATE ON public."week_days" TO "postgres";
GRANT REFERENCES ON public."week_days" TO "postgres";
GRANT TRIGGER ON public."week_days" TO "postgres";
GRANT INSERT ON public."week_days" TO "anon";
GRANT SELECT ON public."week_days" TO "anon";
GRANT UPDATE ON public."week_days" TO "anon";
GRANT DELETE ON public."week_days" TO "anon";
GRANT TRUNCATE ON public."week_days" TO "anon";
GRANT REFERENCES ON public."week_days" TO "anon";
GRANT TRIGGER ON public."week_days" TO "anon";
GRANT INSERT ON public."week_days" TO "authenticated";
GRANT SELECT ON public."week_days" TO "authenticated";
GRANT UPDATE ON public."week_days" TO "authenticated";
GRANT DELETE ON public."week_days" TO "authenticated";
GRANT TRUNCATE ON public."week_days" TO "authenticated";
GRANT REFERENCES ON public."week_days" TO "authenticated";
GRANT TRIGGER ON public."week_days" TO "authenticated";
GRANT INSERT ON public."week_days" TO "service_role";
GRANT SELECT ON public."week_days" TO "service_role";
GRANT UPDATE ON public."week_days" TO "service_role";
GRANT DELETE ON public."week_days" TO "service_role";
GRANT TRUNCATE ON public."week_days" TO "service_role";
GRANT REFERENCES ON public."week_days" TO "service_role";
GRANT TRIGGER ON public."week_days" TO "service_role";
REVOKE ALL ON public."profiles" FROM PUBLIC, anon, authenticated, service_role;
GRANT INSERT ON public."profiles" TO "postgres";
GRANT SELECT ON public."profiles" TO "postgres";
GRANT UPDATE ON public."profiles" TO "postgres";
GRANT DELETE ON public."profiles" TO "postgres";
GRANT TRUNCATE ON public."profiles" TO "postgres";
GRANT REFERENCES ON public."profiles" TO "postgres";
GRANT TRIGGER ON public."profiles" TO "postgres";
GRANT INSERT ON public."profiles" TO "anon";
GRANT SELECT ON public."profiles" TO "anon";
GRANT UPDATE ON public."profiles" TO "anon";
GRANT DELETE ON public."profiles" TO "anon";
GRANT TRUNCATE ON public."profiles" TO "anon";
GRANT REFERENCES ON public."profiles" TO "anon";
GRANT TRIGGER ON public."profiles" TO "anon";
GRANT INSERT ON public."profiles" TO "authenticated";
GRANT SELECT ON public."profiles" TO "authenticated";
GRANT UPDATE ON public."profiles" TO "authenticated";
GRANT DELETE ON public."profiles" TO "authenticated";
GRANT TRUNCATE ON public."profiles" TO "authenticated";
GRANT REFERENCES ON public."profiles" TO "authenticated";
GRANT TRIGGER ON public."profiles" TO "authenticated";
GRANT INSERT ON public."profiles" TO "service_role";
GRANT SELECT ON public."profiles" TO "service_role";
GRANT UPDATE ON public."profiles" TO "service_role";
GRANT DELETE ON public."profiles" TO "service_role";
GRANT TRUNCATE ON public."profiles" TO "service_role";
GRANT REFERENCES ON public."profiles" TO "service_role";
GRANT TRIGGER ON public."profiles" TO "service_role";
REVOKE ALL ON public."pantry_items" FROM PUBLIC, anon, authenticated, service_role;
GRANT INSERT ON public."pantry_items" TO "postgres";
GRANT SELECT ON public."pantry_items" TO "postgres";
GRANT UPDATE ON public."pantry_items" TO "postgres";
GRANT DELETE ON public."pantry_items" TO "postgres";
GRANT TRUNCATE ON public."pantry_items" TO "postgres";
GRANT REFERENCES ON public."pantry_items" TO "postgres";
GRANT TRIGGER ON public."pantry_items" TO "postgres";
GRANT INSERT ON public."pantry_items" TO "anon";
GRANT SELECT ON public."pantry_items" TO "anon";
GRANT UPDATE ON public."pantry_items" TO "anon";
GRANT DELETE ON public."pantry_items" TO "anon";
GRANT TRUNCATE ON public."pantry_items" TO "anon";
GRANT REFERENCES ON public."pantry_items" TO "anon";
GRANT TRIGGER ON public."pantry_items" TO "anon";
GRANT INSERT ON public."pantry_items" TO "authenticated";
GRANT SELECT ON public."pantry_items" TO "authenticated";
GRANT UPDATE ON public."pantry_items" TO "authenticated";
GRANT DELETE ON public."pantry_items" TO "authenticated";
GRANT TRUNCATE ON public."pantry_items" TO "authenticated";
GRANT REFERENCES ON public."pantry_items" TO "authenticated";
GRANT TRIGGER ON public."pantry_items" TO "authenticated";
GRANT INSERT ON public."pantry_items" TO "service_role";
GRANT SELECT ON public."pantry_items" TO "service_role";
GRANT UPDATE ON public."pantry_items" TO "service_role";
GRANT DELETE ON public."pantry_items" TO "service_role";
GRANT TRUNCATE ON public."pantry_items" TO "service_role";
GRANT REFERENCES ON public."pantry_items" TO "service_role";
GRANT TRIGGER ON public."pantry_items" TO "service_role";
REVOKE ALL ON public."shopping_lists" FROM PUBLIC, anon, authenticated, service_role;
GRANT INSERT ON public."shopping_lists" TO "postgres";
GRANT SELECT ON public."shopping_lists" TO "postgres";
GRANT UPDATE ON public."shopping_lists" TO "postgres";
GRANT DELETE ON public."shopping_lists" TO "postgres";
GRANT TRUNCATE ON public."shopping_lists" TO "postgres";
GRANT REFERENCES ON public."shopping_lists" TO "postgres";
GRANT TRIGGER ON public."shopping_lists" TO "postgres";
GRANT INSERT ON public."shopping_lists" TO "anon";
GRANT SELECT ON public."shopping_lists" TO "anon";
GRANT UPDATE ON public."shopping_lists" TO "anon";
GRANT DELETE ON public."shopping_lists" TO "anon";
GRANT TRUNCATE ON public."shopping_lists" TO "anon";
GRANT REFERENCES ON public."shopping_lists" TO "anon";
GRANT TRIGGER ON public."shopping_lists" TO "anon";
GRANT INSERT ON public."shopping_lists" TO "authenticated";
GRANT SELECT ON public."shopping_lists" TO "authenticated";
GRANT UPDATE ON public."shopping_lists" TO "authenticated";
GRANT DELETE ON public."shopping_lists" TO "authenticated";
GRANT TRUNCATE ON public."shopping_lists" TO "authenticated";
GRANT REFERENCES ON public."shopping_lists" TO "authenticated";
GRANT TRIGGER ON public."shopping_lists" TO "authenticated";
GRANT INSERT ON public."shopping_lists" TO "service_role";
GRANT SELECT ON public."shopping_lists" TO "service_role";
GRANT UPDATE ON public."shopping_lists" TO "service_role";
GRANT DELETE ON public."shopping_lists" TO "service_role";
GRANT TRUNCATE ON public."shopping_lists" TO "service_role";
GRANT REFERENCES ON public."shopping_lists" TO "service_role";
GRANT TRIGGER ON public."shopping_lists" TO "service_role";
REVOKE ALL ON public."shopping_items" FROM PUBLIC, anon, authenticated, service_role;
GRANT INSERT ON public."shopping_items" TO "postgres";
GRANT SELECT ON public."shopping_items" TO "postgres";
GRANT UPDATE ON public."shopping_items" TO "postgres";
GRANT DELETE ON public."shopping_items" TO "postgres";
GRANT TRUNCATE ON public."shopping_items" TO "postgres";
GRANT REFERENCES ON public."shopping_items" TO "postgres";
GRANT TRIGGER ON public."shopping_items" TO "postgres";
GRANT INSERT ON public."shopping_items" TO "anon";
GRANT SELECT ON public."shopping_items" TO "anon";
GRANT UPDATE ON public."shopping_items" TO "anon";
GRANT DELETE ON public."shopping_items" TO "anon";
GRANT TRUNCATE ON public."shopping_items" TO "anon";
GRANT REFERENCES ON public."shopping_items" TO "anon";
GRANT TRIGGER ON public."shopping_items" TO "anon";
GRANT INSERT ON public."shopping_items" TO "authenticated";
GRANT SELECT ON public."shopping_items" TO "authenticated";
GRANT UPDATE ON public."shopping_items" TO "authenticated";
GRANT DELETE ON public."shopping_items" TO "authenticated";
GRANT TRUNCATE ON public."shopping_items" TO "authenticated";
GRANT REFERENCES ON public."shopping_items" TO "authenticated";
GRANT TRIGGER ON public."shopping_items" TO "authenticated";
GRANT INSERT ON public."shopping_items" TO "service_role";
GRANT SELECT ON public."shopping_items" TO "service_role";
GRANT UPDATE ON public."shopping_items" TO "service_role";
GRANT DELETE ON public."shopping_items" TO "service_role";
GRANT TRUNCATE ON public."shopping_items" TO "service_role";
GRANT REFERENCES ON public."shopping_items" TO "service_role";
GRANT TRIGGER ON public."shopping_items" TO "service_role";
REVOKE ALL ON public."weeks" FROM PUBLIC, anon, authenticated, service_role;
GRANT INSERT ON public."weeks" TO "postgres";
GRANT SELECT ON public."weeks" TO "postgres";
GRANT UPDATE ON public."weeks" TO "postgres";
GRANT DELETE ON public."weeks" TO "postgres";
GRANT TRUNCATE ON public."weeks" TO "postgres";
GRANT REFERENCES ON public."weeks" TO "postgres";
GRANT TRIGGER ON public."weeks" TO "postgres";
GRANT INSERT ON public."weeks" TO "anon";
GRANT SELECT ON public."weeks" TO "anon";
GRANT UPDATE ON public."weeks" TO "anon";
GRANT DELETE ON public."weeks" TO "anon";
GRANT TRUNCATE ON public."weeks" TO "anon";
GRANT REFERENCES ON public."weeks" TO "anon";
GRANT TRIGGER ON public."weeks" TO "anon";
GRANT INSERT ON public."weeks" TO "authenticated";
GRANT SELECT ON public."weeks" TO "authenticated";
GRANT UPDATE ON public."weeks" TO "authenticated";
GRANT DELETE ON public."weeks" TO "authenticated";
GRANT TRUNCATE ON public."weeks" TO "authenticated";
GRANT REFERENCES ON public."weeks" TO "authenticated";
GRANT TRIGGER ON public."weeks" TO "authenticated";
GRANT INSERT ON public."weeks" TO "service_role";
GRANT SELECT ON public."weeks" TO "service_role";
GRANT UPDATE ON public."weeks" TO "service_role";
GRANT DELETE ON public."weeks" TO "service_role";
GRANT TRUNCATE ON public."weeks" TO "service_role";
GRANT REFERENCES ON public."weeks" TO "service_role";
GRANT TRIGGER ON public."weeks" TO "service_role";
REVOKE ALL ON public."menu_generation_requests" FROM PUBLIC, anon, authenticated, service_role;
GRANT INSERT ON public."menu_generation_requests" TO "postgres";
GRANT SELECT ON public."menu_generation_requests" TO "postgres";
GRANT UPDATE ON public."menu_generation_requests" TO "postgres";
GRANT DELETE ON public."menu_generation_requests" TO "postgres";
GRANT TRUNCATE ON public."menu_generation_requests" TO "postgres";
GRANT REFERENCES ON public."menu_generation_requests" TO "postgres";
GRANT TRIGGER ON public."menu_generation_requests" TO "postgres";
GRANT INSERT ON public."menu_generation_requests" TO "anon";
GRANT SELECT ON public."menu_generation_requests" TO "anon";
GRANT UPDATE ON public."menu_generation_requests" TO "anon";
GRANT DELETE ON public."menu_generation_requests" TO "anon";
GRANT TRUNCATE ON public."menu_generation_requests" TO "anon";
GRANT REFERENCES ON public."menu_generation_requests" TO "anon";
GRANT TRIGGER ON public."menu_generation_requests" TO "anon";
GRANT INSERT ON public."menu_generation_requests" TO "authenticated";
GRANT SELECT ON public."menu_generation_requests" TO "authenticated";
GRANT UPDATE ON public."menu_generation_requests" TO "authenticated";
GRANT DELETE ON public."menu_generation_requests" TO "authenticated";
GRANT TRUNCATE ON public."menu_generation_requests" TO "authenticated";
GRANT REFERENCES ON public."menu_generation_requests" TO "authenticated";
GRANT TRIGGER ON public."menu_generation_requests" TO "authenticated";
GRANT INSERT ON public."menu_generation_requests" TO "service_role";
GRANT SELECT ON public."menu_generation_requests" TO "service_role";
GRANT UPDATE ON public."menu_generation_requests" TO "service_role";
GRANT DELETE ON public."menu_generation_requests" TO "service_role";
GRANT TRUNCATE ON public."menu_generation_requests" TO "service_role";
GRANT REFERENCES ON public."menu_generation_requests" TO "service_role";
GRANT TRIGGER ON public."menu_generation_requests" TO "service_role";
GRANT USAGE ON SCHEMA public TO PUBLIC, postgres, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public."rls_auto_enable"() TO PUBLIC;
GRANT EXECUTE ON FUNCTION public."rls_auto_enable"() TO "postgres";
GRANT EXECUTE ON FUNCTION public."rls_auto_enable"() TO "anon";
GRANT EXECUTE ON FUNCTION public."rls_auto_enable"() TO "authenticated";
GRANT EXECUTE ON FUNCTION public."rls_auto_enable"() TO "service_role";
GRANT EXECUTE ON FUNCTION public."set_updated_at"() TO PUBLIC;
GRANT EXECUTE ON FUNCTION public."set_updated_at"() TO "postgres";
GRANT EXECUTE ON FUNCTION public."set_updated_at"() TO "anon";
GRANT EXECUTE ON FUNCTION public."set_updated_at"() TO "authenticated";
GRANT EXECUTE ON FUNCTION public."set_updated_at"() TO "service_role";
CREATE SCHEMA becook_local;
REVOKE ALL ON SCHEMA becook_local FROM PUBLIC, anon, authenticated;
CREATE TABLE becook_local.identity (project text PRIMARY KEY CHECK (project = 'becook-iteration02'));
INSERT INTO becook_local.identity VALUES ('becook-iteration02');
