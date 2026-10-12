/* eslint-disable @typescript-eslint/no-require-imports -- CommonJS script; eslint.config.mjs only covers scripts/*.cjs */
// P37: rows per table in a data-only dump made with --use-copy (one row per line between
// "COPY ... FROM stdin;" and "\."). Prints "schema.table<TAB>rows", sorted. Reads only the file
// given; prints counts, never row contents.
const fs = require("node:fs");
const readline = require("node:readline");

async function countDumpRows(file) {
  const counts = new Map();
  let current = null;
  let inserts = false;
  const lines = readline.createInterface({ input: fs.createReadStream(file, { encoding: "utf8" }), crlfDelay: Infinity });
  for await (const line of lines) {
    if (current) {
      if (line === "\\.") current = null;
      else counts.set(current, counts.get(current) + 1);
      continue;
    }
    const copy = /^COPY "?([^".\s]+)"?\."?([^"\s]+)"? .*FROM stdin;$/.exec(line);
    if (copy) {
      current = copy[1] + "." + copy[2];
      if (!counts.has(current)) counts.set(current, 0);
    } else if (/^INSERT INTO /.test(line)) {
      inserts = true;
    }
  }
  if (current) throw new Error("Unterminated COPY block: the dump is incomplete.");
  if (inserts) throw new Error("The dump uses INSERT statements: make it with --use-copy to count rows.");
  return new Map([...counts.entries()].sort(([a], [b]) => a.localeCompare(b)));
}

function formatCounts(counts) {
  return [...counts.entries()].map(([table, rows]) => table + "\t" + rows).join("\n") + "\n";
}

function parseCounts(text) {
  const counts = new Map();
  for (const line of text.split("\n")) {
    if (!line.trim()) continue;
    const match = /^([A-Za-z0-9_]+\.[A-Za-z0-9_]+)\t(\d+)$/.exec(line);
    if (!match) throw new Error("Malformed counts line.");
    counts.set(match[1], Number(match[2]));
  }
  return counts;
}

module.exports = { countDumpRows, formatCounts, parseCounts };

if (require.main === module) {
  if (process.argv.length !== 3) {
    console.error("Usage: node scripts/ops/count-dump-rows.cjs <data.sql>");
    process.exit(2);
  }
  countDumpRows(process.argv[2])
    .then((counts) => process.stdout.write(formatCounts(counts)))
    .catch((error) => { console.error(error.message); process.exitCode = 1; });
}
