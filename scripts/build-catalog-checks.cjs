// Writes src/data/recipe-cards/catalog-checks.json from catalog-recipes.json: for each catalogue
// recipe, only what the restriction check reads (ingredient names, optional ones as [name, 1], and
// the EU-14 allergens, and its total minutes). Small enough for the browser, so Crear menú, «Otra idea» and the
// nutritionist's plan check the recipe and not only its title (N01).
// Run after editing catalog-recipes.json: node scripts/build-catalog-checks.cjs
// tests/restriction-check.test.cjs fails when the two files disagree.
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const source = path.join(root, "src/data/recipe-cards/catalog-recipes.json");
const target = path.join(root, "src/data/recipe-cards/catalog-checks.json");

function catalogChecks(file) {
  const recipes = {};
  for (const entry of file.recipes) {
    recipes[entry.title] = {
      i: entry.card.ingredients.map((ingredient) => (ingredient.optional ? [ingredient.name, 1] : ingredient.name)),
      a: entry.card.possibleAllergens,
      t: entry.card.totalMinutes,
    };
  }
  return { generatedFrom: "src/data/recipe-cards/catalog-recipes.json", recipes };
}

module.exports = { catalogChecks };

if (require.main === module) {
  const file = JSON.parse(fs.readFileSync(source, "utf8"));
  fs.writeFileSync(target, `${JSON.stringify(catalogChecks(file))}\n`);
  console.log(`catalog-checks.json: ${file.recipes.length} recetas`);
}
