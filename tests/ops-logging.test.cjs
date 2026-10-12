const {test} = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

// P37: server logs carry events and figures, never prompts, menus, profiles, e-mails or IDs of
// people. Static check of every console.* call in server code (routes, server modules, OpenAI
// configuration, menu generation, instrumentation), plus the shape of the objects they log.
const root = path.resolve(__dirname, "..");
const serverDirs = ["src/app/api", "src/lib/server", "src/lib/openai", "src/lib/menu-generation", "src/lib/recipes"];
const serverFiles = ["src/instrumentation.ts"];

function walk(dir) {
 const full = path.join(root, dir);
 if (!fs.existsSync(full)) return [];
 return fs.readdirSync(full, {withFileTypes: true}).flatMap(entry => {
  const relative = path.join(dir, entry.name);
  if (entry.isDirectory()) return walk(relative);
  return /\.(ts|tsx)$/.test(entry.name) ? [relative] : [];
 });
}

// Text of each console call's arguments, with balanced parentheses.
function consoleCalls(source) {
 const calls = [];
 const pattern = /console\.(log|info|warn|error|debug)\s*\(/g;
 let match;
 while ((match = pattern.exec(source))) {
  let depth = 1;
  let index = pattern.lastIndex;
  let quote = null;
  for (; index < source.length && depth > 0; index++) {
   const char = source[index];
   if (quote) {
    if (char === "\\") index++;
    else if (char === quote) quote = null;
   } else if (char === "\"" || char === "'" || char === "`") quote = char;
   else if (char === "(") depth++;
   else if (char === ")") depth--;
  }
  calls.push({level: match[1], args: source.slice(pattern.lastIndex, index - 1)});
 }
 return calls;
}

const stripStrings = text => text.replace(/`(?:\\.|[^`\\])*`|"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'/g, "\"\"");
// Identifiers that would put content or a person in the logs.
const forbidden = /\b(prompt|userPrompt|freeTextPrompt|messages|content|body|text|profile|dish|dishes|dishName|title|ingredients|steps|email|user|userId|accessToken|token|ip|ipHash|menu|selection|input|week|items|card|error|err|headers|request)\b/;

const files = [...serverDirs.flatMap(walk), ...serverFiles.filter(file => fs.existsSync(path.join(root, file)))];

test("server code is scanned (routes, server modules and instrumentation)", () => {
 for (const expected of ["src/app/api/account/export/route.ts", "src/app/api/account/delete/route.ts", "src/lib/server/ai-usage.ts", "src/lib/server/ops-alert.ts", "src/instrumentation.ts"]) {
  assert.ok(files.includes(expected), expected);
 }
});

for (const file of files) {
 const calls = consoleCalls(fs.readFileSync(path.join(root, file), "utf8"));
 if (!calls.length) continue;
 test(`${file}: console calls log an event name and figures only`, () => {
  for (const {level, args} of calls) {
   assert.match(args.trim(), /^["'`]/, `${file}: console.${level} must start with a fixed event name`);
   const rest = stripStrings(args).replace(/^""\s*,?/, "");
   const hit = forbidden.exec(rest);
   assert.equal(hit, null, `${file}: console.${level}(${args.slice(0, 80)}…) references «${hit?.[1]}»`);
  }
 });
}

test("the objects logged as telemetry and attempts hold no content fields", () => {
 const typeBody = (file, name) => {
  const source = fs.readFileSync(path.join(root, file), "utf8");
  const start = source.indexOf(`export type ${name} =`);
  assert.ok(start >= 0, name);
  return source.slice(start, source.indexOf("};", start) + 2);
 };
 for (const [file, name] of [["src/lib/importMenu.ts", "OpenAIMenuGenerationTelemetry"], ["src/lib/menu-generation/runtime.ts", "MenuAttempt"]]) {
  const fields = [...typeBody(file, name).matchAll(/(\w+)\??:/g)].map(m => m[1]).filter(field => field !== name);
  for (const field of fields) assert.equal(forbidden.test(field), false, `${name}.${field}`);
 }
});

test("alerts drop any field that is not on the allow-list", () => {
 const {sanitizeAlertFields} = require("../src/lib/server/ops-alert.ts");
 const cleaned = sanitizeAlertFields({flow: "menu", prompt: "x", email: "a@b.c", dishes: ["y"], profile: {}, userId: "u", route: "/week?q=1"});
 assert.deepEqual(cleaned, {flow: "menu", route: "/week"});
});
