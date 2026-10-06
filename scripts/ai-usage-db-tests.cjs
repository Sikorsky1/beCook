// A4: usage ledger, quotas, concurrency, IP limit, budget and permissions against local Postgres.
// SQL scenarios run inside BEGIN ... ROLLBACK; the parallel API scenario deletes its own rows.
const assert = require("node:assert/strict");
const { randomUUID } = require("node:crypto");

const limitsObject = (overrides = {}) => ({ daily: 4, monthly: 20, max_concurrent: 1, ip_hourly: 30, monthly_budget_usd: 25, ...overrides });
const limits = (overrides = {}) => "'" + JSON.stringify(limitsObject(overrides)) + "'::jsonb";

async function runAiUsageTests({ check, sql, id, api, createClient, userClient }) {
  const u1 = id("0", 1), u2 = id("0", 2);
  const begin = (user, flow, ip, lim = limits()) =>
    `public.ai_begin_request('${user}', '${flow}', '${ip}', gen_random_uuid(), ${lim})`;
  const finish = (expr, status = "succeeded", tokens = 10, cost = 0.01) =>
    `public.ai_finish_request((${expr}->>'id')::uuid, '${status}', 'gpt-test', ${tokens}, ${tokens}, ${cost}, 100)`;
  // Setup runs as postgres; the functions are called as service_role, like the server does.
  function scenario(setup, ...results) {
    const out = sql("BEGIN;\n" + setup + "\nSET LOCAL ROLE service_role;\n" +
      results.map(r => "SELECT 'R:' || coalesce((" + r + ")::text, 'null');").join("\n") + "\nROLLBACK;");
    return out.split("\n").filter(line => line.startsWith("R:")).map(line => line.slice(2));
  }
  const seedRows = (user, flow, status, count, { ip = "seed-ip", age = "0 seconds", tokens = 10, cost = 0.01 } = {}) =>
    `INSERT INTO public.ai_usage_events (user_id, flow, status, prompt_tokens, completion_tokens, cost_usd, request_id, ip_hash, created_at, finished_at)
     SELECT '${user}', '${flow}', '${status}', ${tokens === null ? "NULL" : tokens}, ${tokens === null ? "NULL" : tokens}, ${cost === null ? "NULL" : cost},
            gen_random_uuid(), '${ip}' || g, now() - interval '${age}', now() - interval '${age}'
       FROM generate_series(1, ${count}) g;`;
  const sameIpRows = (user, count, ip, age = "0 seconds", status = "succeeded") =>
    `INSERT INTO public.ai_usage_events (user_id, flow, status, prompt_tokens, completion_tokens, cost_usd, request_id, ip_hash, created_at, finished_at)
     SELECT '${user}', 'import', '${status}', 1, 1, 0, gen_random_uuid(), '${ip}', now() - interval '${age}', now() - interval '${age}'
       FROM generate_series(1, ${count}) g;`;

  check("ai usage: menu daily quota allows 4 and rejects the 5th with Retry-After", () => {
    const steps = [1, 2, 3, 4].map(() => finish(begin(u1, "menu", "ip-a")) + "->>'updated'");
    const rows = scenario("", ...steps, begin(u1, "menu", "ip-a") + "->>'reason'",
      `(SELECT ${begin(u1, "menu", "ip-a")}->>'retry_after_seconds')::int > 0`);
    assert.deepEqual(rows, ["true", "true", "true", "true", "daily_quota", "true"]);
  });

  check("ai usage: daily quota is per user and per flow", () => {
    const rows = scenario(seedRows(u1, "menu", "succeeded", 4),
      begin(u2, "menu", "ip-b") + "->>'allowed'",
      finish(begin(u1, "import", "ip-c")) + "->>'updated'");
    assert.deepEqual(rows, ["true", "true"]);
  });

  check("ai usage: import and shopping daily quota of 10", () => {
    const lim = limits({ daily: 10, monthly: null });
    const rows = scenario(seedRows(u1, "import", "succeeded", 10) + seedRows(u1, "shopping", "succeeded", 9),
      begin(u1, "import", "ip-d", lim) + "->>'reason'",
      begin(u1, "shopping", "ip-d", lim) + "->>'allowed'");
    assert.deepEqual(rows, ["daily_quota", "true"]);
  });

  check("ai usage: menu monthly quota of 20; previous months do not count", () => {
    const lim = limits({ daily: null });
    assert.deepEqual(scenario(seedRows(u1, "menu", "succeeded", 20), begin(u1, "menu", "ip-e", lim) + "->>'reason'"), ["monthly_quota"]);
    assert.deepEqual(scenario(seedRows(u1, "menu", "succeeded", 20, { age: "40 days" }), begin(u1, "menu", "ip-e", lim) + "->>'allowed'"), ["true"]);
  });

  check("ai usage: failures without tokens are free; failures with tokens consume quota", () => {
    assert.deepEqual(scenario(seedRows(u1, "menu", "failed", 4, { tokens: null, cost: null }), begin(u1, "menu", "ip-f") + "->>'allowed'"), ["true"]);
    assert.deepEqual(scenario(seedRows(u1, "menu", "failed", 4), begin(u1, "menu", "ip-f") + "->>'reason'"), ["daily_quota"]);
  });

  check("ai usage: one concurrent request per user", () => {
    const rows = scenario("", begin(u1, "menu", "ip-g") + "->>'allowed'", begin(u1, "import", "ip-g") + "->>'reason'",
      `(${begin(u1, "import", "ip-g")}->>'retry_after_seconds')::int BETWEEN 1 AND 120`,
      begin(u2, "import", "ip-g") + "->>'allowed'");
    assert.deepEqual(rows, ["true", "concurrency", "true", "true"]);
  });

  check("ai usage: 'started' older than 2 minutes expires and frees the slot", () => {
    const rows = scenario(seedRows(u1, "menu", "started", 1, { age: "3 minutes", tokens: null, cost: null }),
      begin(u1, "menu", "ip-h") + "->>'allowed'",
      `(SELECT count(*) FROM public.ai_usage_events WHERE user_id='${u1}' AND status='failed' AND reject_reason='expired')`);
    assert.deepEqual(rows, ["true", "1"]);
    assert.deepEqual(scenario(seedRows(u1, "menu", "started", 1, { age: "90 seconds", tokens: null, cost: null }),
      begin(u1, "menu", "ip-h") + "->>'reason'"), ["concurrency"]);
  });

  check("ai usage: 30 requests per IP and hour across users; older and rejected rows do not count", () => {
    assert.deepEqual(scenario(sameIpRows(u1, 15, "shared-ip") + sameIpRows(u2, 15, "shared-ip"),
      begin(u2, "shopping", "shared-ip", limits({ daily: null })) + "->>'reason'"), ["ip_rate"]);
    assert.deepEqual(scenario(sameIpRows(u1, 29, "shared-ip") + sameIpRows(u1, 30, "shared-ip", "61 minutes") + sameIpRows(u2, 30, "shared-ip", "0 seconds", "rejected"),
      begin(u2, "shopping", "shared-ip", limits({ daily: null })) + "->>'allowed'"), ["true"]);
  });

  check("ai usage: global monthly budget is checked first and blocks everyone", () => {
    const rows = scenario(seedRows(u2, "menu", "succeeded", 1, { cost: 25 }) + seedRows(u1, "menu", "started", 1, { tokens: null, cost: null }),
      begin(u1, "menu", "ip-i") + "->>'reason'",
      `(${begin(u1, "menu", "ip-i")}->>'retry_after_seconds')::int > 0`);
    assert.deepEqual(rows, ["budget_exhausted", "true"]);
    assert.deepEqual(scenario(seedRows(u2, "menu", "succeeded", 1, { cost: 24.99 }), begin(u1, "menu", "ip-i") + "->>'allowed'"), ["true"]);
  });

  check("ai usage: rejections are recorded with their reason", () => {
    assert.deepEqual(scenario(seedRows(u1, "menu", "succeeded", 4),
      begin(u1, "menu", "ip-j") + "->>'reason'",
      `(SELECT reject_reason FROM public.ai_usage_events WHERE user_id='${u1}' AND status='rejected')`), ["daily_quota", "daily_quota"]);
  });

  check("ai usage: finish closes only open requests and reports monthly cost", () => {
    const rows = scenario(seedRows(u2, "menu", "succeeded", 1, { cost: 12 }),
      `(SELECT ${finish(begin(u1, "menu", "ip-k"), "succeeded", 10, 0.6)}->>'month_cost_usd')::numeric`,
      `(SELECT ${finish(begin(u1, "menu", "ip-k"), "succeeded")}->>'updated')`,
      `(SELECT count(*) FROM public.ai_usage_events WHERE user_id='${u1}' AND status='succeeded' AND cost_usd=0.6 AND finished_at IS NOT NULL)`);
    // The first request was closed, so the second one is admitted and closed too.
    assert.deepEqual(rows, ["12.600000", "true", "1"]);
    const reclose = scenario("",
      `(WITH b AS (SELECT ${begin(u1, "menu", "ip-l")} AS r), f1 AS (SELECT public.ai_finish_request((r->>'id')::uuid, 'failed', NULL, NULL, NULL, NULL, 5, 'timeout') AS x FROM b)
        SELECT (SELECT x->>'updated' FROM f1) || ',' || (public.ai_finish_request((SELECT (r->>'id')::uuid FROM b), 'succeeded', 'm', 1, 1, 1, 1)->>'updated') FROM b)`);
    assert.deepEqual(reclose, ["true,false"]);
  });

  check("ai usage: invalid flow or missing identity raise", () => {
    assert.throws(() => scenario("", begin(u1, "poetry", "ip-m") + "->>'allowed'"));
    assert.throws(() => scenario("", `public.ai_begin_request('${u1}', 'menu', '', gen_random_uuid(), ${limits()})->>'allowed'`));
  });

  check("ai usage: anon and authenticated have no table or function privileges", () => {
    const privileges = sql(`SELECT string_agg(r || ':' || p || ':' || ok, ';' ORDER BY r, p) FROM (
      SELECT r, p, has_table_privilege(r, 'public.ai_usage_events', p)::text AS ok
        FROM unnest(array['anon','authenticated']) r, unnest(array['SELECT','INSERT','UPDATE','DELETE']) p
      UNION ALL
      SELECT r, f, has_function_privilege(r, f, 'EXECUTE')::text
        FROM unnest(array['anon','authenticated']) r,
             unnest(array['public.ai_begin_request(uuid,text,text,uuid,jsonb)','public.ai_finish_request(uuid,text,text,integer,integer,numeric,integer,text)']) f
      UNION ALL
      SELECT 'service_role', f, has_function_privilege('service_role', f, 'EXECUTE')::text
        FROM unnest(array['public.ai_begin_request(uuid,text,text,uuid,jsonb)','public.ai_finish_request(uuid,text,text,integer,integer,numeric,integer,text)']) f
    ) x;`).trim();
    const entries = privileges.split(";");
    assert.equal(entries.length, 14);
    assert.ok(entries.filter(e => !e.startsWith("service_role")).every(e => e.endsWith(":false")), privileges);
    assert.ok(entries.filter(e => e.startsWith("service_role")).every(e => e.endsWith(":true")), privileges);
    assert.equal(sql("SELECT relrowsecurity FROM pg_class WHERE oid = 'public.ai_usage_events'::regclass;").trim(), "t");
  });

  // Data API: the real anon key and a real fixture session are both refused.
  const anon = createClient(api.url, api.key, { auth: { persistSession: false, autoRefreshToken: false } });
  for (const [label, client] of [["anon", anon], ["authenticated", userClient]]) {
    const read = await client.from("ai_usage_events").select("id").limit(1);
    const write = await client.from("ai_usage_events").insert({ user_id: u1, flow: "menu", status: "succeeded", request_id: randomUUID(), ip_hash: "x" });
    const update = await client.from("ai_usage_events").update({ status: "failed" }).eq("user_id", u1);
    const remove = await client.from("ai_usage_events").delete().eq("user_id", u1);
    const rpcBegin = await client.rpc("ai_begin_request", { p_user_id: u1, p_flow: "menu", p_ip_hash: "x", p_request_id: randomUUID(), p_limits: limitsObject() });
    const rpcFinish = await client.rpc("ai_finish_request", { p_id: randomUUID(), p_status: "failed", p_model: null, p_prompt_tokens: null, p_completion_tokens: null, p_cost_usd: null, p_latency_ms: 1 });
    check("ai usage Data API: " + label + " cannot read, write, update, delete or execute", () => {
      for (const result of [read, write, update, remove, rpcBegin, rpcFinish]) assert.ok(result.error, label);
    });
  }
  check("ai usage Data API: refused calls left no rows", () =>
    assert.equal(sql("SELECT count(*) FROM public.ai_usage_events;").trim(), "0"));

  // Real parallel begins with the service key: the advisory lock admits exactly one.
  const service = createClient(api.url, api.serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
  const requestIds = Array.from({ length: 5 }, () => randomUUID());
  try {
    const results = await Promise.all(requestIds.map(requestId => service.rpc("ai_begin_request", {
      p_user_id: u1, p_flow: "import", p_ip_hash: "parallel-ip", p_request_id: requestId,
      p_limits: { daily: 10, monthly: null, max_concurrent: 1, ip_hourly: 30, monthly_budget_usd: 25 },
    })));
    check("ai usage: 5 parallel requests for one user -> exactly 1 allowed", () => {
      assert.ok(results.every(r => !r.error));
      assert.equal(results.filter(r => r.data.allowed).length, 1);
      assert.equal(results.filter(r => r.data.reason === "concurrency").length, 4);
    });
  } finally {
    sql("DELETE FROM public.ai_usage_events WHERE request_id IN (" + requestIds.map(r => "'" + r + "'").join(",") + ");");
  }
  check("ai usage: parallel scenario cleaned up", () =>
    assert.equal(sql("SELECT count(*) FROM public.ai_usage_events;").trim(), "0"));
}

module.exports = { runAiUsageTests };
