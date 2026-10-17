// Restriction check of one dish (C3, roadmap step 18): the profile's diets, allergies and free text
// against the dish card (ingredients and possible EU-14 allergens) or, without a card, its title.
// It only reports what it can see. «none_detected» never means the dish is safe or «apto»: a card
// may be estimated by AI, and no card ever guarantees the absence of allergens or traces.
import type { RecipeAllergen, RecipeCard } from "./card";
import {
  analyzeFoodText,
  groupNameAt,
  lexiconEntryFor,
  lexiconEntryGroups,
  mentionsPhrase,
  normalizeFood,
  type Certainty,
  type FoodAnalysis,
  type FoodGroup,
  type FoodNegation,
} from "./food-lexicon";

// The part of a profile this check reads (MenuProfile and FoodRestrictions both have it).
export type RestrictionProfile = {
  dietaryRestrictions: string[];
  allergies: string[];
  otherAllergies: string;
  dislikedFoods: string[];
};

export type RestrictionKind = "diet" | "allergy" | "other_allergy" | "disliked";

export type Restriction = { kind: RestrictionKind; value: string; label: string };

export type DishCheckStatus = "conflict" | "possible_conflict" | "unverifiable" | "none_detected";
export type DishCheckBasis = "reviewed_card" | "inferred_card" | "title_only";

export type DishFinding = {
  restriction: Restriction;
  certainty: Certainty;
  // The card ingredient that matched (source «ingredient»).
  ingredient?: string;
  // The words that matched, or the allergen label (source «allergen_tag»).
  term: string;
  source: "ingredient" | "allergen_tag" | "title";
};

export type DishCheck = {
  status: DishCheckStatus;
  basis: DishCheckBasis;
  findings: DishFinding[];
  // Free text that cannot be checked («algunas frutas», «trazas», a word under 3 letters…).
  uninterpretable: string[];
};

// Only what the check reads: a full card, or the compact copy of a catalogue recipe (catalogChecks.ts).
export type DishCardForCheck = Pick<RecipeCard, "possibleAllergens" | "reviewStatus"> & {
  ingredients: Pick<RecipeCard["ingredients"][number], "name" | "optional">[];
};

export const dietLabels: Record<string, string> = {
  vegetarian: "Vegetariano",
  vegan: "Vegano",
  pescatarian: "Pescetariano",
  no_pork: "Sin cerdo",
  no_alcohol: "Sin alcohol",
};

export const allergyLabels: Record<string, string> = {
  gluten: "Gluten",
  crustaceans: "Crustáceos",
  egg: "Huevo",
  fish: "Pescado",
  peanuts: "Cacahuete",
  soy: "Soja",
  milk: "Leche",
  lactose: "Lactosa",
  nuts: "Frutos secos",
  celery: "Apio",
  mustard: "Mostaza",
  sesame: "Sésamo",
  sulphites: "Sulfitos",
  lupin: "Altramuces",
  molluscs: "Moluscos",
  shellfish: "Marisco",
};

type GroupRule = { group: FoodGroup; certainty: Certainty; negatedBy: FoodNegation[] };

const rule = (group: FoodGroup, certainty: Certainty = "certain", negatedBy: FoodNegation[] = [group]): GroupRule => ({
  group,
  certainty,
  negatedBy,
});

const meatRules = [rule("meat"), rule("pork", "certain", ["pork", "meat"]), rule("gelatin")];
const seaRules = [rule("fish"), rule("crustaceans"), rule("molluscs")];

const dietRules: Record<string, GroupRule[]> = {
  vegetarian: [...meatRules, ...seaRules],
  pescatarian: meatRules,
  vegan: [...meatRules, ...seaRules, rule("egg"), rule("dairy"), rule("honey")],
  no_pork: [rule("pork"), rule("gelatin", "possible")],
  no_alcohol: [rule("alcohol")],
};

const allergyRules: Record<string, GroupRule[]> = {
  gluten: [rule("gluten")],
  crustaceans: [rule("crustaceans")],
  egg: [rule("egg")],
  fish: [rule("fish")],
  peanuts: [rule("peanuts")],
  soy: [rule("soy")],
  // An allergy to milk protein: «sin lactosa» does not cancel it (N02).
  milk: [rule("dairy")],
  // The intolerance: a lactose-free product is fine.
  lactose: [rule("dairy", "certain", ["dairy", "lactose"])],
  // Peanuts are a legume, but many people with a nut allergy avoid them: possible, never silent.
  nuts: [rule("nuts"), rule("peanuts", "possible")],
  celery: [rule("celery")],
  mustard: [rule("mustard")],
  sesame: [rule("sesame")],
  sulphites: [rule("sulphites")],
  lupin: [rule("lupin")],
  molluscs: [rule("molluscs")],
  shellfish: [rule("crustaceans"), rule("molluscs")],
};

// A group name in free text («marisco», «frutos secos», «sésamo») as rules.
function rulesForGroups(groups: FoodNegation[]): GroupRule[] {
  return groups.flatMap((group): GroupRule[] => {
    if (group === "lactose") return allergyRules.lactose;
    if (group === "meat") return [rule("meat"), rule("pork", "certain", ["pork", "meat"])];
    if (group === "nuts") return allergyRules.nuts;
    return [rule(group)];
  });
}

// EU-14 tags of a card that mean a group is (possibly) present.
const groupTags: Partial<Record<FoodGroup, RecipeAllergen[]>> = {
  gluten: ["gluten"],
  dairy: ["milk"],
  egg: ["eggs"],
  nuts: ["nuts"],
  peanuts: ["peanuts"],
  fish: ["fish"],
  crustaceans: ["crustaceans"],
  molluscs: ["molluscs"],
  sesame: ["sesame"],
  mustard: ["mustard"],
  celery: ["celery"],
  soy: ["soy"],
  sulphites: ["sulphites"],
  lupin: ["lupin"],
};

export const allergenTagLabels: Record<RecipeAllergen, string> = {
  gluten: "gluten",
  crustaceans: "crustáceos",
  eggs: "huevo",
  fish: "pescado",
  peanuts: "cacahuete",
  soy: "soja",
  milk: "leche",
  nuts: "frutos de cáscara",
  celery: "apio",
  mustard: "mostaza",
  sesame: "sésamo",
  sulphites: "sulfitos",
  lupin: "altramuces",
  molluscs: "moluscos",
};

type CompiledRestriction =
  | { restriction: Restriction; type: "groups"; rules: GroupRule[] }
  // A word of the lexicon («almendras»): only that entry, plus the allergen tags of its groups as possible.
  | { restriction: Restriction; type: "entry"; entry: string; tags: RecipeAllergen[] }
  // Anything else: the words themselves, singular or plural.
  | { restriction: Restriction; type: "literal"; phrase: string };

const vagueWords = /\b(algun|alguna|algunas|algunos|cierto|cierta|ciertos|ciertas|vario|varia|varios|varias|traza|trazas|otro|otra|otros|otras|etc|cosa|cosas|depende|veces|poco|mucho|tipo|tipos)\b/;
// Broad categories the lexicon has no group for: a literal match would miss most of them.
const broadWords = /^(fruta|frutas|verdura|verduras|hortaliza|hortalizas|especia|especias|legumbre|legumbres|cereal|cereales|semilla|semillas|condimento|condimentos|aditivo|aditivos|conservante|conservantes|colorante|colorantes|picante|picantes|salsa|salsas|grasa|grasas|frito|fritos|fritura|frituras|comida|comidas|alimento|alimentos|carbohidrato|carbohidratos|azucar|azucares)$/;
const fillerPrefix = /^(soy |tengo |me da |me dan )?(alergi[ac]o?s?|alergica|alergicas|intolerancia|intolerante|intolerantes|no me gusta|no me gustan|no tomo|no como|nada de|odio|evito|evitar)( (a|al|a la|a los|a las|de|del|de la|de los|de las|con))?\b ?/;
const articlePrefix = /^(el|la|los|las|un|una|unos|unas|a|al|de|del) /;

// «ninguna», «nada», «n/a», «-»: the same as an empty field.
const emptyAnswers = new Set(["", "ninguna", "ninguno", "ningunas", "ningunos", "nada", "no", "n a", "na", "ninguna alergia", "sin alergias", "no tengo"]);

export function freeTextItems(text: string): string[] {
  if (emptyAnswers.has(normalizeFood(text))) return [];
  return text
    .split(/[,;\n()·•]+|(?<!\bn)\/|\s+y\s+|\s+e\s+|\s+o\s+|\s+ni\s+|\./i)
    .map((item) => item.trim())
    .filter((item) => !emptyAnswers.has(normalizeFood(item)));
}

// The item as the person wrote it, without «alergia a…», «no me gusta…» or an article, for labels
// («Alergia: fresas», not «Alergia: alergia a las fresas»).
export function freeTextLabel(item: string): string {
  const cleaned = item
    .trim()
    .replace(/^(soy |tengo |me da |me dan )?(al[eé]rgi\S*|intoleran\S*|no me gustan?|no tomo|no como|nada de|odio|evito|evitar)\s+((a|al|a la|a los|a las|de|del|de la|de los|de las|con)\s+)?/i, "")
    .replace(/^(el|la|los|las|un|una|unos|unas)\s+/i, "")
    .trim();
  return cleaned || item.trim();
}

type FreeTextResolution = { type: "groups"; groups: FoodNegation[]; term: string } | { type: "entry"; entry: string } | { type: "literal"; phrase: string } | { type: "uninterpretable" };

// What one free-text item means: a whole group, a word of the lexicon, a literal word, or nothing
// that can be checked.
export function resolveFreeText(item: string): FreeTextResolution {
  let text = normalizeFood(item);
  for (let pass = 0; pass < 3; pass += 1) text = text.replace(fillerPrefix, "").replace(articlePrefix, "").trim();
  const letters = text.replace(/[^a-z]/g, "");
  if (letters.length < 3 || vagueWords.test(text) || broadWords.test(text)) return { type: "uninterpretable" };
  const tokens = text.split(" ");
  // A group named anywhere in the item («pescado azul», «proteína de leche»): the whole group,
  // which is the conservative reading for an allergy.
  for (let start = 0; start < tokens.length; start += 1) {
    const named = groupNameAt(tokens, start);
    if (named) return { type: "groups", groups: named.groups, term: tokens.slice(start, start + named.length).join(" ") };
  }
  if (tokens.length > 4) return { type: "uninterpretable" };
  const entry = lexiconEntryFor(text);
  if (entry) return { type: "entry", entry };
  return { type: "literal", phrase: text };
}

export function compileRestrictions(profile: RestrictionProfile): { compiled: CompiledRestriction[]; uninterpretable: string[] } {
  const compiled: CompiledRestriction[] = [];
  const uninterpretable: string[] = [];

  for (const value of profile.dietaryRestrictions) {
    if (value === "none") continue;
    const rules = dietRules[value];
    if (rules) compiled.push({ restriction: { kind: "diet", value, label: dietLabels[value] }, type: "groups", rules });
    else uninterpretable.push(value);
  }

  const freeText = (text: string, kind: "other_allergy" | "disliked") => {
    for (const item of freeTextItems(text)) {
      const resolution = resolveFreeText(item);
      const restriction: Restriction = { kind, value: item, label: freeTextLabel(item) };
      if (resolution.type === "uninterpretable") uninterpretable.push(item);
      else if (resolution.type === "groups") compiled.push({ restriction, type: "groups", rules: rulesForGroups(resolution.groups) });
      else if (resolution.type === "entry") {
        const tags = kind === "other_allergy" ? lexiconEntryGroups(resolution.entry).flatMap((mark) => groupTags[mark.group] ?? []) : [];
        compiled.push({ restriction, type: "entry", entry: resolution.entry, tags });
      } else compiled.push({ restriction, type: "literal", phrase: resolution.phrase });
    }
  };

  for (const value of profile.allergies) {
    if (value === "none") continue;
    if (value === "other") {
      if (!freeTextItems(profile.otherAllergies).length) uninterpretable.push("Otra alergia sin especificar");
      continue;
    }
    const rules = allergyRules[value];
    if (rules) compiled.push({ restriction: { kind: "allergy", value, label: allergyLabels[value] }, type: "groups", rules });
    else freeText(value, "other_allergy");
  }
  freeText(profile.otherAllergies, "other_allergy");
  for (const disliked of profile.dislikedFoods) freeText(disliked, "disliked");

  return { compiled, uninterpretable: [...new Set(uninterpretable)] };
}

export function hasFoodRestrictions(profile: RestrictionProfile) {
  const { compiled, uninterpretable } = compileRestrictions(profile);
  return compiled.length > 0 || uninterpretable.length > 0;
}

function textFindings(
  item: CompiledRestriction,
  text: string,
  analysis: FoodAnalysis,
  source: "ingredient" | "title",
  optional: boolean,
  automatic: boolean,
): DishFinding[] {
  const base = { restriction: item.restriction, source, ...(source === "ingredient" ? { ingredient: text } : {}) };
  const cap = (certainty: Certainty): Certainty => (optional ? "possible" : certainty);
  if (item.type === "literal") {
    const term = mentionsPhrase(text, item.phrase);
    return term ? [{ ...base, certainty: cap("certain"), term }] : [];
  }
  if (item.type === "entry") {
    const hit = analysis.hits.find((candidate) => candidate.entry === item.entry);
    return hit ? [{ ...base, certainty: cap("certain"), term: analysis.tokens.slice(hit.start, hit.end).join(" ") }] : [];
  }
  const findings: DishFinding[] = [];
  for (const groupRule of item.rules) {
    for (const mention of analysis.mentions) {
      if (mention.group !== groupRule.group) continue;
      // «pan sin gluten»: not a finding when shown to the person; for an automatic proposal only
      // possible (a title is not a certification).
      const negated = groupRule.negatedBy.some((negation) => mention.negated.includes(negation));
      if (negated && !automatic) continue;
      const certainty = negated || mention.certainty === "possible" || groupRule.certainty === "possible" ? "possible" : "certain";
      findings.push({ ...base, certainty: cap(certainty), term: mention.term });
    }
  }
  return findings;
}

function tagFindings(item: CompiledRestriction, tags: RecipeAllergen[]): DishFinding[] {
  const findings: DishFinding[] = [];
  const add = (tag: RecipeAllergen, certainty: Certainty) => {
    if (tags.includes(tag)) findings.push({ restriction: item.restriction, certainty, term: allergenTagLabels[tag], source: "allergen_tag" });
  };
  if (item.type === "groups") {
    for (const groupRule of item.rules) for (const tag of groupTags[groupRule.group] ?? []) add(tag, groupRule.certainty);
  } else if (item.type === "entry") {
    // «almendras» and a card that lists nuts: maybe, maybe not those.
    for (const tag of item.tags) add(tag, "possible");
  }
  return findings;
}

function uniqueFindings(findings: DishFinding[]) {
  const seen = new Set<string>();
  return findings.filter((finding) => {
    const key = JSON.stringify([finding.restriction.kind, finding.restriction.value, finding.source, finding.ingredient ?? "", finding.term, finding.certainty]);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

// automatic: the check of a generated or proposed dish (menu, ideas), stricter with «sin …».
export function checkDish(
  dish: { title: string; card: DishCardForCheck | null },
  profile: RestrictionProfile,
  options: { automatic?: boolean } = {},
): DishCheck {
  const automatic = options.automatic === true;
  const { compiled, uninterpretable } = compileRestrictions(profile);
  const basis: DishCheckBasis = dish.card ? (dish.card.reviewStatus === "reviewed" ? "reviewed_card" : "inferred_card") : "title_only";
  const titleAnalysis = analyzeFoodText(dish.title);
  const ingredients = (dish.card?.ingredients ?? []).map((ingredient) => ({ ingredient, analysis: analyzeFoodText(ingredient.name) }));

  const findings = uniqueFindings(
    compiled.flatMap((item) => [
      ...textFindings(item, dish.title, titleAnalysis, "title", false, automatic),
      ...ingredients.flatMap(({ ingredient, analysis }) =>
        textFindings(item, ingredient.name, analysis, "ingredient", ingredient.optional, automatic),
      ),
      // A listed allergen counts whatever the ingredient names say.
      ...(dish.card ? tagFindings(item, dish.card.possibleAllergens) : []),
    ]),
  );

  const status: DishCheckStatus = findings.some((finding) => finding.certainty === "certain")
    ? "conflict"
    : findings.length
      ? "possible_conflict"
      : basis === "title_only" && compiled.length > 0
        ? "unverifiable"
        : uninterpretable.length
          ? "unverifiable"
          : "none_detected";

  return { status, basis, findings, uninterpretable };
}

// Automatic proposals (generated menu, catalogue and AI ideas) are never offered with a detected
// conflict: a certain finding of a diet or allergy, or a possible one of an allergy (with an allergy
// the dish should be naturally compatible). Disliked foods are handled apart by each caller.
export function blocksAutomaticProposal(check: DishCheck): boolean {
  return check.findings.some(
    (finding) =>
      finding.restriction.kind !== "disliked" &&
      (finding.certainty === "certain" || finding.restriction.kind === "allergy" || finding.restriction.kind === "other_allergy"),
  );
}

export function mentionsDislikedFood(check: DishCheck): boolean {
  return check.findings.some((finding) => finding.restriction.kind === "disliked" && finding.certainty === "certain");
}
