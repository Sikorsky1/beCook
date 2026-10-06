-- A4: server-side AI usage ledger, quotas, concurrency, per-IP limit and global budget.
-- Additive only: one new table and two functions. No existing row, policy or grant changes.
-- Writes happen exclusively through the SECURITY DEFINER functions, executable by service_role.
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '120s';

CREATE TABLE public.ai_usage_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users (id) ON DELETE CASCADE,
  flow text NOT NULL CONSTRAINT ai_usage_events_flow_chk CHECK (flow IN ('menu', 'import', 'shopping')),
  status text NOT NULL CONSTRAINT ai_usage_events_status_chk CHECK (status IN ('started', 'succeeded', 'failed', 'rejected')),
  reject_reason text,
  model text,
  prompt_tokens integer CONSTRAINT ai_usage_events_prompt_tokens_chk CHECK (prompt_tokens >= 0),
  completion_tokens integer CONSTRAINT ai_usage_events_completion_tokens_chk CHECK (completion_tokens >= 0),
  cost_usd numeric(10, 6) CONSTRAINT ai_usage_events_cost_usd_chk CHECK (cost_usd >= 0),
  latency_ms integer CONSTRAINT ai_usage_events_latency_ms_chk CHECK (latency_ms >= 0),
  request_id uuid NOT NULL CONSTRAINT ai_usage_events_request_id_key UNIQUE,
  ip_hash text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz
);

CREATE INDEX ai_usage_events_user_flow_created_idx
  ON public.ai_usage_events (user_id, flow, created_at);
CREATE INDEX ai_usage_events_ip_created_idx
  ON public.ai_usage_events (ip_hash, created_at);

-- RLS on, no policies: no client role can see or change usage rows.
ALTER TABLE public.ai_usage_events ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.ai_usage_events FROM PUBLIC, anon, authenticated;

-- p_limits: {"daily": int|null, "monthly": int|null, "max_concurrent": int,
--            "ip_hourly": int, "monthly_budget_usd": numeric}. Figures live in server env.
CREATE FUNCTION public.ai_begin_request(
  p_user_id uuid,
  p_flow text,
  p_ip_hash text,
  p_request_id uuid,
  p_limits jsonb
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_now timestamptz := now();
  v_local timestamp := now() AT TIME ZONE 'Europe/Madrid';
  v_day_start timestamptz := date_trunc('day', v_local) AT TIME ZONE 'Europe/Madrid';
  v_next_day timestamptz := (date_trunc('day', v_local) + interval '1 day') AT TIME ZONE 'Europe/Madrid';
  v_month_start timestamptz := date_trunc('month', v_local) AT TIME ZONE 'Europe/Madrid';
  v_next_month timestamptz := (date_trunc('month', v_local) + interval '1 month') AT TIME ZONE 'Europe/Madrid';
  v_daily integer := (p_limits ->> 'daily')::integer;
  v_monthly integer := (p_limits ->> 'monthly')::integer;
  v_max_concurrent integer := (p_limits ->> 'max_concurrent')::integer;
  v_ip_hourly integer := (p_limits ->> 'ip_hourly')::integer;
  v_budget numeric := (p_limits ->> 'monthly_budget_usd')::numeric;
  v_reason text;
  v_retry_after integer;
  v_count integer;
  v_oldest timestamptz;
  v_spent numeric;
  v_id uuid;
BEGIN
  IF p_user_id IS NULL OR p_request_id IS NULL OR coalesce(p_ip_hash, '') = '' THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'ai_begin_request: missing identity';
  END IF;
  IF p_flow NOT IN ('menu', 'import', 'shopping') THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'ai_begin_request: invalid flow';
  END IF;
  IF v_max_concurrent IS NULL OR v_ip_hourly IS NULL OR v_budget IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'ai_begin_request: incomplete limits';
  END IF;

  -- Serialise per user, then per IP (always in this order, so no lock cycles).
  PERFORM pg_advisory_xact_lock(hashtextextended('ai_usage:user:' || p_user_id::text, 0));
  PERFORM pg_advisory_xact_lock(hashtextextended('ai_usage:ip:' || p_ip_hash, 0));

  -- Requests stuck in 'started' (killed function, lost finish) expire after 2 minutes.
  UPDATE public.ai_usage_events
     SET status = 'failed', reject_reason = 'expired', finished_at = v_now
   WHERE user_id = p_user_id AND status = 'started' AND created_at < v_now - interval '2 minutes';

  -- 1. Global monthly budget (finished requests; in-flight ones are not yet costed).
  SELECT coalesce(sum(cost_usd), 0) INTO v_spent
    FROM public.ai_usage_events
   WHERE created_at >= v_month_start AND status IN ('succeeded', 'failed');
  IF v_spent >= v_budget THEN
    v_reason := 'budget_exhausted';
    v_retry_after := ceil(extract(epoch FROM v_next_month - v_now));
  END IF;

  -- 2. Concurrent requests for this user.
  IF v_reason IS NULL THEN
    SELECT count(*), min(created_at) INTO v_count, v_oldest
      FROM public.ai_usage_events
     WHERE user_id = p_user_id AND status = 'started';
    IF v_count >= v_max_concurrent THEN
      v_reason := 'concurrency';
      v_retry_after := greatest(1, ceil(extract(epoch FROM v_oldest + interval '2 minutes' - v_now)));
    END IF;
  END IF;

  -- 3. Daily and monthly quota per flow. Failures that consumed no tokens are free.
  IF v_reason IS NULL AND v_daily IS NOT NULL THEN
    SELECT count(*) INTO v_count
      FROM public.ai_usage_events
     WHERE user_id = p_user_id AND flow = p_flow AND created_at >= v_day_start
       AND (status IN ('started', 'succeeded')
            OR (status = 'failed' AND coalesce(prompt_tokens, 0) + coalesce(completion_tokens, 0) > 0));
    IF v_count >= v_daily THEN
      v_reason := 'daily_quota';
      v_retry_after := ceil(extract(epoch FROM v_next_day - v_now));
    END IF;
  END IF;
  IF v_reason IS NULL AND v_monthly IS NOT NULL THEN
    SELECT count(*) INTO v_count
      FROM public.ai_usage_events
     WHERE user_id = p_user_id AND flow = p_flow AND created_at >= v_month_start
       AND (status IN ('started', 'succeeded')
            OR (status = 'failed' AND coalesce(prompt_tokens, 0) + coalesce(completion_tokens, 0) > 0));
    IF v_count >= v_monthly THEN
      v_reason := 'monthly_quota';
      v_retry_after := ceil(extract(epoch FROM v_next_month - v_now));
    END IF;
  END IF;

  -- 4. Requests from the same network in the last hour, any user and flow.
  IF v_reason IS NULL THEN
    SELECT count(*), min(created_at) INTO v_count, v_oldest
      FROM public.ai_usage_events
     WHERE ip_hash = p_ip_hash AND status <> 'rejected' AND created_at > v_now - interval '1 hour';
    IF v_count >= v_ip_hourly THEN
      v_reason := 'ip_rate';
      v_retry_after := greatest(1, ceil(extract(epoch FROM v_oldest + interval '1 hour' - v_now)));
    END IF;
  END IF;

  IF v_reason IS NOT NULL THEN
    INSERT INTO public.ai_usage_events (user_id, flow, status, reject_reason, request_id, ip_hash, finished_at)
    VALUES (p_user_id, p_flow, 'rejected', v_reason, p_request_id, p_ip_hash, v_now)
    RETURNING id INTO v_id;
    RETURN jsonb_build_object('allowed', false, 'id', v_id, 'reason', v_reason,
                              'retry_after_seconds', v_retry_after);
  END IF;

  INSERT INTO public.ai_usage_events (user_id, flow, status, request_id, ip_hash)
  VALUES (p_user_id, p_flow, 'started', p_request_id, p_ip_hash)
  RETURNING id INTO v_id;
  RETURN jsonb_build_object('allowed', true, 'id', v_id, 'reason', NULL, 'retry_after_seconds', NULL);
END $$;

CREATE FUNCTION public.ai_finish_request(
  p_id uuid,
  p_status text,
  p_model text,
  p_prompt_tokens integer,
  p_completion_tokens integer,
  p_cost_usd numeric,
  p_latency_ms integer,
  p_reason text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_local timestamp := now() AT TIME ZONE 'Europe/Madrid';
  v_month_start timestamptz := date_trunc('month', v_local) AT TIME ZONE 'Europe/Madrid';
  v_updated integer;
  v_spent numeric;
BEGIN
  IF p_status NOT IN ('succeeded', 'failed') THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'ai_finish_request: invalid status';
  END IF;

  -- Only an open request can be closed; expired or finished rows stay untouched.
  UPDATE public.ai_usage_events
     SET status = p_status, reject_reason = p_reason, model = p_model,
         prompt_tokens = p_prompt_tokens, completion_tokens = p_completion_tokens,
         cost_usd = p_cost_usd, latency_ms = p_latency_ms, finished_at = now()
   WHERE id = p_id AND status = 'started';
  GET DIAGNOSTICS v_updated = ROW_COUNT;

  SELECT coalesce(sum(cost_usd), 0) INTO v_spent
    FROM public.ai_usage_events
   WHERE created_at >= v_month_start AND status IN ('succeeded', 'failed');

  RETURN jsonb_build_object(
    'updated', v_updated = 1,
    'month_cost_usd', v_spent,
    'previous_month_cost_usd', CASE WHEN v_updated = 1 THEN v_spent - coalesce(p_cost_usd, 0) ELSE v_spent END
  );
END $$;

REVOKE ALL ON FUNCTION public.ai_begin_request(uuid, text, text, uuid, jsonb) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.ai_finish_request(uuid, text, text, integer, integer, numeric, integer, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.ai_begin_request(uuid, text, text, uuid, jsonb) TO service_role;
GRANT EXECUTE ON FUNCTION public.ai_finish_request(uuid, text, text, integer, integer, numeric, integer, text) TO service_role;

COMMIT;
