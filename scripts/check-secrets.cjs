// Scan the complete index, not the working tree or a potentially partial diff.
// Child output is captured: only file/rule/line metadata may reach the terminal.
const { spawnSync } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const project = path.resolve(__dirname, "..");
const localBinary = path.join(project, ".tools", "gitleaks");
const binary = process.env.GITLEAKS_BIN || (fs.existsSync(localBinary) ? localBinary : "gitleaks");
const options = { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 };

function git(args) {
  const result = spawnSync("git", args, { ...options, encoding: null });
  if (result.error || result.status !== 0) throw new Error("git");
  return result.stdout;
}

function forbiddenFile(name) {
  const base = path.posix.basename(name);
  const template = /^\.env\.(example|sample|template)$/.test(base);
  return /(?:recovery|backup).*codes/i.test(base) ||
    (base.startsWith(".env") && !template) ||
    /\.(pem|key|p12|pfx)$/i.test(base) ||
    /^(id_rsa|id_ed25519|credentials\.json|service-account.*\.json)$/i.test(base) ||
    /(^|\/)(\.aws|\.vercel)(\/|$)/.test(name) ||
    /(^|\/)\.config\/gcloud\//.test(name) ||
    /^(\.supabase-local\/|supabase\/\.(temp|branches)\/)/.test(name);
}

function main() {
  let temporary;
  try {
    if (process.argv.length !== 2) throw new Error("arguments");
    const version = spawnSync(binary, ["version"], options);
    if (version.error || version.status !== 0 || version.stdout.trim() !== "8.30.1") {
      console.error("Se requiere Gitleaks 8.30.1. Consulta docs/security/secret-detection.md.");
      return 2;
    }
    temporary = fs.mkdtempSync(path.join(os.tmpdir(), "becook-secret-index-"));
    const snapshot = path.join(temporary, "index");
    fs.mkdirSync(snapshot);
    const entries = git(["ls-files", "--stage", "-z"]).toString("utf8").split("\0").filter(Boolean);
    let blocked = false;
    for (const entry of entries) {
      const tab = entry.indexOf("\t");
      const [mode, object, stage] = entry.slice(0, tab).split(" ");
      const name = entry.slice(tab + 1);
      // Refuse unresolved merges/submodules rather than silently skipping data.
      if (stage !== "0" || mode === "160000") throw new Error("unsupported index entry");
      if (forbiddenFile(name)) {
        console.error(JSON.stringify({ file: name, rule: "local-credential-file", status: "blocked" }));
        blocked = true;
        continue;
      }
      const destination = path.resolve(snapshot, name);
      if (!destination.startsWith(snapshot + path.sep)) throw new Error("path");
      fs.mkdirSync(path.dirname(destination), { recursive: true });
      // Symlink blobs are written as text; never dereference external targets.
      fs.writeFileSync(destination, git(["cat-file", "blob", object]), { mode: 0o600 });
    }
    const result = spawnSync(binary, [
      "dir", ".", "--config", path.join(project, ".gitleaks.toml"),
      "--redact=100", "--no-banner", "--no-color", "--exit-code=42",
      "--ignore-gitleaks-allow", "--gitleaks-ignore-path", temporary,
      "--report-format=json", "--report-path=-", "--max-archive-depth=2",
    ], { ...options, cwd: snapshot });
    if (result.error || ![0, 42].includes(result.status)) throw new Error("scanner");
    const findings = JSON.parse(result.stdout || "[]");
    if (!Array.isArray(findings)) throw new Error("report");
    for (const finding of findings) {
      console.error(JSON.stringify({ file: finding.File, rule: finding.RuleID, line: finding.StartLine, status: "blocked" }));
    }
    if (blocked || findings.length || result.status === 42) return 1;
    console.log(`Sin hallazgos en ${entries.length} archivos del índice de Git.`);
    return 0;
  } catch {
    // Never print the exception, subprocess stderr, source lines or matches.
    console.error("No se pudo completar la comprobación de secretos; commit bloqueado. Revisa Git, la configuración y Gitleaks.");
    return 2;
  } finally {
    if (temporary) fs.rmSync(temporary, { recursive: true, force: true });
  }
}

process.exitCode = main();
