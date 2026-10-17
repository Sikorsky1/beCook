// What the dish card of one meal shows and does (C2). Used by DishCard; kept apart for tests.
import type { MealKey, WeekDay } from "@/data/mockWeek";
import { isAiLoginRequiredError, postAi } from "@/lib/ai-client";
import {
  loadCatalogRecipeIndex,
  loadRecipeCard,
  loadWeek,
  readCachedWeekVersion,
  saveWeekRecipe,
  type DataIdentity,
} from "@/lib/data/repositories";
import type { IsoWeek } from "@/lib/isoWeek";
import { getIsoWeekStorageId } from "@/lib/isoWeek";
import { parseLeftover } from "@/lib/menu-generation/leftovers";
import { loadCatalogRecipe } from "@/lib/recipes/catalogRecipeCards";
import {
  findCatalogRecipeIdentity,
  parseRecipeCard,
  recipeTitleKey,
  sameDishTitle,
  type CatalogRecipeIdentity,
  type RecipeCard,
  type RecipeCardContent,
} from "@/lib/recipes/card";
import {
  checkDish,
  hasFoodRestrictions,
  type DishCheck,
  type DishFinding,
  type RestrictionProfile,
} from "@/lib/recipes/restriction-check";
import { readMenuProfile } from "@/lib/menu-generation/profile-input";
import type { WeekFoodContextStatus } from "@/lib/menu-generation/food-context";
import { mealRecipeLink, withMealRecipe } from "@/lib/weekStorage";

// card: the slot points to a card that could be read · title_only: no card for this meal (menus
// before C2, or a title edited later). catalog: the title is exactly a catalogue recipe; with a
// reviewed version it can be used without AI, otherwise the catalogue card is pending review.
export type DishCardView =
  | { kind: "card"; card: RecipeCard }
  // The catalogue recipe of exactly this title (src/data/recipe-cards/catalog-recipes.json).
  // base: the catalogue title when the dish only starts with it (a side added), else null.
  | { kind: "catalog_recipe"; recipe: RecipeCardContent; base: string | null }
  | {
      kind: "title_only";
      catalog: (CatalogRecipeIdentity & { reviewedVersionId: string | null }) | null;
      // The link existed but the card could not be read (deleted, not readable): said, not hidden.
      unreadableLink: boolean;
    }
  | { kind: "error"; message: string };

export const dishCardMessages = {
  unreachable: "No hemos podido abrir la ficha. Revisa la conexión e inténtalo de nuevo.",
  weekChanged: "Tu semana ha cambiado en otro dispositivo. Hemos cargado la versión de tu cuenta.",
  cardNotLinked: "La ficha se ha guardado, pero tu semana cambió mientras tanto y no se ha enlazado. Vuelve a abrir la ficha.",
  pending: "Solo en este dispositivo: tu cuenta no ha confirmado el cambio. Se reintentará al recargar la semana.",
  invalid: "La ficha propuesta no ha superado las comprobaciones. Puedes intentarlo otra vez.",
  quota: "Has llegado al límite de fichas estimadas por hoy (cuentan junto a las listas de la compra). Inténtalo mañana.",
  failed: "No se ha podido preparar la ficha. Inténtalo de nuevo.",
  versionUnknown: "Aún no sabemos la versión de tu semana. Espera a que termine de cargar e inténtalo de nuevo.",
} as const;

export async function loadDishCardView(day: WeekDay, meal: MealKey): Promise<DishCardView> {
  const title = day[meal];
  const link = mealRecipeLink(day, meal);
  let unreadableLink = false;
  if (link) {
    try {
      const card = await loadRecipeCard(link.versionId);
      // A card is only shown for its own dish (a stale device copy never shows another one).
      if (card && sameDishTitle(card.title, title)) return { kind: "card", card };
      unreadableLink = card === null;
    } catch {
      return { kind: "error", message: dishCardMessages.unreachable };
    }
  }
  // A leftover («… (sobras del lunes)», N17) shows the recipe of its dish.
  const leftover = parseLeftover(title);
  const recipeTitle = leftover?.base ?? title;
  const identity = findCatalogRecipeIdentity(recipeTitle);
  const reviewed = identity ? (await loadCatalogRecipeIndex()).get(recipeTitleKey(recipeTitle)) ?? null : null;
  // A reviewed catalogue card (database) wins; otherwise the catalogue recipe of the repository.
  if (!reviewed) {
    const match = await loadCatalogRecipe(recipeTitle);
    if (match) return { kind: "catalog_recipe", recipe: match.recipe, base: leftover ? (match.base ?? leftover.base) : match.base };
  }
  return {
    kind: "title_only",
    catalog: identity ? { ...identity, reviewedVersionId: reviewed?.versionId ?? null } : null,
    unreadableLink,
  };
}

export type DishCardAction =
  | { status: "linked"; days: WeekDay[] | null; card?: RecipeCard; message?: string }
  | { status: "conflict"; days: WeekDay[] | null; message: string }
  | { status: "pending"; days: WeekDay[]; message: string }
  | { status: "login_required" }
  | { status: "error"; message: string; retryable: boolean };

// «Usar receta del catálogo»: links the reviewed catalogue version, no AI.
export async function linkCatalogCard(
  identity: DataIdentity,
  isoWeek: IsoWeek,
  weekDays: WeekDay[],
  slot: { day: string; meal: MealKey },
  versionId: string,
): Promise<DishCardAction> {
  const result = await saveWeekRecipe(identity, isoWeek, weekDays, slot, { versionId });
  if (result.status === "conflict") return { status: "conflict", days: result.remoteData, message: dishCardMessages.weekChanged };
  if (result.status === "pending") return { status: "pending", days: weekDays, message: dishCardMessages.pending };
  return { status: "linked", days: withMealRecipe(weekDays, slot.day, slot.meal, { versionId }) };
}

// «Crear ficha estimada (IA)»: one dish, signed in only. The server estimates, saves and links;
// the week is then read again so this device has the link and the new version.
export async function requestEstimatedCard(
  identity: DataIdentity,
  isoWeek: IsoWeek,
  slot: { day: string; meal: MealKey },
  dish: string,
  requestKey: string,
  signal?: AbortSignal,
): Promise<DishCardAction> {
  if (!identity.userId) return { status: "login_required" };
  const expectedVersion = readCachedWeekVersion(identity, isoWeek);
  if (expectedVersion === null) return { status: "error", message: dishCardMessages.versionUnknown, retryable: true };

  let response: Response;
  try {
    response = await postAi(
      "/api/dish-card",
      { isoWeek: getIsoWeekStorageId(isoWeek), day: slot.day, meal: slot.meal, dish, expectedVersion, requestKey },
      signal,
    );
  } catch (error) {
    if (isAiLoginRequiredError(error)) return { status: "login_required" };
    return { status: "error", message: dishCardMessages.failed, retryable: true };
  }

  const data = (await response.json().catch(() => null)) as
    | { card?: unknown; link?: unknown; error?: unknown; reason?: unknown }
    | null;
  const reload = async () => (await loadWeek(identity, isoWeek)).data;

  if (response.status === 409) {
    return { status: "conflict", days: await reload(), message: dishCardMessages.weekChanged };
  }
  if (response.status === 422) return { status: "error", message: dishCardMessages.invalid, retryable: true };
  if (response.status === 429) return { status: "error", message: dishCardMessages.quota, retryable: false };
  if (!response.ok) {
    const message = typeof data?.error === "string" && response.status < 500 ? data.error : dishCardMessages.failed;
    return { status: "error", message, retryable: true };
  }

  const card = parseRecipeCard(data?.card);
  if (!card) return { status: "error", message: dishCardMessages.failed, retryable: true };
  const days = await reload();
  if (data?.link === "conflict") return { status: "linked", days, card, message: dishCardMessages.cardNotLinked };
  return { status: "linked", days, card };
}

// The card the dialog shows: one just estimated or linked (before the week is read again) only
// for exactly the same meal and dish, and only if the slot points to that version or to none yet;
// otherwise the card read for the slot. Never the card of another dish («Pollo» ≠ «Pollo al limón»).
export function cardToShow(
  shown: { key: string; card: RecipeCard } | null,
  slotKey: string,
  title: string,
  linkVersionId: string | null,
  viewCard: RecipeCard | null,
): RecipeCard | null {
  if (
    shown &&
    shown.key === slotKey &&
    sameDishTitle(shown.card.title, title) &&
    (linkVersionId === null || linkVersionId === shown.card.versionId)
  ) {
    return shown.card;
  }
  return viewCard;
}

export const dishCardSlotKey = (slot: { day: string; meal: MealKey }, title: string) => JSON.stringify([slot.day, slot.meal, title]);

// --- Compatibility with the profile (C3) -------------------------------------------------------
// The restrictions the card is checked against: the account's current profile (C1, status.current)
// when signed in; the device profile for a guest. loading: not read yet · unknown: could not be read.
export type DishCardRestrictions =
  | { state: "ready"; profile: RestrictionProfile }
  | { state: "no_profile" }
  | { state: "loading" }
  | { state: "unknown" };

// foodContext: undefined while it is being read, null when it could not be read.
export function dishCardRestrictions(
  signedIn: boolean,
  foodContext: WeekFoodContextStatus | null | undefined,
  deviceProfile: { loaded: boolean; data: unknown },
): DishCardRestrictions {
  if (signedIn) {
    if (foodContext === undefined) return { state: "loading" };
    if (foodContext === null) return { state: "unknown" };
    return foodContext.current.found ? { state: "ready", profile: foodContext.current.restrictions } : { state: "no_profile" };
  }
  if (!deviceProfile.loaded) return { state: "loading" };
  if (deviceProfile.data === null || deviceProfile.data === undefined) return { state: "no_profile" };
  try {
    return { state: "ready", profile: readMenuProfile(deviceProfile.data) };
  } catch {
    // Malformed safety constraints are never read as «none».
    return { state: "unknown" };
  }
}

export type DishCompatibilityView = {
  tone: "danger" | "warning" | "neutral";
  heading: string;
  basis: string | null;
  lines: string[];
  notes: string[];
};

export const dishCompatibilityDisclaimer = "No garantiza ausencia de alérgenos ni trazas.";

const basisTexts: Record<DishCheck["basis"], string> = {
  reviewed_card: "Según la ficha revisada.",
  inferred_card: "Según una ficha estimada por IA, sin revisar.",
  title_only: "Solo por el nombre del plato.",
};

function findingTerm(finding: DishFinding) {
  if (finding.source === "ingredient") return finding.ingredient ?? finding.term;
  if (finding.source === "allergen_tag") return `${finding.term} (alérgeno indicado en la ficha)`;
  return `«${finding.term}» en el nombre`;
}

function restrictionPrefix(finding: DishFinding) {
  const { kind, label } = finding.restriction;
  if (kind === "diet") return label;
  if (kind === "disliked") return `No te gusta «${label}»`;
  if (kind === "other_allergy") return `Alergia: ${label}`;
  return `Alergia: ${label.toLowerCase()}`;
}

// One line per restriction: what was found, and what only might be there.
function findingLines(findings: DishFinding[]) {
  const groups = new Map<string, { prefix: string; certain: string[]; possible: string[] }>();
  for (const finding of findings) {
    const key = `${finding.restriction.kind}:${finding.restriction.value}`;
    const entry = groups.get(key) ?? { prefix: restrictionPrefix(finding), certain: [], possible: [] };
    const list = finding.certainty === "certain" ? entry.certain : entry.possible;
    const term = findingTerm(finding);
    if (!list.includes(term)) list.push(term);
    groups.set(key, entry);
  }
  return [...groups.values()].map(({ prefix, certain, possible }) => {
    const parts = [certain.join(", "), possible.length ? `quizá ${possible.join(", ")}` : ""].filter(Boolean);
    return `${prefix}: ${parts.join("; ")}.`;
  });
}

// What the card says about the profile. Never «apto»: at most, no conflict detected.
export function dishCompatibilityView(
  title: string,
  card: RecipeCard | null,
  restrictions: DishCardRestrictions,
): DishCompatibilityView {
  if (restrictions.state === "loading") {
    return { tone: "neutral", heading: "Cargando tus restricciones…", basis: null, lines: [], notes: [] };
  }
  if (restrictions.state === "no_profile") {
    return {
      tone: "neutral",
      heading: "No tenemos tu perfil de restricciones",
      basis: null,
      lines: [],
      notes: ["Sin él no comprobamos este plato. Si en casa hay alergias o dietas, añádelas en tu perfil."],
    };
  }
  if (restrictions.state === "unknown") {
    return {
      tone: "neutral",
      heading: "No hemos podido leer tus restricciones",
      basis: null,
      lines: [],
      notes: ["Sin ellas no comprobamos este plato. Revisa tu perfil o vuelve a abrir la ficha."],
    };
  }
  if (!hasFoodRestrictions(restrictions.profile)) {
    return {
      tone: "neutral",
      heading: "Tu perfil no tiene restricciones ni alergias",
      basis: null,
      lines: [],
      notes: ["Si en casa hay alguna, añádela en tu perfil para que la tengamos en cuenta."],
    };
  }

  const check = checkDish({ title, card }, restrictions.profile);
  const notes: string[] = [];
  if (check.uninterpretable.length) {
    notes.push(`No sabemos comprobar: ${check.uninterpretable.map((item) => `«${item}»`).join(", ")}. Revísalo tú.`);
  }
  const lines = findingLines(check.findings);
  const basis = basisTexts[check.basis];

  if (check.status === "conflict") {
    const onlyDisliked = check.findings.every((finding) => finding.certainty === "possible" || finding.restriction.kind === "disliked");
    return {
      tone: onlyDisliked ? "warning" : "danger",
      heading: onlyDisliked ? "Lleva algo que no te gusta" : "Choca con tu perfil",
      basis,
      lines,
      notes,
    };
  }
  if (check.status === "possible_conflict") {
    return { tone: "warning", heading: "Puede chocar con tu perfil", basis, lines, notes };
  }
  if (check.status === "unverifiable") {
    if (check.basis === "title_only") notes.unshift("Solo conocemos el nombre del plato, no sus ingredientes.");
    return { tone: "warning", heading: check.basis === "title_only" ? "No podemos comprobarlo" : "No podemos comprobarlo del todo", basis, lines, notes };
  }
  return { tone: "neutral", heading: "No hemos detectado conflictos con tu perfil", basis, lines, notes };
}

// What the dialog says about the profile: only the restrictions the dish certainly breaks, by its
// title or its recipe, one short label each («Alergia: Gluten», «Vegano», «No te gusta: coliflor»).
// Nothing when there is no certain conflict or the profile is not ready.
export function dishConflictLabels(
  title: string,
  recipe: Pick<RecipeCardContent, "ingredients" | "possibleAllergens"> | null,
  restrictions: DishCardRestrictions,
): string[] {
  if (restrictions.state !== "ready" || !hasFoodRestrictions(restrictions.profile)) return [];
  const card = recipe ? { ingredients: recipe.ingredients, possibleAllergens: recipe.possibleAllergens, reviewStatus: "inferred" as const } : null;
  const labels: string[] = [];
  for (const finding of checkDish({ title, card }, restrictions.profile).findings) {
    if (finding.certainty !== "certain") continue;
    const { kind, label } = finding.restriction;
    const text =
      kind === "allergy" && finding.restriction.value === "lactose"
        ? "Intolerancia a la lactosa"
        : kind === "allergy" || kind === "other_allergy"
        ? `Alergia: ${label.charAt(0).toUpperCase()}${label.slice(1)}`
        : kind === "disliked"
          ? `No te gusta: ${label}`
          : label;
    if (!labels.includes(text)) labels.push(text);
  }
  return labels;
}
