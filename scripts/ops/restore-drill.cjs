/* eslint-disable @typescript-eslint/no-require-imports -- CommonJS script; eslint.config.mjs only covers scripts/*.cjs */
// P37: restore drill. Restores a backup (schema.sql + data.sql made by backup-production.sh, or a
// fresh dump of the LOCAL database with --from-local) into a throw-away database
// "becook_restore_drill" inside the verified local Docker container, compares the rows per table
// with counts.txt, checks that every user row still has its Auth user, and drops the database.
// The shared local database "postgres" is never modified, so other local work is not disturbed.
// It never connects to a hosted project: the only target is the container verified by
// scripts/local-supabase.cjs. Prints counts and timings only, never row contents.
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { execFileSync } = require("node:child_process");
const { ROOT, verifiedContainer, safeEnv } = require("../local-supabase.cjs");
const { countDumpRows, formatCounts, parseCounts } = require("./count-dump-rows.cjs");

const DRILL_DB = "becook_restore_drill";
const LOCAL_URL = "postgresql://postgres:postgres@127.0.0.1:54322/postgres";
const CLI = path.join(ROOT, "node_modules/.bin/supabase");
// What a new Supabase project already has before a restore (platform schemas). They are copied
// (structure only) from the local stack; the backup brings the application schema and all data.
const PLATFORM_SCHEMAS = ["auth", "storage", "extensions", "supabase_functions", "vault", "realtime", "_realtime", "graphql", "graphql_public"];
// Tables whose rows belong to a user: after the restore each must still find its auth.users row.
const OWNED = [
  ["profiles", "user_id"], ["weeks", "user_id"], ["pantry_items", "user_id"], ["menu_generation_requests", "user_id"],
  ["onboarding_progress", "user_id"], ["week_food_contexts", "user_id"], ["recipes", "owner_user_id"], ["ai_usage_events", "user_id"],
];

function quiet(binary, args, { input, user = "postgres", db } = {}) {
  try {
    return execFileSync(binary, args, { env: safeEnv(), input, encoding: "utf8", maxBuffer: 64 * 1024 * 1024, stdio: ["pipe", "pipe", "pipe"] });
  } catch (error) {
    // psql errors may quote row contents: report the first error line without values.
    const first = String(error.stderr || "").split("\n").find((line) => /ERROR/.test(line)) || "";
    throw new Error("Command failed (" + path.basename(binary) + (db ? " " + db : "") + " as " + user + "): " + first.replace(/\(.*\)/g, "(…)").slice(0, 200));
  }
}

function psql(container, db, statement, { user = "postgres", stopOnError = true } = {}) {
  const args = ["exec", "-i", container, "psql", "-X", "-q", "-U", user, "-d", db, "-At"];
  if (stopOnError) args.push("-v", "ON_ERROR_STOP=1");
  return quiet("docker", args, { input: statement, user, db });
}

function dumpLocal(dir) {
  for (const [args, file] of [[[], "schema.sql"], [["--data-only", "--use-copy"], "data.sql"], [["--role-only"], "roles.sql"]]) {
    quiet(CLI, ["db", "dump", "--db-url", LOCAL_URL, ...args, "-f", path.join(dir, file)]);
  }
}

async function main(argv) {
  const started = Date.now();
  const fromLocal = argv.length === 1 && argv[0] === "--from-local";
  if (!fromLocal && !(argv.length === 1 && !argv[0].startsWith("-"))) {
    throw new Error("Usage: bash scripts/ops/restore-drill.sh --from-local | <backup directory>");
  }
  const container = verifiedContainer();
  let dir;
  if (fromLocal) {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "becook-restore-drill-"));
    fs.chmodSync(dir, 0o700);
    console.log("Dumping the local database (synthetic data) with the same commands as the production backup…");
    dumpLocal(dir);
    fs.writeFileSync(path.join(dir, "counts.txt"), formatCounts(await countDumpRows(path.join(dir, "data.sql"))), { mode: 0o600 });
  } else {
    dir = path.resolve(argv[0]);
  }
  for (const file of ["schema.sql", "data.sql", "roles.sql", "counts.txt"]) {
    if (!fs.existsSync(path.join(dir, file))) throw new Error("Missing " + file + " in the backup directory.");
  }
  const expected = parseCounts(fs.readFileSync(path.join(dir, "counts.txt"), "utf8"));
  const recount = await countDumpRows(path.join(dir, "data.sql"));
  if (formatCounts(recount) !== formatCounts(expected)) throw new Error("counts.txt does not match data.sql: the backup is inconsistent.");

  const dumpedAt = Date.now();
  psql(container, "postgres", "DROP DATABASE IF EXISTS " + DRILL_DB + " WITH (FORCE);", { user: "supabase_admin" });
  psql(container, "postgres", "CREATE DATABASE " + DRILL_DB + " OWNER postgres;", { user: "supabase_admin" });
  try {
    // 1. Platform (what a new project provides): structure of its schemas, from the local stack.
    const platform = quiet("docker", ["exec", container, "pg_dump", "-U", "supabase_admin", "-d", "postgres", "--schema-only",
      ...PLATFORM_SCHEMAS.flatMap((schema) => ["-n", schema])]);
    psql(container, DRILL_DB, platform, { user: "supabase_admin", stopOnError: false });
    // Per-database objects of a new project that the application schema refers to.
    psql(container, DRILL_DB, "DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime') THEN CREATE PUBLICATION supabase_realtime; END IF; END $$; ALTER PUBLICATION supabase_realtime OWNER TO postgres;", { user: "supabase_admin" });
    // 2. The backup: application schema, then data with triggers off (as the dump itself sets).
    psql(container, DRILL_DB, fs.readFileSync(path.join(dir, "schema.sql"), "utf8"));
    // Data as the platform administrator: the platform's own tables (storage.*, empty in beCook)
    // are not writable by postgres locally. See docs/operations/runbook.md for a hosted restore.
    psql(container, DRILL_DB, "SET session_replication_role = replica;\n" + fs.readFileSync(path.join(dir, "data.sql"), "utf8"), { user: "supabase_admin" });
    const restoredAt = Date.now();

    // 3. Rows per table and ownership.
    const lines = [];
    let mismatches = 0;
    for (const [table, rows] of expected) {
      const [schema, name] = table.split(".");
      const actual = Number(psql(container, DRILL_DB, 'SELECT count(*) FROM "' + schema + '"."' + name + '";').trim());
      if (actual !== rows) mismatches++;
      if (rows > 0 || actual > 0) lines.push((actual === rows ? "OK   " : "DIFF ") + table + " " + rows + " → " + actual);
    }
    const orphans = OWNED.map(([table, column]) => {
      const exists = psql(container, DRILL_DB, "SELECT to_regclass('public." + table + "') IS NOT NULL;").trim() === "t";
      if (!exists) return [table, 0];
      return [table, Number(psql(container, DRILL_DB, "SELECT count(*) FROM public." + table + " t WHERE t." + column + " IS NOT NULL AND NOT EXISTS (SELECT 1 FROM auth.users u WHERE u.id = t." + column + ");").trim())];
    }).filter(([, n]) => n > 0);
    // 4. Application schema: tables, RLS, policies, constraints, functions and grants.
    const inspect = fs.readFileSync(path.join(ROOT, "supabase/baseline/inspect.sql"), "utf8");
    const restored = JSON.parse(psql(container, DRILL_DB, inspect).trim());
    const schemaKeys = ["columns", "tables", "constraints", "indexes", "policies", "functions", "triggers", "grants"];
    const sorted = (rows) => (rows || []).map((row) => JSON.stringify(row)).sort();
    let schemaDiffs = [];
    if (argv[0] === "--from-local") {
      const source = JSON.parse(psql(container, "postgres", inspect).trim());
      // PostgreSQL deparses this associative AND with one pair of brackets fewer after a dump and
      // reload (same equivalence as scripts/verify-preview-metadata.cjs); only that exact form is accepted.
      const equivalent = "CHECK ((((iso_year IS NULL) AND (iso_week IS NULL)) OR ((iso_year >= 2000) AND (iso_year <= 2100) AND ((iso_week >= 1) AND (iso_week <= 53)))))";
      const canonical = (source.constraints || []).find((c) => c.conname === "weeks_iso_week_range_chk")?.definition;
      for (const c of restored.constraints || []) if (c.conname === "weeks_iso_week_range_chk" && c.definition === equivalent && canonical) c.definition = canonical;
      schemaDiffs = schemaKeys.filter((key) => JSON.stringify(sorted(source[key])) !== JSON.stringify(sorted(restored[key])));
    }
    const rlsOff = (restored.tables || []).filter((table) => !table.relrowsecurity).map((table) => table.relname);
    console.log(lines.join("\n"));
    console.log("Schema restored: " + (restored.tables || []).length + " tables, " + (restored.policies || []).length + " policies, " +
      (restored.functions || []).length + " functions; tables without RLS: " + (rlsOff.length ? rlsOff.join(", ") : "none") + "." +
      (argv[0] === "--from-local" ? " Differences with the source: " + (schemaDiffs.length ? schemaDiffs.join(", ") : "none") + "." : ""));
    console.log("Tables compared: " + expected.size + "; with rows: " + lines.length + "; differences: " + mismatches + ".");
    console.log("User rows without their Auth user: " + (orphans.length ? orphans.map(([t, n]) => t + "=" + n).join(", ") : "none") + ".");
    console.log("Timings: preparation " + Math.round((dumpedAt - started) / 1000) + " s, restore " + Math.round((restoredAt - dumpedAt) / 1000) + " s.");
    if (mismatches || orphans.length || schemaDiffs.length || rlsOff.length) throw new Error("Restore drill FAILED.");
    console.log("Restore drill PASSED. The throw-away database is dropped; the local database was not touched.");
  } finally {
    psql(container, "postgres", "DROP DATABASE IF EXISTS " + DRILL_DB + " WITH (FORCE);", { user: "supabase_admin" });
    if (argv[0] === "--from-local") fs.rmSync(dir, { recursive: true, force: true });
  }
}

main(process.argv.slice(2)).catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
