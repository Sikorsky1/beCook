-- C2 (roadmap step 17, audit H6 phase 3): versioned dish cards that week slots point to.
-- Additive: two tables (recipes, recipe_versions), two nullable columns on week_days, triggers and
-- RPCs. apply_week is redefined with the SAME signature (it now also reads optional recipe links);
-- update_week_slot is not modified. Existing rows keep NULL links (history: title only).
-- The catalogue identities (27 recipes of src/data/nutritionist-recipes.json) are inserted WITHOUT
-- a reviewed version: there are no reviewed ingredients yet and none are invented here.
-- Applied remotely only by Sergio (becook-preview first, then becook with explicit OK).
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '120s';

-- Title key: case and whitespace do not make a different dish («Tortilla de patata » = «tortilla
-- de  Patata»). Accents do. Same rule as recipeTitleKey() in src/lib/recipes/card.ts.
CREATE FUNCTION public.recipe_title_key(p_title text)
RETURNS text
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
SET search_path = ''
AS $$
  SELECT lower(btrim(regexp_replace(coalesce(p_title, ''), '\s+', ' ', 'g')));
$$;

-- EU-14 allergens a card may list as possible (a closed list; never a guarantee of absence).
CREATE FUNCTION public.recipe_allergen_keys()
RETURNS text[]
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
SET search_path = ''
AS $$
  SELECT ARRAY['gluten', 'crustaceans', 'eggs', 'fish', 'peanuts', 'soy', 'milk', 'nuts', 'celery',
    'mustard', 'sesame', 'sulphites', 'lupin', 'molluscs']::text[];
$$;

-- NULL when the ingredient list is valid: 1–40 objects {name, quantity|null, unit|null, category,
-- optional} with exactly those keys; category from supermarketCategoryLabels (src/lib/shoppingList.ts).
CREATE FUNCTION public.recipe_ingredients_issue(p_ingredients jsonb)
RETURNS text
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
SET search_path = ''
AS $$
  SELECT CASE
    WHEN jsonb_typeof(p_ingredients) IS DISTINCT FROM 'array' THEN 'ingredients_not_array'
    WHEN jsonb_array_length(p_ingredients) NOT BETWEEN 1 AND 40 THEN 'ingredients_count'
    WHEN octet_length(p_ingredients::text) > 12000 THEN 'ingredients_size'
    WHEN EXISTS (
      SELECT 1 FROM jsonb_array_elements(p_ingredients) AS i(item)
      WHERE jsonb_typeof(i.item) IS DISTINCT FROM 'object'
        OR (SELECT array_agg(k ORDER BY k) FROM jsonb_object_keys(i.item) AS k)
           IS DISTINCT FROM ARRAY['category', 'name', 'optional', 'quantity', 'unit']
        OR jsonb_typeof(i.item -> 'name') IS DISTINCT FROM 'string'
        OR char_length(btrim(i.item ->> 'name')) NOT BETWEEN 1 AND 80
        OR jsonb_typeof(i.item -> 'quantity') NOT IN ('number', 'null')
        OR (jsonb_typeof(i.item -> 'quantity') = 'number'
            AND ((i.item ->> 'quantity')::numeric <= 0 OR (i.item ->> 'quantity')::numeric > 100000))
        OR jsonb_typeof(i.item -> 'unit') NOT IN ('string', 'null')
        OR (jsonb_typeof(i.item -> 'unit') = 'string' AND char_length(btrim(i.item ->> 'unit')) NOT BETWEEN 1 AND 20)
        OR (i.item ->> 'category') IS NULL
        OR (i.item ->> 'category') NOT IN ('frutería', 'carnicería', 'pescadería', 'lácteos', 'despensa', 'congelados', 'otros')
        OR jsonb_typeof(i.item -> 'optional') IS DISTINCT FROM 'boolean'
    ) THEN 'ingredient_invalid'
    ELSE NULL
  END;
$$;

-- NULL when the steps are 1–20 non-empty texts of at most 400 characters.
CREATE FUNCTION public.recipe_steps_issue(p_steps jsonb)
RETURNS text
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
SET search_path = ''
AS $$
  SELECT CASE
    WHEN jsonb_typeof(p_steps) IS DISTINCT FROM 'array' THEN 'steps_not_array'
    WHEN jsonb_array_length(p_steps) NOT BETWEEN 1 AND 20 THEN 'steps_count'
    WHEN EXISTS (
      SELECT 1 FROM jsonb_array_elements(p_steps) AS s(step)
      WHERE jsonb_typeof(s.step) IS DISTINCT FROM 'string'
        OR char_length(btrim(s.step #>> '{}')) NOT BETWEEN 1 AND 400
    ) THEN 'step_invalid'
    ELSE NULL
  END;
$$;

-- Identity of a dish. owner_user_id NULL = global catalogue (catalog_key = id in
-- nutritionist-recipes.json); otherwise a card the user asked for (origin ai) or wrote (user).
CREATE TABLE public.recipes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE,
  catalog_key text UNIQUE,
  title text NOT NULL CHECK (char_length(btrim(title)) BETWEEN 1 AND 200),
  title_key text GENERATED ALWAYS AS (public.recipe_title_key(title)) STORED,
  origin text NOT NULL CHECK (origin IN ('catalog', 'ai', 'user')),
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT recipes_catalog_owner_chk CHECK ((origin = 'catalog') = (owner_user_id IS NULL)),
  CONSTRAINT recipes_catalog_key_chk CHECK ((origin = 'catalog') = (catalog_key IS NOT NULL)
    AND (catalog_key IS NULL OR char_length(catalog_key) BETWEEN 1 AND 40)),
  -- One recipe per title and owner; the catalogue (NULL owner) is one owner too.
  CONSTRAINT recipes_owner_title_key UNIQUE NULLS NOT DISTINCT (owner_user_id, title_key)
);

-- One immutable version of a card. A week slot points to a version, never to "the latest".
--   review_status: reviewed (catalogue only, checked by a person) | inferred (estimated by AI from
--   the title, never presented as verified). content_hash: of the card content (rc1: + md5).
CREATE TABLE public.recipe_versions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  recipe_id uuid NOT NULL REFERENCES public.recipes(id) ON DELETE CASCADE,
  version integer NOT NULL CHECK (version BETWEEN 1 AND 1000),
  base_servings smallint NOT NULL CHECK (base_servings BETWEEN 1 AND 12),
  total_minutes smallint CHECK (total_minutes BETWEEN 1 AND 720),
  ingredients jsonb NOT NULL CHECK (public.recipe_ingredients_issue(ingredients) IS NULL),
  steps jsonb NOT NULL CHECK (public.recipe_steps_issue(steps) IS NULL),
  possible_allergens text[] NOT NULL DEFAULT '{}'
    CHECK (possible_allergens <@ public.recipe_allergen_keys() AND array_position(possible_allergens, NULL) IS NULL),
  review_status text NOT NULL CHECK (review_status IN ('reviewed', 'inferred')),
  inferred_model text CHECK (char_length(inferred_model) BETWEEN 1 AND 80),
  content_hash text NOT NULL CHECK (char_length(content_hash) <= 80),
  request_key uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT recipe_versions_recipe_id_version_key UNIQUE (recipe_id, version),
  CONSTRAINT recipe_versions_model_chk CHECK (review_status = 'inferred' OR inferred_model IS NULL)
);
CREATE UNIQUE INDEX recipe_versions_request_key_idx ON public.recipe_versions (request_key) WHERE request_key IS NOT NULL;

-- Content hash of a card: same content, same hash (allergens in canonical order).
CREATE FUNCTION public.recipe_content_hash(
  p_base_servings integer,
  p_total_minutes integer,
  p_ingredients jsonb,
  p_steps jsonb,
  p_allergens text[]
)
RETURNS text
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
SET search_path = ''
AS $$
  SELECT 'rc1:' || md5(jsonb_build_object(
    'baseServings', p_base_servings,
    'totalMinutes', p_total_minutes,
    'ingredients', p_ingredients,
    'steps', p_steps,
    'possibleAllergens', coalesce((SELECT jsonb_agg(DISTINCT a ORDER BY a) FROM unnest(p_allergens) AS a), '[]'::jsonb)
  )::text);
$$;

-- Versions: a user's recipe only gets inferred versions; only the catalogue gets reviewed ones.
-- The hash is always computed here. Versions never change and are never deleted directly
-- (deleting a recipe or its owner cascades; a version used by a week slot is kept by the FK).
CREATE FUNCTION public.recipe_versions_guard()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_owner uuid;
BEGIN
  IF TG_OP = 'INSERT' THEN
    SELECT owner_user_id INTO v_owner FROM public.recipes WHERE id = NEW.recipe_id;
    IF FOUND AND (v_owner IS NULL) <> (NEW.review_status = 'reviewed') THEN
      RAISE EXCEPTION USING ERRCODE = '23514',
        MESSAGE = 'recipe_versions: only catalogue recipes have reviewed versions, and only reviewed ones';
    END IF;
    NEW.content_hash := public.recipe_content_hash(NEW.base_servings, NEW.total_minutes, NEW.ingredients,
      NEW.steps, NEW.possible_allergens);
    RETURN NEW;
  END IF;
  IF TG_OP = 'DELETE' AND pg_trigger_depth() > 1 THEN
    RETURN OLD;
  END IF;
  RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'recipe_versions: versions are immutable';
END;
$$;
REVOKE ALL ON FUNCTION public.recipe_versions_guard() FROM PUBLIC, anon, authenticated, service_role;

CREATE TRIGGER recipe_versions_guard BEFORE INSERT OR UPDATE OR DELETE ON public.recipe_versions
  FOR EACH ROW EXECUTE FUNCTION public.recipe_versions_guard();

-- A recipe's identity (owner, title, catalogue key) never changes once created.
CREATE FUNCTION public.recipes_immutable()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'recipes: identity is immutable';
END;
$$;
REVOKE ALL ON FUNCTION public.recipes_immutable() FROM PUBLIC, anon, authenticated, service_role;

CREATE TRIGGER recipes_immutable BEFORE UPDATE ON public.recipes
  FOR EACH ROW EXECUTE FUNCTION public.recipes_immutable();

CREATE INDEX recipes_owner_user_id_idx ON public.recipes (owner_user_id);

-- Reads: the catalogue for everyone (guests included), own cards for their owner. No direct writes.
ALTER TABLE public.recipes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.recipe_versions ENABLE ROW LEVEL SECURITY;
CREATE POLICY recipes_select_catalog ON public.recipes
  FOR SELECT TO anon, authenticated USING (owner_user_id IS NULL);
CREATE POLICY recipes_select_own ON public.recipes
  FOR SELECT TO authenticated USING (owner_user_id = (SELECT auth.uid()));
CREATE POLICY recipe_versions_select_catalog ON public.recipe_versions
  FOR SELECT TO anon, authenticated
  USING (EXISTS (SELECT 1 FROM public.recipes AS r WHERE r.id = recipe_id AND r.owner_user_id IS NULL));
CREATE POLICY recipe_versions_select_own ON public.recipe_versions
  FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.recipes AS r WHERE r.id = recipe_id AND r.owner_user_id = (SELECT auth.uid())));
REVOKE ALL ON TABLE public.recipes FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.recipe_versions FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.recipes TO anon, authenticated;
GRANT SELECT ON TABLE public.recipe_versions TO anon, authenticated;

-- Catalogue identities, without versions (see header).
INSERT INTO public.recipes (catalog_key, title, origin) VALUES
  ('nutri-c10', 'Filete de pollo plancha y acelgas rehogadas', 'catalog'),
  ('nutri-c21', 'Albóndigas de pollo y champiñón salteado', 'catalog'),
  ('nutri-c22', 'Pollo asado con batata', 'catalog'),
  ('nutri-c23', 'Pollo al limón', 'catalog'),
  ('nutri-c24', 'Paletilla de cordero al horno con patatas', 'catalog'),
  ('nutri-c34', 'Lentejas estofadas', 'catalog'),
  ('nutri-c36', 'Espaguetis a la boloñesa', 'catalog'),
  ('nutri-c37', 'Espaguetis con gambas y chirlas', 'catalog'),
  ('nutri-c38', 'Espaguetis con brócoli', 'catalog'),
  ('nutri-c39', 'Espaguetis al pesto', 'catalog'),
  ('nutri-c52', 'Judias verdes con patata y huevo duro', 'catalog'),
  ('nutri-e5', 'Filete de pollo plancha y ensalada (canónigos y tomate)', 'catalog'),
  ('nutri-e6', 'Filete de pavo plancha y ensalada (canónigos y tomate)', 'catalog'),
  ('nutri-e12', 'Tosta de Jamón y aguacate', 'catalog'),
  ('nutri-e13', 'Tosta de Salmón ahumado', 'catalog'),
  ('nutri-e15', 'Tosta de Ventresca con tomate', 'catalog'),
  ('nutri-e18', 'Salmón a la plancha', 'catalog'),
  ('nutri-e21', 'Bacalao plancha con ajos fritos', 'catalog'),
  ('nutri-e22', 'Merluza plancha con ajos fritos', 'catalog'),
  ('nutri-e24', 'Pata de pulpo a la plancha con puré de patata', 'catalog'),
  ('nutri-e27', 'Ensalada de tomates, zanahoria, aguacate y anchoas', 'catalog'),
  ('nutri-e29', 'Espárragos, berenjena, calabacín y zanahoria plancha', 'catalog'),
  ('nutri-e32', 'Ensalada de tomate y queso fresco', 'catalog'),
  ('nutri-e33', 'Alcachofas con jamón', 'catalog'),
  ('nutri-e34', 'Escalibada', 'catalog'),
  ('nutri-e38', 'Revuelto de champiñón, espárragos y jamón', 'catalog'),
  ('nutri-e41', 'Tortilla de patata', 'catalog');

-- Week slots point to a card version. NULL = no card (history: only the title is known).
-- A free meal has no card. RESTRICT: a version in use by any week is never deleted.
ALTER TABLE public.week_days
  ADD COLUMN lunch_recipe_version_id uuid,
  ADD COLUMN dinner_recipe_version_id uuid;
ALTER TABLE public.week_days
  ADD CONSTRAINT week_days_lunch_recipe_version_id_fkey FOREIGN KEY (lunch_recipe_version_id)
    REFERENCES public.recipe_versions(id) ON DELETE RESTRICT,
  ADD CONSTRAINT week_days_dinner_recipe_version_id_fkey FOREIGN KEY (dinner_recipe_version_id)
    REFERENCES public.recipe_versions(id) ON DELETE RESTRICT,
  ADD CONSTRAINT week_days_lunch_recipe_planned_chk CHECK (lunch_status = 'planned' OR lunch_recipe_version_id IS NULL),
  ADD CONSTRAINT week_days_dinner_recipe_planned_chk CHECK (dinner_status = 'planned' OR dinner_recipe_version_id IS NULL);
CREATE INDEX week_days_lunch_recipe_version_id_idx ON public.week_days (lunch_recipe_version_id)
  WHERE lunch_recipe_version_id IS NOT NULL;
CREATE INDEX week_days_dinner_recipe_version_id_idx ON public.week_days (dinner_recipe_version_id)
  WHERE dinner_recipe_version_id IS NOT NULL;

-- Every write path of week_days (apply_week, update_week_slot, update_week_slot_recipe, and the
-- previous client still deployed while this rolls out):
--   1. a free meal has no card;
--   2. the dish title changed (another title key: case and spacing do not count) and the link did
--      not: the link is cleared (the card was for the previous dish; update_week_slot and older
--      clients never leave a card on another title);
--   3. a link must be a catalogue card or one of the week owner's (otherwise 23503, like the
--      composite owner FKs of 20260923194029_enforce_reference_ownership);
--   4. a link whose recipe title is not the dish title is cleared (a stale device copy never
--      attaches a card to another dish).
-- SECURITY DEFINER only to read the real owner of the recipe and week (RLS would hide them).
CREATE FUNCTION public.week_days_recipe_links()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_week_owner uuid;
  v_recipe_owner uuid;
  v_recipe_title_key text;
  v_meal text;
  v_link uuid;
  v_dish text;
BEGIN
  IF NEW.lunch_status = 'free' THEN NEW.lunch_recipe_version_id := NULL; END IF;
  IF NEW.dinner_status = 'free' THEN NEW.dinner_recipe_version_id := NULL; END IF;

  IF TG_OP = 'UPDATE' THEN
    IF public.recipe_title_key(NEW.lunch_dish_name) IS DISTINCT FROM public.recipe_title_key(OLD.lunch_dish_name)
       AND NEW.lunch_recipe_version_id IS NOT DISTINCT FROM OLD.lunch_recipe_version_id THEN
      NEW.lunch_recipe_version_id := NULL;
    END IF;
    IF public.recipe_title_key(NEW.dinner_dish_name) IS DISTINCT FROM public.recipe_title_key(OLD.dinner_dish_name)
       AND NEW.dinner_recipe_version_id IS NOT DISTINCT FROM OLD.dinner_recipe_version_id THEN
      NEW.dinner_recipe_version_id := NULL;
    END IF;
    IF NEW.lunch_recipe_version_id IS NOT DISTINCT FROM OLD.lunch_recipe_version_id
       AND NEW.dinner_recipe_version_id IS NOT DISTINCT FROM OLD.dinner_recipe_version_id
       AND NEW.week_id IS NOT DISTINCT FROM OLD.week_id THEN
      RETURN NEW;
    END IF;
  END IF;

  IF NEW.lunch_recipe_version_id IS NULL AND NEW.dinner_recipe_version_id IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT user_id INTO v_week_owner FROM public.weeks WHERE id = NEW.week_id;

  FOREACH v_meal IN ARRAY ARRAY['lunch', 'dinner'] LOOP
    v_link := CASE WHEN v_meal = 'lunch' THEN NEW.lunch_recipe_version_id ELSE NEW.dinner_recipe_version_id END;
    v_dish := CASE WHEN v_meal = 'lunch' THEN NEW.lunch_dish_name ELSE NEW.dinner_dish_name END;
    CONTINUE WHEN v_link IS NULL;
    SELECT r.owner_user_id, r.title_key INTO v_recipe_owner, v_recipe_title_key
    FROM public.recipe_versions AS v JOIN public.recipes AS r ON r.id = v.recipe_id
    WHERE v.id = v_link;
    CONTINUE WHEN NOT FOUND; -- the foreign key reports a missing version (23503)
    IF v_recipe_owner IS NOT NULL AND v_recipe_owner IS DISTINCT FROM v_week_owner THEN
      RAISE EXCEPTION USING ERRCODE = '23503',
        MESSAGE = 'week_days: a recipe card must be from the catalogue or of the week owner';
    END IF;
    IF v_recipe_title_key <> public.recipe_title_key(v_dish) THEN
      IF v_meal = 'lunch' THEN NEW.lunch_recipe_version_id := NULL; ELSE NEW.dinner_recipe_version_id := NULL; END IF;
    END IF;
  END LOOP;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.week_days_recipe_links() FROM PUBLIC, anon, authenticated, service_role;

CREATE TRIGGER week_days_recipe_links BEFORE INSERT OR UPDATE ON public.week_days
  FOR EACH ROW EXECUTE FUNCTION public.week_days_recipe_links();

-- Same signature and behaviour as in 20261008090000_week_transactional_writes. New: each day may
-- carry lunch_recipe_version_id / dinner_recipe_version_id (uuid or null). An absent key keeps the
-- slot's current link (the trigger still clears it if the title changed), so clients that do not
-- know about cards never drop them; an explicit null removes it.
CREATE OR REPLACE FUNCTION public.apply_week(
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
  FROM jsonb_array_elements(p_days) AS e(day)
  CROSS JOIN LATERAL jsonb_to_record(e.day) AS d(position integer, day_name text, lunch_status text,
    lunch_dish_name text, dinner_status text, dinner_dish_name text)
  WHERE d.position BETWEEN 0 AND 6
    AND d.day_name = v_names[d.position + 1]
    AND d.lunch_status IN ('planned', 'free') AND d.dinner_status IN ('planned', 'free')
    AND char_length(coalesce(d.lunch_dish_name, '')) <= 200
    AND char_length(coalesce(d.dinner_dish_name, '')) <= 200
    AND coalesce(jsonb_typeof(e.day -> 'lunch_recipe_version_id'), 'null') IN ('string', 'null')
    AND coalesce(jsonb_typeof(e.day -> 'dinner_recipe_version_id'), 'null') IN ('string', 'null');
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

  -- Recipe links sent by the client (C2). A day without the key keeps its link; the trigger
  -- week_days_recipe_links has already cleared it above if that day's title changed.
  UPDATE public.week_days AS w
  SET lunch_recipe_version_id = CASE WHEN e.day ? 'lunch_recipe_version_id'
        THEN (e.day ->> 'lunch_recipe_version_id')::uuid ELSE w.lunch_recipe_version_id END,
      dinner_recipe_version_id = CASE WHEN e.day ? 'dinner_recipe_version_id'
        THEN (e.day ->> 'dinner_recipe_version_id')::uuid ELSE w.dinner_recipe_version_id END
  FROM jsonb_array_elements(p_days) AS e(day)
  WHERE w.week_id = v_week.id AND w.position = (e.day ->> 'position')::integer
    AND (e.day ? 'lunch_recipe_version_id' OR e.day ? 'dinner_recipe_version_id');

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

-- Links (or unlinks, with NULL) the card of one planned meal of the caller's week, if the week is
-- still at p_expected_version. The dish title does not change. Same results as update_week_slot:
-- applied | duplicate | conflict (week or day gone, meal free, or another version). The card must
-- be readable by the caller (catalogue or own) and be for this dish title (22023 otherwise).
CREATE FUNCTION public.update_week_slot_recipe(
  p_iso_year integer,
  p_iso_week integer,
  p_position integer,
  p_meal text,
  p_recipe_version_id uuid,
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
  v_day public.week_days%ROWTYPE;
  v_title_key text;
BEGIN
  IF v_user IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'update_week_slot_recipe: authentication required';
  END IF;
  IF p_request_key IS NULL OR p_expected_version IS NULL OR p_position NOT BETWEEN 0 AND 6
     OR p_meal NOT IN ('lunch', 'dinner') THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'update_week_slot_recipe: invalid slot';
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
  SELECT * INTO v_day FROM public.week_days WHERE week_id = v_week.id AND position = p_position;
  IF v_week.version <> p_expected_version OR NOT FOUND
     OR (CASE WHEN p_meal = 'lunch' THEN v_day.lunch_status ELSE v_day.dinner_status END) <> 'planned' THEN
    RETURN jsonb_build_object('status', 'conflict', 'week_id', v_week.id,
      'version', v_week.version, 'updated_at', v_week.updated_at);
  END IF;

  IF p_recipe_version_id IS NOT NULL THEN
    SELECT r.title_key INTO v_title_key
    FROM public.recipe_versions AS v JOIN public.recipes AS r ON r.id = v.recipe_id
    WHERE v.id = p_recipe_version_id;
    IF NOT FOUND THEN
      RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'update_week_slot_recipe: recipe version not found';
    END IF;
    IF v_title_key <> public.recipe_title_key(CASE WHEN p_meal = 'lunch' THEN v_day.lunch_dish_name ELSE v_day.dinner_dish_name END) THEN
      RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'update_week_slot_recipe: the card is for another dish';
    END IF;
  END IF;

  UPDATE public.week_days
  SET lunch_recipe_version_id = CASE WHEN p_meal = 'lunch' THEN p_recipe_version_id ELSE lunch_recipe_version_id END,
      dinner_recipe_version_id = CASE WHEN p_meal = 'dinner' THEN p_recipe_version_id ELSE dinner_recipe_version_id END
  WHERE id = v_day.id;

  UPDATE public.weeks
  SET request_keys = (ARRAY[p_request_key] || request_keys)[1:20]
  WHERE id = v_week.id
  RETURNING * INTO v_week;

  RETURN jsonb_build_object('status', 'applied', 'week_id', v_week.id,
    'version', v_week.version, 'updated_at', v_week.updated_at);
END;
$$;

-- Saves a card estimated by AI for one dish title as the caller's own recipe. Always inferred,
-- always owned by auth.uid(); never reviewed. p_card: {baseServings, totalMinutes|null,
-- ingredients, steps, possibleAllergens, model?}. Reuses the caller's recipe with the same title
-- key: same content → that version (existing); different content → version + 1 (new_version).
-- A repeated p_request_key returns what it saved (duplicate). Result:
--   {status: created | new_version | existing | duplicate, recipe_id, version_id, version}.
-- SECURITY DEFINER (search_path ''): users have no write grants on recipes / recipe_versions, so
-- this function is the only way to write them and it fixes owner and review status itself.
CREATE FUNCTION public.save_inferred_recipe(p_title text, p_card jsonb, p_request_key uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_user uuid := auth.uid();
  v_title text := btrim(regexp_replace(coalesce(p_title, ''), '\s+', ' ', 'g'));
  v_recipe public.recipes%ROWTYPE;
  v_existing record;
  v_latest public.recipe_versions%ROWTYPE;
  v_ingredients jsonb;
  v_steps jsonb;
  v_allergens text[];
  v_servings integer;
  v_minutes integer;
  v_model text;
  v_hash text;
  v_version public.recipe_versions%ROWTYPE;
  v_status text;
BEGIN
  IF v_user IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'save_inferred_recipe: authentication required';
  END IF;
  IF p_request_key IS NULL OR char_length(v_title) NOT BETWEEN 3 AND 200 THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'save_inferred_recipe: invalid title or request key';
  END IF;

  SELECT v.id, v.version, v.recipe_id, r.owner_user_id INTO v_existing
  FROM public.recipe_versions AS v JOIN public.recipes AS r ON r.id = v.recipe_id
  WHERE v.request_key = p_request_key;
  IF FOUND THEN
    IF v_existing.owner_user_id IS DISTINCT FROM v_user THEN
      RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'save_inferred_recipe: request key already used';
    END IF;
    RETURN jsonb_build_object('status', 'duplicate', 'recipe_id', v_existing.recipe_id,
      'version_id', v_existing.id, 'version', v_existing.version);
  END IF;

  IF jsonb_typeof(p_card) IS DISTINCT FROM 'object'
     OR EXISTS (SELECT 1 FROM jsonb_object_keys(p_card) AS k
                WHERE k NOT IN ('baseServings', 'totalMinutes', 'ingredients', 'steps', 'possibleAllergens', 'model'))
     OR jsonb_typeof(p_card -> 'baseServings') IS DISTINCT FROM 'number'
     OR jsonb_typeof(p_card -> 'totalMinutes') NOT IN ('number', 'null')
     OR jsonb_typeof(p_card -> 'possibleAllergens') IS DISTINCT FROM 'array'
     OR jsonb_typeof(coalesce(p_card -> 'model', 'null'::jsonb)) NOT IN ('string', 'null')
     OR public.recipe_ingredients_issue(p_card -> 'ingredients') IS NOT NULL
     OR public.recipe_steps_issue(p_card -> 'steps') IS NOT NULL
     OR EXISTS (SELECT 1 FROM jsonb_array_elements(p_card -> 'possibleAllergens') AS a(item)
                WHERE jsonb_typeof(a.item) IS DISTINCT FROM 'string'
                   OR NOT ((a.item #>> '{}') = ANY (public.recipe_allergen_keys()))) THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'save_inferred_recipe: invalid card';
  END IF;
  IF (p_card ->> 'baseServings') !~ '^[0-9]+$' OR (p_card ->> 'baseServings')::integer NOT BETWEEN 1 AND 12
     OR (jsonb_typeof(p_card -> 'totalMinutes') = 'number'
         AND ((p_card ->> 'totalMinutes') !~ '^[0-9]+$' OR (p_card ->> 'totalMinutes')::integer NOT BETWEEN 1 AND 720)) THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'save_inferred_recipe: invalid servings or time';
  END IF;

  -- Canonical content: trimmed texts, allergens sorted without duplicates.
  v_servings := (p_card ->> 'baseServings')::integer;
  v_minutes := CASE WHEN jsonb_typeof(p_card -> 'totalMinutes') = 'number' THEN (p_card ->> 'totalMinutes')::integer END;
  v_model := nullif(left(btrim(coalesce(p_card ->> 'model', '')), 80), '');
  SELECT jsonb_agg(jsonb_build_object(
      'name', btrim(i.item ->> 'name'),
      'quantity', i.item -> 'quantity',
      'unit', CASE WHEN jsonb_typeof(i.item -> 'unit') = 'string' THEN to_jsonb(btrim(i.item ->> 'unit')) ELSE 'null'::jsonb END,
      'category', i.item -> 'category',
      'optional', i.item -> 'optional') ORDER BY i.n)
    INTO v_ingredients
  FROM jsonb_array_elements(p_card -> 'ingredients') WITH ORDINALITY AS i(item, n);
  SELECT jsonb_agg(to_jsonb(btrim(s.step #>> '{}')) ORDER BY s.n) INTO v_steps
  FROM jsonb_array_elements(p_card -> 'steps') WITH ORDINALITY AS s(step, n);
  SELECT coalesce(array_agg(DISTINCT a ORDER BY a), '{}') INTO v_allergens
  FROM jsonb_array_elements_text(p_card -> 'possibleAllergens') AS a;
  v_hash := public.recipe_content_hash(v_servings, v_minutes, v_ingredients, v_steps, v_allergens);

  -- One recipe per title of this user; concurrent saves of the same title wait here.
  INSERT INTO public.recipes (owner_user_id, title, origin)
  VALUES (v_user, v_title, 'ai')
  ON CONFLICT ON CONSTRAINT recipes_owner_title_key DO NOTHING
  RETURNING * INTO v_recipe;
  IF FOUND THEN
    v_status := 'created';
    IF (SELECT count(*) FROM public.recipes WHERE owner_user_id = v_user) > 300 THEN
      RAISE EXCEPTION USING ERRCODE = '54000', MESSAGE = 'save_inferred_recipe: too many recipes';
    END IF;
  ELSE
    SELECT * INTO v_recipe FROM public.recipes
    WHERE owner_user_id = v_user AND title_key = public.recipe_title_key(v_title)
    FOR UPDATE;
    SELECT * INTO v_latest FROM public.recipe_versions
    WHERE recipe_id = v_recipe.id ORDER BY version DESC LIMIT 1;
    IF FOUND AND v_latest.content_hash = v_hash THEN
      RETURN jsonb_build_object('status', 'existing', 'recipe_id', v_recipe.id,
        'version_id', v_latest.id, 'version', v_latest.version);
    END IF;
    v_status := CASE WHEN FOUND THEN 'new_version' ELSE 'created' END;
  END IF;

  INSERT INTO public.recipe_versions (recipe_id, version, base_servings, total_minutes, ingredients, steps,
    possible_allergens, review_status, inferred_model, content_hash, request_key)
  VALUES (v_recipe.id, coalesce(v_latest.version, 0) + 1, v_servings, v_minutes, v_ingredients, v_steps,
    v_allergens, 'inferred', v_model, v_hash, p_request_key)
  RETURNING * INTO v_version;

  RETURN jsonb_build_object('status', v_status, 'recipe_id', v_recipe.id,
    'version_id', v_version.id, 'version', v_version.version);
END;
$$;

REVOKE ALL ON FUNCTION public.recipe_title_key(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.recipe_title_key(text) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.recipe_allergen_keys() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.recipe_allergen_keys() TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.recipe_ingredients_issue(jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.recipe_ingredients_issue(jsonb) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.recipe_steps_issue(jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.recipe_steps_issue(jsonb) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.recipe_content_hash(integer, integer, jsonb, jsonb, text[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.recipe_content_hash(integer, integer, jsonb, jsonb, text[]) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.update_week_slot_recipe(integer, integer, integer, text, uuid, bigint, uuid)
  FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.update_week_slot_recipe(integer, integer, integer, text, uuid, bigint, uuid)
  TO authenticated;
REVOKE ALL ON FUNCTION public.save_inferred_recipe(text, jsonb, uuid) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.save_inferred_recipe(text, jsonb, uuid) TO authenticated;
