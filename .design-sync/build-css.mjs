// Builds ds-css/styles.css from globals.css via Tailwind v4 PostCSS.
// Run before the converter: `node .design-sync/build-css.mjs`
// Re-run when globals.css changes or Tailwind classes in components change.

import { readFileSync, writeFileSync, mkdirSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

const postcss = (await import(join(root, "node_modules/postcss/lib/postcss.js"))).default;

const twPkg = JSON.parse(readFileSync(join(root, "node_modules/@tailwindcss/postcss/package.json"), "utf8"));
const twEntry = twPkg.exports?.["."];
const twPath = join(root, "node_modules/@tailwindcss/postcss", typeof twEntry === "string" ? twEntry : (twEntry?.import || twEntry?.default || "dist/index.mjs"));
const plugin = (await import(twPath)).default;

const input = join(root, "src/app/globals.css");
const outDir = join(root, "ds-css");
const output = join(outDir, "styles.css");

mkdirSync(outDir, { recursive: true });

const result = await postcss([plugin()]).process(readFileSync(input, "utf8"), { from: input, to: output });
writeFileSync(output, result.css);
console.log(`css: ${result.css.length} chars → ds-css/styles.css`);
