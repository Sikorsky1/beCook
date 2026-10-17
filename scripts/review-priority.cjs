// N08: the catalogue recipes in the order a professional should review them: how often Crear menú
// proposes each one (simulated weeks, every type and level, no account, no network).
// node scripts/review-priority.cjs > docs/nutricion/revision-fichas-prioridad.md
require("./register-typescript.cjs");
const { catalogMenu } = require("../src/lib/menu-generation/catalog-menu.ts");
const { readMenuProfile } = require("../src/lib/menu-generation/prompt.ts");
const { catalogTags } = require("../src/lib/recipes/catalogTags.ts");

const counts = new Map();
let weeks = 0;
const profiles = [{}, { dietaryRestrictions: ["vegetarian"] }, { allergies: ["gluten"] }, { goals: ["more_plants"] }];
for (const profile of profiles.map(readMenuProfile)) {
  for (const styles of [["healthy_balanced"], ["mediterranean"], ["quick_simple"]]) {
    for (const elaboration of ["simple", "balanced", "elaborate"]) {
      for (let seed = 1; seed <= 25; seed++) {
        const menu = catalogMenu({ profile, styles, elaboration, seed: seed * 104729 });
        if (!menu) continue;
        weeks++;
        for (const day of menu.days) for (const dish of [day.lunch.dishName, day.dinner.dishName]) counts.set(dish, (counts.get(dish) ?? 0) + 1);
      }
    }
  }
}
const ranked = [...counts.entries()].sort((a, b) => b[1] - a[1]);
const total = ranked.reduce((sum, [, n]) => sum + n, 0);
let covered = 0;
const lines = ranked.slice(0, 100).map(([dish, n], index) => {
  covered += n;
  const tags = catalogTags(dish);
  const notes = [tags?.vegGrams < 100 ? "poca verdura" : null, tags?.upf ? "ultraprocesado" : null, tags?.mercury ? "mercurio" : null].filter(Boolean).join(", ");
  return `| ${index + 1} | ${dish} | ${((100 * n) / total).toFixed(1)} % | ${notes} |`;
});
console.log(`# Revisión profesional de las fichas: orden de prioridad (N08)

Generado con \`node scripts/review-priority.cjs\` sobre ${weeks} semanas simuladas de Crear menú (cuatro perfiles, tres tipos y tres niveles). Las 100 primeras recetas cubren el ${((100 * covered) / total).toFixed(0)} % de los platos propuestos.

Checklist por ficha (criterios del análisis nutricional, sección N08):
- Cantidades por persona según la SENC: proteína animal 100-150 g, cereal crudo 60-80 g, legumbre cruda 50-80 g, verdura ≥150 g.
- Sal en «una pizca» o gramos, nunca solo «al gusto»; alternativas bajas en sal para salsas y conservas.
- Unidades normalizadas a g o ml (sin «ud» ambiguas).
- Alérgenos UE-14 confirmados contra los ingredientes.
- Pasos de seguridad alimentaria (huevo, pescado crudo, recalentado).
- Al terminar, se publica como versión revisada en \`recipe_cards\` (\`review_status = 'reviewed'\`): la ficha deja de mostrar «sin revisar» y la lista de la compra la usa.

| # | Receta | % de platos | Notas automáticas |
| ---: | --- | ---: | --- |
${lines.join("\n")}`);
