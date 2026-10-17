// Writes src/data/recipe-cards/catalog-tags.json: the nutritional tags of every catalogue recipe
// (N07, src/lib/menu-generation/recipe-tags.ts), computed from catalog-recipes.json. Estimates,
// pending review like the recipes. Run after editing the recipes or the rules:
// node scripts/build-catalog-tags.cjs   (tests/nutrition-quality.test.cjs fails when out of date)
const fs = require("node:fs");
const path = require("node:path");
require("./register-typescript.cjs");
const { recipeTags } = require("../src/lib/menu-generation/recipe-tags.ts");

const root = path.resolve(__dirname, "..");
const source = path.join(root, "src/data/recipe-cards/catalog-recipes.json");
const target = path.join(root, "src/data/recipe-cards/catalog-tags.json");

function catalogTags(file) {
  const recipes = {};
  for (const entry of file.recipes) recipes[entry.title] = recipeTags(entry.title, entry.card);
  return { status: "pending_review", generatedFrom: "src/data/recipe-cards/catalog-recipes.json", recipes };
}

module.exports = { catalogTags };

if (require.main === module) {
  const file = JSON.parse(fs.readFileSync(source, "utf8"));
  fs.writeFileSync(target, `${JSON.stringify(catalogTags(file))}\n`);
  console.log(`catalog-tags.json: ${file.recipes.length} recetas`);
}
