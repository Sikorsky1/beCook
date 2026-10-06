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

function aiRequest(path, body, {token = validToken, ip = "203.0.113.7", signal} = {}) {
 const headers = {"content-type": "application/json", "x-forwarded-for": `${ip}, 10.0.0.1`};
 if (token) headers.authorization = `Bearer ${token}`;
 return new Request(`http://localhost/api/${path}`, {method: "POST", headers, body: JSON.stringify(body), signal});
}

module.exports = {installFakeBackends, aiRequest, supabaseUrl, validToken, userId};
