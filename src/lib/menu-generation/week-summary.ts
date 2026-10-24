import { catalogCardForCheck } from "@/lib/recipes/catalogChecks";
import type { TagsLookup } from "@/lib/recipes/loadCatalogTags";
import { dishGroups } from "./food-groups";
import { parseLeftover } from "./leftovers";
import { countGroups, weekQuotas, type QuotaProfile } from "./quotas";

// What a week has, said in positive (N10): legumes, fish, vegetables… and, when something is
// missing, a suggestion without judgement. No calories, no «bien/mal». Each line has a short «¿Por
// qué?» with its source. Created and imported weeks alike; dishes outside the catalogue are read by
// their title only. Since 2026-10-24 the weeks keep the weekly rules of lunches and dinners
// (menu-rules.ts), which ask for fewer legumes and more meat and fish than AESAN: the summary
// suggests by AESAN only for the vegetarian and vegan profiles, which keep its frequencies.

export type WeekSummary = {
  highlights: string[];
  suggestions: string[];
  reasons: { topic: string; text: string; source: string }[];
};

const ruleReasons = [
  { topic: "Comidas", text: "Un día legumbre, uno arroz, uno pasta y uno patata, con carne o pescado; carne roja un día, carne blanca dos, pescado azul dos y pescado blanco dos; siempre con verdura.", source: "Reglas del plan nutricional" },
  { topic: "Cenas", text: "Pescado blanco dos días, huevo dos y carne blanca dos.", source: "Reglas del plan nutricional" },
  { topic: "Hidratos", text: "Legumbre, arroz, pasta y patata en los días de entreno.", source: "Reglas del plan nutricional" },
  { topic: "Verdura y fruta", text: "Al menos 5 raciones al día entre las dos, de temporada cuando se pueda.", source: "AESAN 2022 · OMS" },
];

const plural = (count: number, one: string, many: string) => `${count} ${count === 1 ? one : many}`;

// tagsOf: the catalogue tags (loadCatalogTags on the browser, catalogTags on the server). A leftover
// («… (sobras del lunes)») counts as its dish.
export function weekSummary(dishes: string[], profile: QuotaProfile, tagsOf: TagsLookup): WeekSummary | null {
  const planned = dishes.filter((dish) => dish.trim() && dish !== "LIBRE").map((dish) => parseLeftover(dish)?.base ?? dish);
  if (planned.length < 4) return null;
  const quotas = weekQuotas(profile);
  const counts = countGroups(planned.map((dish) => dishGroups(dish, catalogCardForCheck(dish)?.ingredients ?? null)));
  const tags = planned.map((dish) => tagsOf(dish));
  const known = tags.filter((tag) => tag !== null);
  const highlights: string[] = [];
  const suggestions: string[] = [];

  if (counts.legume) highlights.push(plural(counts.legume, "legumbre", "legumbres"));
  if (counts.fish) highlights.push(`${plural(counts.fish, "pescado", "pescados")}${counts.blueFish ? ` (${plural(counts.blueFish, "azul", "azules")})` : ""}`);
  if (counts.egg) highlights.push(plural(counts.egg, "plato con huevo", "platos con huevo"));
  if (known.length === planned.length) {
    const withVeg = known.filter((tag) => tag.vegGrams >= 80).length;
    highlights.push(withVeg === planned.length ? "verdura en todas las comidas" : `verdura en ${withVeg} de ${planned.length} comidas`);
    const wholegrain = known.filter((tag) => tag.starch === "wholegrain").length;
    if (wholegrain) highlights.push(plural(wholegrain, "plato integral", "platos integrales"));
  }

  const diets = new Set(profile.dietaryRestrictions);
  if (!diets.has("vegetarian") && !diets.has("vegan")) {
    if (counts.processedMeat > quotas.processedMeatMax) suggestions.push("Puedes cambiar algún plato de carne procesada por carne blanca, huevo o pescado.");
    return { highlights, suggestions, reasons: ruleReasons };
  }

  const scale = planned.length / 14;
  const legumeTarget = Math.round(quotas.legumeMin * scale);
  if (counts.legume < legumeTarget) suggestions.push("¿Añadimos una legumbre más? Pulsa «Otra idea» en un plato y elige unas lentejas o unos garbanzos.");
  if (quotas.fishMin && counts.fish < Math.round(quotas.fishMin * scale)) suggestions.push("Un pescado más, mejor si es azul (sardina, caballa, salmón), completaría la semana.");
  if (counts.meat > Math.round(quotas.meatMax * scale) || counts.processedMeat > quotas.processedMeatMax) {
    suggestions.push("Puedes cambiar algún plato de carne por legumbre, huevo o pescado.");
  }

  const reasons = [
    { topic: "Legumbre", text: "Al menos 4 raciones a la semana: aportan proteína, fibra y hierro, y son baratas.", source: "AESAN 2022" },
    { topic: "Pescado", text: "3 o más raciones a la semana, priorizando el azul por sus grasas omega-3.", source: "AESAN 2022" },
    { topic: "Carne", text: "Hasta 3 a la semana, mejor aves y conejo, y la carne procesada lo menos posible.", source: "AESAN 2022" },
    { topic: "Verdura y fruta", text: "Al menos 5 raciones al día entre las dos, de temporada cuando se pueda.", source: "AESAN 2022 · OMS" },
  ];
  return { highlights, suggestions, reasons };
}
