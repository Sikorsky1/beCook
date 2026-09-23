const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const { execFileSync, spawnSync } = require("node:child_process");
const ROOT = path.resolve(__dirname, "..");
const WORK = path.join(ROOT, ".supabase-local");
const PROJECT = "becook-iteration02";
const BASELINE = "20260923103650_local_baseline.sql";
const LEGACY = ["20260607_enable_child_tables_rls.sql", "20260608_profiles_goals_array.sql", "20260611_weeks_iso_calendar.sql"];
const CLI = path.join(ROOT, "node_modules/.bin/supabase");
const container = "supabase_db_" + PROJECT;

// Never inherit provider keys, database URLs, Docker overrides or .env files.
function safeEnv() {
  return Object.fromEntries(["PATH", "HOME", "USER", "TMPDIR", "SystemRoot"].filter(k => process.env[k]).map(k => [k, process.env[k]]));
}
function run(binary, args, input) {
  try {
    return execFileSync(binary, args, { cwd: ROOT, env: safeEnv(), input, encoding: "utf8", maxBuffer: 32 * 1024 * 1024, stdio: ["pipe", "pipe", "pipe"] });
  } catch {
    // CLI status/start and database errors may contain keys or row contents.
    throw new Error("Local command failed: " + path.basename(binary) + " " + args[0] + ". No credentials or row contents logged.");
  }
}
function assertEndpoint(endpoint) {
  const allowed = ["unix:///var/run/docker.sock", "unix://" + path.join(os.homedir(), ".docker/run/docker.sock")];
  if (!allowed.includes(endpoint)) throw new Error("Refusing Docker endpoint: only the local Docker socket is authorized.");
}
function dockerLocal() {
  if (process.env.DOCKER_HOST || process.env.DOCKER_CONTEXT) throw new Error("Remove DOCKER_HOST/DOCKER_CONTEXT overrides; remote Docker is forbidden.");
  assertEndpoint(run("docker", ["context", "inspect", "--format", "{{.Endpoints.docker.Host}}"]).trim());
  if (fs.existsSync(path.join(WORK, "supabase/.temp/project-ref"))) throw new Error("Local workspace must never be linked.");
}
function assertContainer(info) {
  if (info.Name !== "/" + container || !info.State.Running ||
      info.Config.Labels?.["com.supabase.cli.project"] !== PROJECT ||
      !/supabase\/postgres:17\./.test(info.Config.Image)) {
    throw new Error("Container identity does not match the dedicated beCook local database.");
  }
}
function verifiedContainer(marker = true) {
  dockerLocal();
  const info = JSON.parse(run("docker", ["inspect", container]))[0];
  assertContainer(info);
  if (marker && sql("select project from becook_local.identity;", info.Id).trim() !== PROJECT) {
    throw new Error("Missing local database identity marker.");
  }
  return info.Id;
}
function sql(statement, id = verifiedContainer()) {
  return run("docker", ["exec", "-i", id, "psql", "-X", "-v", "ON_ERROR_STOP=1", "-U", "postgres", "-d", "postgres", "-At"], statement);
}
function cli(args) {
  return run(CLI, [...args, "--workdir", WORK]);
}
function prepare() {
  dockerLocal();
  fs.mkdirSync(path.join(WORK, "supabase/migrations"), { recursive: true });
  let config = fs.readFileSync(path.join(ROOT, "supabase/config.toml"), "utf8");
  if (!config.includes('project_id = "' + PROJECT + '"')) throw new Error("Unexpected local project configuration.");
  fs.writeFileSync(path.join(WORK, "supabase/config.toml"), config);
  let baseline = fs.readFileSync(path.join(ROOT, "supabase/baseline", BASELINE), "utf8");
  for (const file of LEGACY) baseline += "\n-- Historical migration: " + file + "\n" + fs.readFileSync(path.join(ROOT, "supabase/migrations", file), "utf8");
  baseline += "\n-- Restore the inspected schema after historical replay. Local only.\n";
  for (const table of ["week_days", "shopping_lists", "shopping_items"]) {
    for (const op of ["select", "insert", "update", "delete"]) baseline += 'DROP POLICY "' + table + "_" + op + '_own_week" ON public.' + table + ";\n";
  }
  const metadata = JSON.parse(fs.readFileSync(path.join(ROOT, "supabase/baseline/remote-metadata.json"), "utf8"));
  baseline += "ALTER TABLE public.profiles DROP CONSTRAINT profiles_goals_allowed_chk;\nALTER TABLE public.profiles ADD CONSTRAINT profiles_goals_allowed_chk " + metadata.constraints.find(c => c.conname === "profiles_goals_allowed_chk").definition + ";\n";
  fs.writeFileSync(path.join(WORK, "supabase/migrations", BASELINE), baseline);
  const future = fs.readdirSync(path.join(ROOT, "supabase/migrations")).filter(f => f.endsWith(".sql") && !LEGACY.includes(f));
  for (const file of future) {
    if (file <= BASELINE) throw new Error("Future migrations must sort after the local baseline.");
    fs.copyFileSync(path.join(ROOT, "supabase/migrations", file), path.join(WORK, "supabase/migrations", file));
  }
  const expected = new Set([BASELINE, ...future]);
  for (const file of fs.readdirSync(path.join(WORK, "supabase/migrations"))) {
    if (!expected.has(file)) throw new Error("Stale local migration; inspect the generated workspace before continuing.");
  }
}
function enableMigrations() {
  const file = path.join(WORK, "supabase/config.toml");
  fs.writeFileSync(file, fs.readFileSync(file, "utf8").replace(/(\[db.migrations\][\s\S]*?)enabled = false/, "$1enabled = true"));
}
function localApi() {
  verifiedContainer();
  const gateway = JSON.parse(run("docker", ["inspect", "supabase_kong_" + PROJECT]))[0];
  if (gateway.Config.Labels?.["com.supabase.cli.project"] !== PROJECT || !gateway.State.Running) throw new Error("API container identity mismatch.");
  const binding = gateway.NetworkSettings.Ports["8000/tcp"];
  if (!binding?.some(p => p.HostPort === "54321")) throw new Error("Unexpected local API port.");
  const status = JSON.parse(cli(["status", "-o", "json"]));
  if (status.API_URL !== "http://127.0.0.1:54321") throw new Error("Unexpected local API address.");
  if (!status.ANON_KEY) throw new Error("Missing locally generated anon key.");
  return { url: status.API_URL, key: status.ANON_KEY };
}
async function main(command) {
  if (command === "start") {
    prepare();
    console.log("Starting dedicated local Supabase (first run downloads Docker images)...");
    cli(["start", "-x", "realtime,storage-api,imgproxy,edge-runtime,logflare,vector,supavisor"]);
    verifiedContainer(false);
    enableMigrations();
    cli(["migration", "up", "--local"]);
    verifiedContainer();
    console.log("Local Supabase ready. Run npm run db:seed.");
  } else if (command === "migrate") {
    verifiedContainer();
    prepare();
    enableMigrations();
    cli(["migration", "up", "--local"]);
    console.log("Local migrations applied.");
  } else if (command === "reset") {
    verifiedContainer();
    prepare();
    enableMigrations();
    cli(["db", "reset", "--local", "--no-seed"]);
    verifiedContainer();
    console.log("Dedicated local database rebuilt; fixtures must be loaded explicitly.");
  } else if (command === "seed") {
    sql(fs.readFileSync(path.join(ROOT, "supabase/seed.sql"), "utf8"));
    console.log("Synthetic fixtures loaded (existing rows are never overwritten).");
  } else if (command === "stop") {
    verifiedContainer();
    cli(["stop"]);
    console.log("Local Supabase stopped; volumes preserved.");
  } else if (command === "dev") {
    const api = localApi();
    const env = { ...safeEnv(), NEXT_PUBLIC_SUPABASE_URL: api.url, NEXT_PUBLIC_SUPABASE_ANON_KEY: api.key, OPENAI_API_KEY: "", NEXT_TELEMETRY_DISABLED: "1" };
    const child = spawnSync(process.execPath, [path.join(ROOT, "node_modules/next/dist/bin/next"), "dev", "--webpack", "--disable-source-maps"], { cwd: ROOT, env, stdio: "inherit" });
    process.exitCode = child.status ?? 1;
  } else throw new Error("Use start, migrate, reset, seed, stop or dev. Arbitrary CLI arguments are forbidden.");
}
module.exports = { ROOT, WORK, PROJECT, BASELINE, LEGACY, safeEnv, assertEndpoint, assertContainer, verifiedContainer, sql, localApi, run };
if (require.main === module) {
  if (process.argv.length !== 3) throw new Error("Exactly one local command is required.");
  main(process.argv[2]).catch(error => { console.error(error.message); process.exitCode = 1; });
}
