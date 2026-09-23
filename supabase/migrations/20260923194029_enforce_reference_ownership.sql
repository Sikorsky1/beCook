-- Incremental ownership integrity. Apply locally first; remote data needs reconciliation.
-- No row is changed and no RLS policy/grant is replaced.
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '120s';

-- Parent candidate keys; original single-column keys/FKs stay intact.
ALTER TABLE public.profiles
  ADD CONSTRAINT profiles_id_user_id_key UNIQUE (id, user_id);
ALTER TABLE public.weeks
  ADD CONSTRAINT weeks_id_user_id_key UNIQUE (id, user_id);
ALTER TABLE public.menu_generation_requests
  ADD CONSTRAINT menu_generation_requests_id_user_id_key UNIQUE (id, user_id);

-- MATCH SIMPLE permits a null optional reference. Do not allow a null owner
-- to disable validation of a non-null reference (including privileged writes).
ALTER TABLE public.weeks
  ADD CONSTRAINT weeks_references_require_owner_chk
  CHECK (user_id IS NOT NULL OR (profile_id IS NULL AND generation_request_id IS NULL));
ALTER TABLE public.pantry_items
  ADD CONSTRAINT pantry_items_references_require_owner_chk
  CHECK (user_id IS NOT NULL OR (profile_id IS NULL));
ALTER TABLE public.menu_generation_requests
  ADD CONSTRAINT menu_generation_requests_references_require_owner_chk
  CHECK (user_id IS NOT NULL OR (profile_id IS NULL AND created_week_id IS NULL));
ALTER TABLE public.profiles
  ADD CONSTRAINT profiles_references_require_owner_chk
  CHECK (user_id IS NOT NULL OR (active_week_id IS NULL));

-- SET NULL clears only the optional reference, never the row owner.
-- NO ACTION on parent key updates prevents a valid link changing ownership.
ALTER TABLE public.weeks
  ADD CONSTRAINT weeks_profile_id_owner_fkey
  FOREIGN KEY (profile_id, user_id) REFERENCES public.profiles (id, user_id)
  ON UPDATE NO ACTION ON DELETE SET NULL (profile_id);
ALTER TABLE public.weeks
  ADD CONSTRAINT weeks_generation_request_id_owner_fkey
  FOREIGN KEY (generation_request_id, user_id) REFERENCES public.menu_generation_requests (id, user_id)
  ON UPDATE NO ACTION ON DELETE SET NULL (generation_request_id);
ALTER TABLE public.pantry_items
  ADD CONSTRAINT pantry_items_profile_id_owner_fkey
  FOREIGN KEY (profile_id, user_id) REFERENCES public.profiles (id, user_id)
  ON UPDATE NO ACTION ON DELETE SET NULL (profile_id);
ALTER TABLE public.menu_generation_requests
  ADD CONSTRAINT menu_generation_requests_profile_id_owner_fkey
  FOREIGN KEY (profile_id, user_id) REFERENCES public.profiles (id, user_id)
  ON UPDATE NO ACTION ON DELETE SET NULL (profile_id);
ALTER TABLE public.menu_generation_requests
  ADD CONSTRAINT menu_generation_requests_created_week_id_owner_fkey
  FOREIGN KEY (created_week_id, user_id) REFERENCES public.weeks (id, user_id)
  ON UPDATE NO ACTION ON DELETE SET NULL (created_week_id);
ALTER TABLE public.profiles
  ADD CONSTRAINT profiles_active_week_id_owner_fkey
  FOREIGN KEY (active_week_id, user_id) REFERENCES public.weeks (id, user_id)
  ON UPDATE NO ACTION ON DELETE SET NULL (active_week_id);

COMMIT;
