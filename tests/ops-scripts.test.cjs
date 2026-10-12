const {test} = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const {spawnSync} = require("node:child_process");

// P37: backup and restore scripts. Nothing here connects to a database: only the checks that run
// before any password or network access, the row counter and the static safety rules.
const root = path.resolve(__dirname, "..");
const backup = path.join(root, "scripts/ops/backup-production.sh");
const drill = path.join(root, "scripts/ops/restore-drill.cjs");
const {countDumpRows, formatCounts, parseCounts} = require("../scripts/ops/count-dump-rows.cjs");
// Safety net if a check ever regressed: a fake `security` with no password and an empty stdin,
// so the script could never obtain the production password from these tests.
const fakeBin = fs.mkdtempSync(path.join(os.tmpdir(), "becook-ops-bin-"));
fs.writeFileSync(path.join(fakeBin, "security"), "#!/bin/sh\nexit 1\n", {mode: 0o755});
const env = {PATH: fakeBin + path.delimiter + process.env.PATH, HOME: os.tmpdir()};

function tempDir() {
 return fs.mkdtempSync(path.join(os.tmpdir(), "becook-ops-test-"));
}

test("backup script: production ref, private files, COPY format, minimal environment and redacted errors", () => {
 const source = fs.readFileSync(backup, "utf8");
 assert.match(source, /REF="wejvptpkxlllfpskyisu"/);
 assert.match(source, /^umask 077$/m);
 assert.match(source, /--data-only --use-copy/);
 assert.match(source, /--role-only/);
 assert.match(source, /env -i PATH="\$PATH" HOME="\$HOME"/);
 assert.match(source, /security find-generic-password -a "postgres\.\$REF" -s becook-prod-db -w/);
 assert.match(source, /read -rs /);
 assert.match(source, /counts\.txt/);
 assert.match(source, /SHA256SUMS/);
 assert.match(source, /2> >\(redact\)/);
 assert.doesNotMatch(source, /echo[^\n]*\$\{?(pw|enc|url)\b/, "the password or URL is never printed");
 assert.doesNotMatch(source, /set -x/);
 assert.doesNotMatch(source, /db push|db reset|psql/, "read-only: no writes to production");
});

test("backup script: refuses a bad label or a destination inside the repository before asking for the password", () => {
 const bad = spawnSync("bash", [backup, "../fuera"], {env, input: "", encoding: "utf8"});
 assert.equal(bad.status, 2);
 assert.match(bad.stderr, /Etiqueta no válida/);
 const insideBase = path.join(root, "tmp-backups-test");
 const inside = spawnSync("bash", [backup, "x"], {env: {...env, BECOOK_BACKUP_DIR: insideBase}, input: "", encoding: "utf8"});
 assert.equal(inside.status, 2);
 assert.match(inside.stderr, /dentro del repositorio/);
 assert.equal(fs.existsSync(insideBase), false, "no directory created in the repository");
});

test("backup script: never overwrites an existing backup", () => {
 const base = tempDir();
 fs.mkdirSync(path.join(base, "2026-10-15"));
 fs.writeFileSync(path.join(base, "2026-10-15", "data.sql"), "x");
 const result = spawnSync("bash", [backup, "2026-10-15"], {env: {...env, BECOOK_BACKUP_DIR: base}, input: "", encoding: "utf8"});
 assert.equal(result.status, 2);
 assert.match(result.stderr, /nunca se sobrescribe/);
 fs.rmSync(base, {recursive: true, force: true});
});

test("row counter: COPY blocks per table, sorted; INSERT dumps and truncated dumps are refused", async () => {
 const dir = tempDir();
 const file = path.join(dir, "data.sql");
 fs.writeFileSync(file, [
  "SET session_replication_role = replica;",
  "COPY \"public\".\"weeks\" (\"id\", \"title\") FROM stdin;", "1\tSemana\\nuno", "2\tSemana dos", "\\.",
  "COPY \"auth\".\"users\" (\"id\") FROM stdin;", "u1", "\\.",
  "COPY \"storage\".\"buckets\" (\"id\") FROM stdin;", "\\.",
  "RESET ALL;", "",
 ].join("\n"));
 const counts = await countDumpRows(file);
 assert.equal(formatCounts(counts), "auth.users\t1\npublic.weeks\t2\nstorage.buckets\t0\n");
 assert.deepEqual(parseCounts(formatCounts(counts)), counts);
 fs.writeFileSync(file, "INSERT INTO \"public\".\"weeks\" (\"id\") VALUES\n\t(1);\n");
 await assert.rejects(countDumpRows(file), /--use-copy/);
 fs.writeFileSync(file, "COPY \"public\".\"weeks\" (\"id\") FROM stdin;\n1\n");
 await assert.rejects(countDumpRows(file), /incomplete/);
 assert.throws(() => parseCounts("public.weeks 2\n"), /Malformed/);
 fs.rmSync(dir, {recursive: true, force: true});
});

test("restore drill: local container only, throw-away database, schema and ownership checks, usage before Docker", () => {
 const source = fs.readFileSync(drill, "utf8");
 assert.match(source, /verifiedContainer\(\)/);
 assert.match(source, /const DRILL_DB = "becook_restore_drill"/);
 assert.match(source, /postgresql:\/\/postgres:postgres@127\.0\.0\.1:54322\/postgres/);
 assert.doesNotMatch(source, /supabase\.co|pooler\.supabase\.com|wejvptpkxlllfpskyisu|qdhpdhnpcsfhmygjofqb/);
 assert.doesNotMatch(source, /db reset|DROP DATABASE IF EXISTS postgres|TRUNCATE/);
 assert.match(source, /session_replication_role = replica/);
 assert.match(source, /User rows without their Auth user/);
 assert.match(source, /finally \{[\s\S]*DROP DATABASE IF EXISTS " \+ DRILL_DB/);
 const usage = spawnSync(process.execPath, [drill], {env, encoding: "utf8"});
 assert.equal(usage.status, 1);
 assert.match(usage.stderr, /Usage/);
});
