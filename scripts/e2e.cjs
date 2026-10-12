// P35: orquestador del E2E. Solo Supabase local (contenedor verificado), OpenAI simulado y
// un build de Next hecho exclusivamente con variables locales explícitas.
//
//   npm run test:e2e                 build + servidores + Playwright (argumentos extra van a Playwright)
//   npm run test:e2e -- --grep alta  solo los recorridos que coincidan
//   E2E_SKIP_BUILD=1 npm run test:e2e   reutiliza el último build del E2E (comprobado otra vez)
//   node scripts/e2e.cjs --serve     deja los servidores arrancados para depurar (Ctrl+C para salir)
//
// De los .env* solo usa los nombres para vaciarlos en los subprocesos, y así un .env.local que
// apunte a producción no aporta nada al build ni al servidor. Sus valores largos (claves, URL)
// se leen únicamente en memoria para comprobar que no aparecen en el build; nunca se imprimen.
const fs = require("node:fs");
const path = require("node:path");
const net = require("node:net");
const { randomBytes } = require("node:crypto");
const { spawn, spawnSync } = require("node:child_process");
const local = require("./local-supabase.cjs");
const { createMockOpenAI } = require("../tests/e2e/mock-openai.cjs");

const ROOT = local.ROOT;
const NEXT_BIN = path.join(ROOT, "node_modules/next/dist/bin/next");
const PLAYWRIGHT_CLI = path.join(ROOT, "node_modules/@playwright/test/cli.js");
const BUILD_DIR = path.join(ROOT, ".next");
const BUILD_MARKER = path.join(BUILD_DIR, "becook-e2e-build.json");
const LOG_DIR = path.join(ROOT, "test-results/servers");
const LOCAL_API = "http://127.0.0.1:54321";
const E2E_EMAIL_PATTERN = "e2e-%@example.invalid";

function ensureWorkspaceConfig() {
  // `supabase status` (localApi) needs the generated workspace; db:start creates it. A fresh
  // worktree can share an already running container, so only the verified config is copied.
  const target = path.join(local.WORK, "supabase/config.toml");
  if (fs.existsSync(target)) return;
  const config = fs.readFileSync(path.join(ROOT, "supabase/config.toml"), "utf8");
  if (!config.includes(`project_id = "${local.PROJECT}"`)) throw new Error("Unexpected local project configuration.");
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, config);
}

function envFileEntries() {
  const entries = [];
  for (const file of fs.readdirSync(ROOT).filter(name => name.startsWith(".env"))) {
    const full = path.join(ROOT, file);
    if (!fs.statSync(full).isFile()) continue;
    for (const line of fs.readFileSync(full, "utf8").split(/\r?\n/)) {
      const match = line.match(/^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
      if (match) entries.push({ name: match[1], value: match[2].trim().replace(/^(["'])(.*)\1$/, "$2") });
    }
  }
  return entries;
}

function baseEnv(api) {
  const env = {};
  // Defined but empty: @next/env never replaces a variable that already exists in process.env.
  for (const { name } of envFileEntries()) env[name] = "";
  Object.assign(env, local.safeEnv());
  for (const name of ["CI", "PLAYWRIGHT_BROWSERS_PATH", "E2E_CHANNEL", "DISPLAY", "LANG"]) {
    if (process.env[name]) env[name] = process.env[name];
  }
  return Object.assign(env, {
    NEXT_TELEMETRY_DISABLED: "1",
    // Next skips .env* loading entirely when this is set (belt and braces with the blanks above).
    __NEXT_PROCESSED_ENV: "true",
    NEXT_PUBLIC_SUPABASE_URL: api.url,
    NEXT_PUBLIC_SUPABASE_ANON_KEY: api.key,
  });
}

function listFiles(dir, extension) {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir, { recursive: true, withFileTypes: true })
    .filter(entry => entry.isFile() && entry.name.endsWith(extension))
    .map(entry => path.join(entry.parentPath ?? entry.path, entry.name));
}

// The browser bundle must embed the local API and no hosted Supabase project.
function verifyBuild() {
  const clientFiles = listFiles(path.join(BUILD_DIR, "static"), ".js");
  const serverFiles = listFiles(path.join(BUILD_DIR, "server"), ".js");
  if (!clientFiles.length || !serverFiles.length) throw new Error("No Next build found; run without E2E_SKIP_BUILD.");
  const embedsLocal = clientFiles.some(file => fs.readFileSync(file, "utf8").includes(LOCAL_API));
  const hosted = [...clientFiles, ...serverFiles].filter(file => /[a-z0-9]{20}\.supabase\.co/.test(fs.readFileSync(file, "utf8")));
  if (!embedsLocal) throw new Error(`The client bundle does not embed ${LOCAL_API}.`);
  if (hosted.length) throw new Error(`The build references a hosted Supabase project (${hosted.length} files). Aborting.`);
  // No long value of a .env* file (keys, project URLs) may end up in the build. Names only in errors.
  const values = envFileEntries().filter(entry => entry.value.length >= 20);
  const leaked = new Set();
  for (const file of [...clientFiles, ...serverFiles]) {
    const text = fs.readFileSync(file, "utf8");
    for (const entry of values) if (text.includes(entry.value)) leaked.add(entry.name);
  }
  if (leaked.size) throw new Error(`The build embeds values from .env* files (${[...leaked].join(", ")}). Aborting.`);
  console.log(`Build verificado: el bundle usa ${LOCAL_API} y ningún proyecto alojado (${clientFiles.length} ficheros de cliente).`);
}

function build(env) {
  console.log("Construyendo Next solo con variables locales...");
  const result = spawnSync(process.execPath, [NEXT_BIN, "build"], { cwd: ROOT, env, stdio: "inherit" });
  if (result.status !== 0) throw new Error("next build failed.");
  verifyBuild();
  fs.writeFileSync(BUILD_MARKER, JSON.stringify({ supabaseUrl: LOCAL_API, builtAt: new Date().toISOString() }) + "\n");
}

function freePort(preferred, avoid = []) {
  return new Promise((resolve, reject) => {
    const tryPort = port => {
      if (port > preferred + 200) return reject(new Error("No free local port found."));
      if (avoid.includes(port)) return tryPort(port + 1);
      const probe = net.createServer();
      probe.once("error", () => tryPort(port + 1));
      probe.listen(port, "127.0.0.1", () => probe.close(() => resolve(port)));
    };
    tryPort(preferred);
  });
}

async function waitForServer(url, child, timeoutMs = 90_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error(`Server exited early (${url}).`);
    try {
      const response = await fetch(url, { redirect: "manual" });
      if (response.status < 500) return;
    } catch { /* not listening yet */ }
    await new Promise(resolve => setTimeout(resolve, 500));
  }
  throw new Error(`Server not ready: ${url}`);
}

function startNext(name, port, env) {
  fs.mkdirSync(LOG_DIR, { recursive: true });
  const log = fs.openSync(path.join(LOG_DIR, `${name}.log`), "w");
  const child = spawn(process.execPath, [NEXT_BIN, "start", "-H", "127.0.0.1", "-p", String(port)], { cwd: ROOT, env, stdio: ["ignore", log, log] });
  return { name, url: `http://127.0.0.1:${port}`, child };
}

// Local PostgREST (v16) caches its clock; after a few idle seconds it can reject a fresh, valid
// JWT as «issued at future» (PGRST303) and the app shows «No se ha podido cargar tu cuenta».
// A light anonymous request every 250 ms keeps that clock current during the run.
function keepPostgrestClockFresh(api) {
  const ping = () => fetch(`${api.url}/rest/v1/profiles?select=id&limit=1`, { headers: { apikey: api.key, authorization: `Bearer ${api.key}` } }).catch(() => {});
  const timer = setInterval(ping, 250);
  return () => clearInterval(timer);
}

function runPlaywright(args, env) {
  // Asynchronous on purpose: the simulated OpenAI lives in this process and must keep answering.
  return new Promise(resolve => {
    const child = spawn(process.execPath, [PLAYWRIGHT_CLI, "test", ...args], { cwd: ROOT, env, stdio: "inherit" });
    child.on("exit", code => resolve(code ?? 1));
  });
}

function cleanupUsers() {
  // Only the synthetic identities created by the E2E (e2e-…@example.invalid); FKs cascade.
  local.sql(`delete from auth.users where email like '${E2E_EMAIL_PATTERN}';`);
}

async function main() {
  const args = process.argv.slice(2);
  const serveOnly = args.includes("--serve");
  const playwrightArgs = args.filter(arg => arg !== "--serve");

  ensureWorkspaceConfig();
  const api = local.localApi();
  if (api.url !== LOCAL_API) throw new Error("Unexpected local API address.");
  const env = baseEnv(api);

  if (process.env.E2E_SKIP_BUILD === "1" && fs.existsSync(BUILD_MARKER)) verifyBuild();
  else build(env);

  cleanupUsers();
  const mock = createMockOpenAI();
  const mockUrl = await mock.listen(await freePort(Number(process.env.E2E_MOCK_PORT ?? 4010)));
  const mainPort = await freePort(Number(process.env.E2E_PORT ?? 3100), [3000]);
  const budgetPort = await freePort(mainPort + 1, [3000]);

  const serverEnv = {
    ...env,
    SUPABASE_SERVICE_ROLE_KEY: api.serviceKey,
    OPENAI_API_KEY: "sk-test-e2e-local",
    OPENAI_BASE_URL: mockUrl,
    // A new salt per run: the per-IP window of previous runs never counts against this one.
    AI_IP_HASH_SALT: `e2e-local-${randomBytes(8).toString("hex")}`,
    AI_IP_HOURLY: "10000",
    AI_MONTHLY_BUDGET_USD: "1000",
    AI_QUOTA_MENU_DAILY: "4",
    AI_QUOTA_MENU_MONTHLY: "20",
    AI_QUOTA_IMPORT_DAILY: "1",
    AI_QUOTA_SHOPPING_DAILY: "10",
  };
  const servers = [
    startNext("main", mainPort, serverEnv),
    // Same build, global budget at zero: every AI request must stop with 503 before OpenAI.
    startNext("budget", budgetPort, { ...serverEnv, AI_MONTHLY_BUDGET_USD: "0" }),
  ];
  const stopHeartbeat = keepPostgrestClockFresh(api);
  const stop = async () => {
    stopHeartbeat();
    for (const server of servers) if (server.child.exitCode === null) server.child.kill("SIGTERM");
    await mock.close();
  };
  process.on("SIGINT", () => { stop().finally(() => process.exit(130)); });

  let exitCode = 1;
  try {
    await Promise.all(servers.map(server => waitForServer(`${server.url}/login`, server.child)));
    console.log(`Servidores: ${servers.map(server => `${server.name} ${server.url}`).join(", ")}; OpenAI simulado ${mockUrl}`);
    const testEnv = {
      ...env,
      E2E_BASE_URL: servers[0].url,
      E2E_BUDGET_URL: servers[1].url,
      E2E_MOCK_URL: mockUrl,
      E2E_SUPABASE_URL: api.url,
      E2E_SUPABASE_ANON_KEY: api.key,
      // Locally generated key of the dedicated container: creates the synthetic E2E identities.
      E2E_SUPABASE_SERVICE_ROLE_KEY: api.serviceKey,
      E2E_RUN_ID: randomBytes(4).toString("hex"),
    };
    if (serveOnly) {
      console.log("Modo --serve: Ctrl+C para parar.");
      await new Promise(() => {});
    }
    const started = Date.now();
    exitCode = await runPlaywright(playwrightArgs, testEnv);
    console.log(`Playwright terminó con código ${exitCode} en ${Math.round((Date.now() - started) / 1000)} s. OpenAI simulado: ${JSON.stringify(mock.calls)}`);
    if (exitCode === 0) cleanupUsers();
  } finally {
    await stop();
  }
  process.exitCode = exitCode;
}

main().catch(error => {
  console.error(error.message);
  process.exitCode = 1;
});
