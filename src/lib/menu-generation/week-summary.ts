import { catalogCardForCheck } from "@/lib/recipes/catalogChecks";
import { catalogTags } from "@/lib/recipes/catalogTags";
import { dishGroups } from "./food-groups";
import { countGroups, weekQuotas, type QuotaProfile } from "./quotas";

// What a week has, said in positive (N10): legumes, fish, vegetables… and, when something is
// missing, a suggestion without judgement. No calories, no «bien/mal». Each line has a short «¿Por
// qué?» with its source. Created and imported weeks alike; dishes outside the catalogue are read by
// their title only.

export type WeekSummary = {
  highlights: string[];
  suggestions: string[];
  reasons: { topic: string; text: string; source: string }[];
};

const plural = (count: number, one: string, many: string) => `${count} ${count === 1 ? one : many}`;

export function weekSummary(dishes: string[], profile: QuotaProfile): WeekSummary | null {
  const planned = dishes.filter((dish) => dish.trim() && dish !== "LIBRE");
  if (planned.length < 4) return null;
  const quotas = weekQuotas(profile);
  const counts = countGroups(planned.map((dish) => dishGroups(dish, catalogCardForCheck(dish)?.ingredients ?? null)));
  const tags = planned.map((dish) => catalogTags(dish));
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
