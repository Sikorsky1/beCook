-- Entirely fictional. Repeatable INSERT-only seed; no existing data is replaced.
BEGIN;
DO $$ BEGIN
 IF (SELECT project FROM becook_local.identity) IS DISTINCT FROM 'becook-iteration02' THEN
  RAISE EXCEPTION 'Local identity required';
 END IF;
END $$;
INSERT INTO auth.users (id, instance_id, aud, role, email, encrypted_password,
 email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
 confirmation_token, recovery_token, email_change_token_new, email_change)
SELECT ('00000000-0000-4000-8000-00000000000' || n)::uuid,
 '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
 'fixture-' || n || '@example.invalid',
 extensions.crypt('Local-fixture-only-2026!', extensions.gen_salt('bf')),
 now(), '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb, now(), now(), '', '', '', ''
FROM generate_series(1,2) n ON CONFLICT (id) DO NOTHING;
INSERT INTO auth.identities (id, user_id, provider_id, identity_data, provider, created_at, updated_at)
SELECT ('90000000-0000-4000-8000-00000000000' || n)::uuid,
 ('00000000-0000-4000-8000-00000000000' || n)::uuid,
 '00000000-0000-4000-8000-00000000000' || n,
 jsonb_build_object('sub','00000000-0000-4000-8000-00000000000' || n, 'email','fixture-' || n || '@example.invalid', 'email_verified',true),
 'email', now(), now()
FROM generate_series(1,2) n ON CONFLICT (id) DO NOTHING;
INSERT INTO public.profiles (id,user_id,sex,birth_date,height_cm,weight_kg,household_size,
 weekly_training_days,training_types,goal,goals,dietary_restrictions,allergies,disliked_foods)
VALUES
 ('10000000-0000-4000-8000-000000000001','00000000-0000-4000-8000-000000000001',
 'female','1990-01-01',165,65,1,2,ARRAY['yoga_pilates'],'healthy_eating',ARRAY['healthy_eating'],ARRAY['vegetarian'],ARRAY['nuts'],'rábano ficticio'),
 ('10000000-0000-4000-8000-000000000002','00000000-0000-4000-8000-000000000002',
 'male','1992-01-01',180,80,2,3,ARRAY['strength'],'muscle_gain',ARRAY['muscle_gain'],ARRAY['no_pork'],ARRAY['lactose'],'nabo ficticio')
ON CONFLICT (id) DO NOTHING;
INSERT INTO public.weeks (id,user_id,profile_id,title,iso_year,iso_week)
SELECT ('20000000-0000-4000-8000-00000000000' || n)::uuid,
 ('00000000-0000-4000-8000-00000000000' || n)::uuid,
 ('10000000-0000-4000-8000-00000000000' || n)::uuid,
 'Semana sintética ' || n,2026,38+n
FROM generate_series(1,2) n ON CONFLICT (id) DO NOTHING;
INSERT INTO public.week_days (id,week_id,day_name,position,lunch_status,lunch_dish_name,dinner_status,dinner_dish_name)
SELECT ('30000000-0000-4000-8000-00000000000' || n)::uuid,
 ('20000000-0000-4000-8000-00000000000' || n)::uuid,
 'Lunes',0,'planned','Garbanzos con espinacas','planned','Arroz con verduras'
FROM generate_series(1,2) n ON CONFLICT (id) DO NOTHING;
INSERT INTO public.shopping_lists (id,week_id)
SELECT ('40000000-0000-4000-8000-00000000000' || n)::uuid,
 ('20000000-0000-4000-8000-00000000000' || n)::uuid
FROM generate_series(1,2) n ON CONFLICT (id) DO NOTHING;
INSERT INTO public.shopping_items (id,shopping_list_id,name,quantity,unit,category,checked)
SELECT ('50000000-0000-4000-8000-0000000000' || n || i)::uuid,
 ('40000000-0000-4000-8000-00000000000' || n)::uuid,
 CASE WHEN i=1 THEN 'Arroz sintético' ELSE 'Espinaca sintética' END,
 1,'kg','despensa',i=1
FROM generate_series(1,2) n CROSS JOIN generate_series(1,2) i ON CONFLICT (id) DO NOTHING;
INSERT INTO public.menu_generation_requests (id,user_id,profile_id,created_week_id,people_count,status,free_text_prompt)
SELECT ('60000000-0000-4000-8000-00000000000' || n)::uuid,
 ('00000000-0000-4000-8000-00000000000' || n)::uuid,
 ('10000000-0000-4000-8000-00000000000' || n)::uuid,
 ('20000000-0000-4000-8000-00000000000' || n)::uuid,n,'draft','Petición sintética sin IA'
FROM generate_series(1,2) n ON CONFLICT (id) DO NOTHING;
INSERT INTO public.pantry_items (id,user_id,profile_id,name,category,active)
SELECT ('70000000-0000-4000-8000-0000000000' || n || i)::uuid,
 ('00000000-0000-4000-8000-00000000000' || n)::uuid,
 ('10000000-0000-4000-8000-00000000000' || n)::uuid,
 CASE WHEN i=1 THEN 'Lenteja sintética' ELSE 'Sal sintética' END,'básicos',i=1
FROM generate_series(1,2) n CROSS JOIN generate_series(1,2) i ON CONFLICT (id) DO NOTHING;
COMMIT;
