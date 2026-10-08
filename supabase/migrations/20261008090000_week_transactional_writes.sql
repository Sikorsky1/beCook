-- B4 (roadmap step 10, audit H8): transactional week writes.
-- Additive: two columns on weeks, UNIQUE (week_id, position) on week_days, one trigger and two
-- SECURITY INVOKER functions (RLS and ownership apply as for any client write).
-- Applied remotely only by Sergio (becook-preview first, then becook with explicit OK).
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '120s';

-- version: integer bumped by every UPDATE of the week, whatever the write path (functions below,
-- or the previous client still deployed while this rolls out). updated_at stays a timestamp
-- (shopping-list freshness keeps using it). request_keys: the last 20 applied request keys, so a
-- repeated request is recognised and changes nothing.
ALTER TABLE public.weeks
  ADD COLUMN version bigint NOT NULL DEFAULT 1,
  ADD COLUMN request_keys uuid[] NOT NULL DEFAULT '{}';
ALTER TABLE public.weeks
  ADD CONSTRAINT weeks_request_keys_max_chk CHECK (cardinality(request_keys) <= 20);

-- One row per day of a week (production: 0 duplicated positions on 2026-10-08).
ALTER TABLE public.week_days
  ADD CONSTRAINT week_days_week_id_position_key UNIQUE (week_id, position);

CREATE FUNCTION public.weeks_set_version()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    NEW.version := 1;
  ELSE
    NEW.version := OLD.version + 1;
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.weeks_set_version() FROM PUBLIC, anon, authenticated, service_role;

CREATE TRIGGER set_weeks_version BEFORE INSERT OR UPDATE ON public.weeks
  FOR EACH ROW EXECUTE FUNCTION public.weeks_set_version();

-- Applies or replaces a whole calendar week of the caller in one transaction.
-- p_days: [{position 0–6, day_name, lunch_status, lunch_dish_name, dinner_status, dinner_dish_name}],
-- 1–7 distinct days (partial imports keep only their days); days not sent are removed.
-- Result: {status: applied | duplicate | conflict, week_id, version, updated_at}.
--   duplicate: p_request_key was already applied to this week; nothing changes.
--   conflict: without p_overwrite, the week's version is not p_expected_version
--             (NULL = "I expect no week"); nothing changes.
-- Any error (validation, constraint, foreign generation request) rolls everything back.
CREATE FUNCTION public.apply_week(
  p_iso_year integer,
  p_iso_week integer,
  p_days jsonb,
  p_request_key uuid,
  p_expected_version bigint DEFAULT NULL,
  p_overwrite boolean DEFAULT false,
  p_generation_request_id uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
  v_user uuid := auth.uid();
  v_names constant text[] := ARRAY['Lunes','Martes','Miércoles','Jueves','Viernes','Sábado','Domingo'];
  v_week public.weeks%ROWTYPE;
  v_positions integer[];
  v_count integer;
BEGIN
  IF v_user IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'apply_week: authentication required';
  END IF;
  IF p_request_key IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'apply_week: request key required';
  END IF;
  IF p_iso_year IS NULL OR p_iso_week IS NULL OR p_iso_year NOT BETWEEN 2000 AND 2100
     OR p_iso_week < 1 OR p_iso_week > extract(week FROM make_date(p_iso_year, 12, 28)) THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'apply_week: invalid ISO week';
  END IF;
  IF jsonb_typeof(p_days) IS DISTINCT FROM 'array' OR jsonb_array_length(p_days) NOT BETWEEN 1 AND 7 THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'apply_week: 1 to 7 days required';
  END IF;

  SELECT count(*), array_agg(DISTINCT d.position) INTO v_count, v_positions
  FROM jsonb_to_recordset(p_days) AS d(position integer, day_name text, lunch_status text,
    lunch_dish_name text, dinner_status text, dinner_dish_name text)
  WHERE d.position BETWEEN 0 AND 6
    AND d.day_name = v_names[d.position + 1]
    AND d.lunch_status IN ('planned', 'free') AND d.dinner_status IN ('planned', 'free')
    AND char_length(coalesce(d.lunch_dish_name, '')) <= 200
    AND char_length(coalesce(d.dinner_dish_name, '')) <= 200;
  IF v_count <> jsonb_array_length(p_days) OR cardinality(v_positions) <> v_count THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'apply_week: invalid or repeated day';
  END IF;

  -- Create the week if missing; a concurrent creator waits here and then sees the committed row.
  INSERT INTO public.weeks (user_id, iso_year, iso_week, title, generation_request_id, request_keys)
  VALUES (v_user, p_iso_year, p_iso_week, '', p_generation_request_id, ARRAY[p_request_key])
  ON CONFLICT (user_id, iso_year, iso_week)
    WHERE user_id IS NOT NULL AND iso_year IS NOT NULL AND iso_week IS NOT NULL
    DO NOTHING
  RETURNING * INTO v_week;

  IF NOT FOUND THEN
    SELECT * INTO v_week FROM public.weeks
    WHERE user_id = v_user AND iso_year = p_iso_year AND iso_week = p_iso_week
    FOR UPDATE;
    IF NOT FOUND THEN
      RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'apply_week: week not accessible';
    END IF;
    IF p_request_key = ANY (v_week.request_keys) THEN
      RETURN jsonb_build_object('status', 'duplicate', 'week_id', v_week.id,
        'version', v_week.version, 'updated_at', v_week.updated_at);
    END IF;
    IF NOT p_overwrite AND v_week.version IS DISTINCT FROM p_expected_version THEN
      RETURN jsonb_build_object('status', 'conflict', 'week_id', v_week.id,
        'version', v_week.version, 'updated_at', v_week.updated_at);
    END IF;
    -- title is kept: the app never shows or sets it, and replacing the days must not lose it.
    UPDATE public.weeks
    SET generation_request_id = coalesce(p_generation_request_id, generation_request_id),
        request_keys = (ARRAY[p_request_key] || request_keys)[1:20]
    WHERE id = v_week.id
    RETURNING * INTO v_week;
  END IF;

  INSERT INTO public.week_days (week_id, day_name, position, lunch_status, lunch_dish_name,
    dinner_status, dinner_dish_name)
  SELECT v_week.id, d.day_name, d.position, d.lunch_status,
    CASE WHEN d.lunch_status = 'free' THEN '' ELSE coalesce(d.lunch_dish_name, '') END,
    d.dinner_status,
    CASE WHEN d.dinner_status = 'free' THEN '' ELSE coalesce(d.dinner_dish_name, '') END
  FROM jsonb_to_recordset(p_days) AS d(position integer, day_name text, lunch_status text,
    lunch_dish_name text, dinner_status text, dinner_dish_name text)
  ON CONFLICT (week_id, position) DO UPDATE
  SET day_name = EXCLUDED.day_name,
      lunch_status = EXCLUDED.lunch_status, lunch_dish_name = EXCLUDED.lunch_dish_name,
      dinner_status = EXCLUDED.dinner_status, dinner_dish_name = EXCLUDED.dinner_dish_name;

  DELETE FROM public.week_days WHERE week_id = v_week.id AND position <> ALL (v_positions);

  IF p_generation_request_id IS NOT NULL THEN
    UPDATE public.menu_generation_requests
    SET status = 'applied', created_week_id = v_week.id
    WHERE id = p_generation_request_id AND user_id = v_user;
    IF NOT FOUND THEN
      RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'apply_week: generation request not found';
    END IF;
  END IF;

  RETURN jsonb_build_object('status', 'applied', 'week_id', v_week.id,
    'version', v_week.version, 'updated_at', v_week.updated_at);
END;
$$;

-- Updates one meal (lunch or dinner) of one existing day of the caller's week, if the week is still
-- at p_expected_version. Same result shape as apply_week; conflict also when the week or day is gone.
CREATE FUNCTION public.update_week_slot(
  p_iso_year integer,
  p_iso_week integer,
  p_position integer,
  p_meal text,
  p_status text,
  p_dish_name text,
  p_expected_version bigint,
  p_request_key uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
  v_user uuid := auth.uid();
  v_week public.weeks%ROWTYPE;
  v_dish text := CASE WHEN p_status = 'free' THEN '' ELSE coalesce(p_dish_name, '') END;
BEGIN
  IF v_user IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'update_week_slot: authentication required';
  END IF;
  IF p_request_key IS NULL OR p_expected_version IS NULL OR p_position NOT BETWEEN 0 AND 6
     OR p_meal NOT IN ('lunch', 'dinner') OR p_status NOT IN ('planned', 'free')
     OR char_length(v_dish) > 200 THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'update_week_slot: invalid slot';
  END IF;

  SELECT * INTO v_week FROM public.weeks
  WHERE user_id = v_user AND iso_year = p_iso_year AND iso_week = p_iso_week
  FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('status', 'conflict', 'week_id', NULL, 'version', NULL, 'updated_at', NULL);
  END IF;
  IF p_request_key = ANY (v_week.request_keys) THEN
    RETURN jsonb_build_object('status', 'duplicate', 'week_id', v_week.id,
      'version', v_week.version, 'updated_at', v_week.updated_at);
  END IF;
  IF v_week.version <> p_expected_version THEN
    RETURN jsonb_build_object('status', 'conflict', 'week_id', v_week.id,
      'version', v_week.version, 'updated_at', v_week.updated_at);
  END IF;

  UPDATE public.week_days
  SET lunch_status = CASE WHEN p_meal = 'lunch' THEN p_status ELSE lunch_status END,
      lunch_dish_name = CASE WHEN p_meal = 'lunch' THEN v_dish ELSE lunch_dish_name END,
      dinner_status = CASE WHEN p_meal = 'dinner' THEN p_status ELSE dinner_status END,
      dinner_dish_name = CASE WHEN p_meal = 'dinner' THEN v_dish ELSE dinner_dish_name END
  WHERE week_id = v_week.id AND position = p_position;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('status', 'conflict', 'week_id', v_week.id,
      'version', v_week.version, 'updated_at', v_week.updated_at);
  END IF;

  UPDATE public.weeks
  SET request_keys = (ARRAY[p_request_key] || request_keys)[1:20]
  WHERE id = v_week.id
  RETURNING * INTO v_week;

  RETURN jsonb_build_object('status', 'applied', 'week_id', v_week.id,
    'version', v_week.version, 'updated_at', v_week.updated_at);
END;
$$;

REVOKE ALL ON FUNCTION public.apply_week(integer, integer, jsonb, uuid, bigint, boolean, uuid)
  FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.apply_week(integer, integer, jsonb, uuid, bigint, boolean, uuid)
  TO authenticated;
REVOKE ALL ON FUNCTION public.update_week_slot(integer, integer, integer, text, text, text, bigint, uuid)
  FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.update_week_slot(integer, integer, integer, text, text, text, bigint, uuid)
  TO authenticated;
