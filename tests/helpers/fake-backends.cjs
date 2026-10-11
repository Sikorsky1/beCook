// Synthetic Supabase Auth, usage-ledger RPCs and OpenAI for route tests. No network.
const supabaseUrl = "http://supabase.test";
const validToken = "header.synthetic-valid.signature";
const userId = "00000000-0000-4000-8000-000000000001";
const envKeys = ["OPENAI_API_KEY", "NEXT_PUBLIC_SUPABASE_URL", "NEXT_PUBLIC_SUPABASE_ANON_KEY", "SUPABASE_SERVICE_ROLE_KEY", "AI_IP_HASH_SALT",
 "AI_QUOTA_MENU_DAILY", "AI_QUOTA_MENU_MONTHLY", "AI_QUOTA_IMPORT_DAILY", "AI_QUOTA_SHOPPING_DAILY", "AI_MAX_CONCURRENT", "AI_IP_HOURLY", "AI_MONTHLY_BUDGET_USD"];

function installFakeBackends(openai) {
 const saved = {fetch: global.fetch};
 for (const key of envKeys) saved[key] = process.env[key];
 for (const key of envKeys) delete process.env[key];
 Object.assign(process.env, {
  OPENAI_API_KEY: "synthetic-test-key",
  NEXT_PUBLIC_SUPABASE_URL: supabaseUrl,
  NEXT_PUBLIC_SUPABASE_ANON_KEY: "synthetic-anon-key",
  SUPABASE_SERVICE_ROLE_KEY: "synthetic-service-key",
  AI_IP_HASH_SALT: "synthetic-salt",
 });
 const state = {
  authCalls: 0, openAICalls: 0, authMode: "ok", rpcMode: "ok",
  begin: [], finish: [], rpcAuth: [],
  beginResult: {allowed: true, id: "10000000-0000-4000-8000-000000000001", reason: null, retry_after_seconds: null},
  finishResult: {updated: true, month_cost_usd: 0.01, previous_month_cost_usd: 0},
  // C1: the caller's saved profile as current_food_context() returns it, and the week context.
  foodContext: foodContextFor({}),
  weekContext: null,
  contextCalls: [],
  // C2 (/api/dish-card): the caller's week as PostgREST returns it, their own cards, and the card
  // RPCs, all read or written with the caller's session.
  dishWeek: {version: 3, week_days: [{position: 0, lunch_status: "planned", lunch_dish_name: "Lentejas estofadas", dinner_status: "free", dinner_dish_name: ""}]},
  ownCards: [],
  savedCards: {},
  recipeCalls: [],
  linkResult: null,
  restore() {
   global.fetch = saved.fetch;
   for (const key of envKeys) {
    if (saved[key] === undefined) delete process.env[key];
    else process.env[key] = saved[key];
   }
  },
 };
 global.fetch = async (input, init = {}) => {
  const url = String(input instanceof Request ? input.url : input);
  const headers = new Headers(init.headers ?? (input instanceof Request ? input.headers : undefined));
  if (url.startsWith(`${supabaseUrl}/auth/v1/user`)) {
   state.authCalls++;
   if (state.authMode === "down") throw new TypeError("fetch failed");
   if (headers.get("authorization") !== `Bearer ${validToken}`) return Response.json({code: 403, error_code: "bad_jwt", msg: "invalid JWT"}, {status: 403});
   return Response.json({id: userId, aud: "authenticated", role: "authenticated", app_metadata: {}, user_metadata: {}, created_at: "2026-01-01T00:00:00Z"});
  }
  // C1: profile and week context, read with the caller's session (not the service key).
  if (url.startsWith(`${supabaseUrl}/rest/v1/rpc/current_food_context`) || url.startsWith(`${supabaseUrl}/rest/v1/rpc/week_food_context_status`)) {
   const text = await (input instanceof Request ? input.text() : init.body);
   state.contextCalls.push({rpc: url.split("/").pop(), authorization: headers.get("authorization"), body: text ? JSON.parse(text) : null});
   if (state.contextMode === "down") return Response.json({message: "unavailable"}, {status: 503});
   if (url.endsWith("/current_food_context")) return Response.json(state.foodContext);
   return Response.json(state.weekContext ?? {week: true, frozen: null, current: state.foodContext, restrictionsChanged: false, householdChanged: false});
  }
  if (url.startsWith(`${supabaseUrl}/rest/v1/rpc/save_inferred_recipe`) || url.startsWith(`${supabaseUrl}/rest/v1/rpc/update_week_slot_recipe`)
   || url.startsWith(`${supabaseUrl}/rest/v1/weeks`) || url.startsWith(`${supabaseUrl}/rest/v1/recipe_versions`) || url.startsWith(`${supabaseUrl}/rest/v1/recipes?`)) {
   return dishCardRest(state, url, init, headers, input);
  }
  if (url.startsWith(`${supabaseUrl}/rest/v1/rpc/`)) {
   state.rpcAuth.push(headers.get("apikey"));
   if (state.rpcMode === "down") return Response.json({message: "unavailable"}, {status: 503});
   const body = JSON.parse(await (input instanceof Request ? input.text() : init.body));
   if (url.endsWith("/ai_begin_request")) { state.begin.push(body); return Response.json(state.beginResult); }
   if (url.endsWith("/ai_finish_request")) { state.finish.push(body); return Response.json(state.finishResult); }
   return Response.json({message: "unknown rpc"}, {status: 404});
  }
  state.openAICalls++;
  return openai(url, init, state);
 };
 return state;
}

async function dishCardRest(state, url, init, headers, input) {
 const text = await (input instanceof Request ? input.text() : init.body);
 const body = text ? JSON.parse(text) : null;
 const name = new URL(url).pathname.split("/").pop();
 state.recipeCalls.push({name, authorization: headers.get("authorization"), body, url});
 if (state.recipeMode === "down") return Response.json({message: "unavailable"}, {status: 503});
 const answer = rows => headers.get("accept")?.includes("vnd.pgrst.object")
  ? (rows.length ? Response.json(rows[0]) : Response.json({code: "PGRST116", message: "no rows"}, {status: 406}))
  : Response.json(rows);
 if (name === "weeks") return answer(state.dishWeek ? [state.dishWeek] : []);
 if (name === "recipes") return answer([...new Set(state.ownCards.map(row => row.recipes.id))].map(id => ({id})));
 if (name === "recipe_versions") {
  const id = new URL(url).searchParams.get("id");
  if (id) return answer(state.savedCards[id.replace(/^eq\./, "")] ? [state.savedCards[id.replace(/^eq\./, "")]] : []);
  return answer(state.ownCards);
 }
 if (name === "save_inferred_recipe") {
  const versionId = "20000000-0000-4000-8000-000000000001";
  const card = body.p_card;
  state.savedCards[versionId] = {id: versionId, version: 1, base_servings: card.baseServings, total_minutes: card.totalMinutes, ingredients: card.ingredients, steps: card.steps,
   possible_allergens: card.possibleAllergens, review_status: "inferred", recipes: {id: "30000000-0000-4000-8000-000000000001", title: body.p_title, origin: "ai"}};
  return Response.json({status: "created", recipe_id: "30000000-0000-4000-8000-000000000001", version_id: versionId, version: 1});
 }
 return Response.json(state.linkResult ?? {status: "applied", week_id: "40000000-0000-4000-8000-000000000001", version: (state.dishWeek?.version ?? 0) + 1, updated_at: null});
}

// What current_food_context() returns for a saved profile (null: no profile).
function foodContextFor(profile) {
 if (profile === null) return {found: false};
 const restrictions = {
  dietaryRestrictions: [...new Set((profile.dietaryRestrictions ?? []).filter((value) => value !== "none"))].sort(),
  allergies: [...new Set(profile.allergies ?? [])].sort(),
  otherAllergies: profile.otherAllergies ?? "",
  dislikedFoods: [...new Set((profile.dislikedFoods ?? []).map((food) => food.toLowerCase()))].sort(),
 };
 return {
  found: true, householdSize: profile.householdSize ?? 2, restrictions,
  version: `fc1:${JSON.stringify(restrictions).length.toString(16).padStart(8, "0")}`,
  preferences: {goals: profile.goals ?? [], otherGoal: profile.otherGoal ?? "", weeklyTrainingDays: profile.weeklyTrainingDays ?? 0, trainingTypes: profile.trainingTypes ?? []},
  updatedAt: "2026-10-01T10:00:00Z",
 };
}

function aiRequest(path, body, {token = validToken, ip = "203.0.113.7", signal} = {}) {
 const headers = {"content-type": "application/json", "x-forwarded-for": `${ip}, 10.0.0.1`};
 if (token) headers.authorization = `Bearer ${token}`;
 return new Request(`http://localhost/api/${path}`, {method: "POST", headers, body: JSON.stringify(body), signal});
}

module.exports = {installFakeBackends, aiRequest, foodContextFor, supabaseUrl, validToken, userId};
