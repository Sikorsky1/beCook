-- P37 (paso 37): deleting an account keeps its AI usage rows, without the owner.
-- The ledger is the record of what was spent this month: if the rows were deleted with the
-- account (ON DELETE CASCADE, A4), the global monthly budget would forget money already paid
-- and a user could delete and re-create the account to escape the cut-off. Now the rows stay
-- with user_id NULL (no e-mail, no profile and no content; ip_hash is a keyed hash).
--
-- Change: user_id loses NOT NULL; its FK to auth.users is recreated with ON DELETE SET NULL
-- (same name), added NOT VALID and validated in the same transaction. No row is modified and no
-- function, policy or grant changes: ai_begin_request still rejects a NULL p_user_id, quotas and
-- concurrency still filter by user_id = p_user_id (rows without owner count for nobody) and the
-- global budget and the per-IP limit keep counting every row.
--
-- Hosted (connector apply_migration): remove ONLY the BEGIN; and COMMIT; lines and keep the two
-- SET LOCAL lines. Procedure, verification and reversal: docs/development/progress-p37.md.
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '120s';

ALTER TABLE public.ai_usage_events ALTER COLUMN user_id DROP NOT NULL;

ALTER TABLE public.ai_usage_events DROP CONSTRAINT ai_usage_events_user_id_fkey;
ALTER TABLE public.ai_usage_events
  ADD CONSTRAINT ai_usage_events_user_id_fkey
  FOREIGN KEY (user_id) REFERENCES auth.users (id) ON DELETE SET NULL NOT VALID;
ALTER TABLE public.ai_usage_events VALIDATE CONSTRAINT ai_usage_events_user_id_fkey;

COMMIT;
