const { test } = require("node:test");
const assert = require("node:assert/strict");
const { spawnSync } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const scanner = path.resolve(__dirname, "../scripts/check-secrets.cjs");

test("forced Supabase local artifacts are blocked without exposing contents", () => fixture(({git,write,scan}) => {
  write(".supabase-local/supabase/status.json", "synthetic local artifact");
  write("supabase/.temp/project-ref", "synthetic project marker");
  git("add", "-f", ".");
  const result = scan();
  assert.equal(result.status, 1);
  assert.ok(result.stderr.includes("local-credential-file"));
  assert.ok(!result.stderr.includes("synthetic local artifact"));
}));

function fixture(run) {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "becook-secrets-test-"));
  const git = (...args) => {
    const result = spawnSync("git", args, { cwd, encoding: "utf8" });
    assert.equal(result.status, 0, "fixture Git command failed");
  };
  const write = (name, value) => {
    fs.mkdirSync(path.dirname(path.join(cwd, name)), { recursive: true });
    fs.writeFileSync(path.join(cwd, name), value);
  };
  const scan = (extraEnv = {}) => spawnSync(process.execPath, [scanner], {
    cwd, encoding: "utf8", env: { ...process.env, ...extraEnv },
  });
  try {
    git("init", "--quiet");
    run({ git, write, scan });
  } finally {
    fs.rmSync(cwd, { recursive: true, force: true });
  }
}

test("clean staged template passes; untracked files are not included", () => fixture(({ git, write, scan }) => {
  write(".env.example", "SERVICE_TOKEN=\n");
  git("add", ".env.example");
  write(".env.local", "local only");
  assert.equal(scan().status, 0);
}));

test("synthetic staged token fails even when worktree is clean, without leaking output", () => fixture(({ git, write, scan }) => {
  const fake = "ghp_" + "Ab9xQ2mN7vR4sT6uW8yZ1cD3eF5gH0jK9pL2";
  write("settings.txt", `TOKEN=${fake}\n`);
  git("add", "settings.txt");
  write("settings.txt", "clean working copy\n");
  const result = scan();
  assert.equal(result.status, 1);
  const output = result.stdout + result.stderr;
  assert.ok(output.includes("github-pat"));
  assert.ok(!output.includes(fake));
  assert.ok(!output.includes(fake.slice(4, 16)));
  git("add", "settings.txt");
  assert.equal(scan().status, 0);
}));

test("empty recovery exports and forced local credential files are blocked", () => fixture(({ git, write, scan }) => {
  for (const name of ["vercel/recovery-codes.txt", "backup_codes.txt", ".env.local", "private.key", ".vercel/auth.json"]) {
    write(name, "");
    git("add", "--force", name);
    const result = scan();
    assert.equal(result.status, 1);
    assert.ok(result.stderr.includes("local-credential-file"));
    git("rm", "--cached", name);
  }
}));

test("staged deletion permits retained local recovery copy", () => fixture(({ git, write, scan }) => {
  write("vercel/recovery-codes.txt", "synthetic recovery placeholder");
  git("add", "vercel/recovery-codes.txt");
  git("-c", "user.name=Secret Test", "-c", "user.email=test@example.invalid", "-c", "core.hooksPath=/dev/null", "commit", "--quiet", "-m", "synthetic fixture");
  git("rm", "--cached", "vercel/recovery-codes.txt");
  assert.equal(scan().status, 0);
}));

test("missing scanner fails closed without dumping subprocess errors", () => fixture(({ write, scan }) => {
  write("safe.txt", "safe");
  const result = scan({ GITLEAKS_BIN: "/nonexistent/becook-gitleaks" });
  assert.equal(result.status, 2);
  assert.ok(result.stderr.includes("Se requiere Gitleaks"));
}));
