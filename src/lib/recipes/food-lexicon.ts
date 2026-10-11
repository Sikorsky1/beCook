// Food lexicon (C3, roadmap step 18): which food groups a dish title or an ingredient name
// mentions, in Spanish. Matching is by whole words after normalizeFood («pan» never matches
// «panceta»), with simple plurals («nueces» → «nuez», «gambas» → «gamba») and longer phrases
// first, so «nuez moscada», «leche de coco» or «mantequilla de cacahuete» never count as nuts or
// dairy. «sin gluten», «sin lactosa», «sin huevo»… cancel that group for the same text.
//
// A mention is only what the words say. No mention never means the food is absent: a title is not
// an ingredient list, and a card may be estimated by AI. Kept apart from the shopping normaliser on
// purpose (C4 normalizeIngredientName).

export function normalizeFood(value: string) {
  return value.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

export const foodGroups = [
  "meat",
  "pork",
  "fish",
  "crustaceans",
  "molluscs",
  "egg",
  "dairy",
  "gluten",
  "nuts",
  "peanuts",
  "alcohol",
  "honey",
  "gelatin",
  "sesame",
  "mustard",
  "celery",
  "soy",
  "sulphites",
  "lupin",
] as const;

export type FoodGroup = (typeof foodGroups)[number];
export type Certainty = "certain" | "possible";
// What «sin …» cancels. «lactose» only cancels dairy for a lactose intolerance (a cheese without
// lactose is still dairy for a vegan).
export type FoodNegation = FoodGroup | "lactose";

export const foodGroupLabels: Record<FoodGroup, string> = {
  meat: "carne",
  pork: "cerdo",
  fish: "pescado",
  crustaceans: "crustáceos",
  molluscs: "moluscos",
  egg: "huevo",
  dairy: "lácteos",
  gluten: "gluten",
  nuts: "frutos secos",
  peanuts: "cacahuete",
  alcohol: "alcohol",
  honey: "miel",
  gelatin: "gelatina",
  sesame: "sésamo",
  mustard: "mostaza",
  celery: "apio",
  soy: "soja",
  sulphites: "sulfitos",
  lupin: "altramuces",
};

type Mark = { group: FoodGroup; certainty: Certainty };
type Entry = { key: string; tokens: string[]; marks: Mark[] };

// «group» is certain, «group?» possible. An entry without marks is an exception: it only consumes
// its words («nuez moscada», «vinagre de vino»).
const definitions: [string, string][] = [
  // Pork (vegetarian rules also include it). Phrases with another meat or a fish win over «lomo».
  ["cerdo porcino cochinillo jamon lacon panceta pancetta bacon beicon tocino torrezno chorizo salchichon fuet longaniza butifarra sobrasada morcilla lomo salami mortadela chicharron codillo guanciale carbonara fabada cocido", "pork"],
  ["lomo embuchado|cinta de lomo|paleta iberica|secreto iberico|presa iberica|pluma iberica|manteca de cerdo|manteca colorada|manteca colora|manitas de cerdo|carrillera de cerdo|solomillo de cerdo|costilla de cerdo|chuleta de cerdo", "pork"],
  ["manteca", "pork?"],
  ["solomillo costilla chuleta carrillada carrillera albondiga hamburguesa salchicha embutido pate foie bolonesa ragu callos", "meat pork?"],
  ["jamon de pavo|pechuga de pavo|salchicha de pollo|salchicha de pavo|hamburguesa de pollo|hamburguesa de ternera|hamburguesa de pavo|solomillo de ternera|chuleta de cordero|chuleta de ternera|costilla de ternera|lomo de ternera|lomo de vacuno|lomo de buey", "meat"],
  ["carne de membrillo|chorizo vegetal|chorizo vegano|hamburguesa vegetal|hamburguesa vegana|salchicha vegetal|salchicha vegana|manteca de cacao|carne vegetal|carne vegana", ""],
  // Meat.
  ["pollo gallina pavo ternera vaca vacuno buey cordero lechazo cabrito conejo liebre pato oca codorniz perdiz faisan jabali venado ciervo carne cecina chuleton entrecot pechuga muslo contramuslo alita higado rinon molleja rabo osobuco kebab fabada cocido", "meat"],
  ["carne picada|rabo de toro|caldo de pollo|caldo de carne|caldo de huesos|caldo de cocido|fondo de carne", "meat"],
  ["caldo de jamon|", "pork"],
  ["caldo", "meat?"],
  ["caldo de verduras|caldo vegetal|caldo de setas", ""],
  // Fish.
  ["pescado salmon merluza bacalao atun bonito sardina anchoa boqueron lubina dorada caballa ventresca emperador rape trucha gulas surimi rodaballo lenguado gallo jurel salmonete besugo perca panga tilapia abadejo arenque palometa mero corvina chicharro angula colin bacaladilla pescadilla huevas fumet", "fish"],
  ["pez espada|pescado azul|caldo de pescado|salsa de pescado|leche de tigre|cola de pescado", "fish"],
  ["salsa worcestershire|salsa perrins", "fish?"],
  ["lomo de salmon|lomo de atun|lomo de bacalao|lomo de merluza|lomo de bonito|lomo de corvina", "fish"],
  ["pico de gallo|cebolla dorada|patata dorada|costra dorada|piel dorada", ""],
  // Shellfish: crustaceans and molluscs.
  ["gamba langostino langosta bogavante cangrejo centollo cigala carabinero quisquilla camaron necora percebe", "crustaceans"],
  ["buey de mar|", "crustaceans"],
  ["mejillon almeja chirla berberecho navaja vieira ostra zamburina sepia calamar chipiron pulpo choco caracol puntilla poton", "molluscs"],
  ["salsa de ostras|", "molluscs"],
  ["marisco", "crustaceans molluscs"],
  ["frutos del mar|frutos de mar|caldo de marisco|fumet de marisco", "crustaceans molluscs"],
  ["marinera", "crustaceans? molluscs? fish?"],
  // Egg.
  ["huevo yema clara tortilla revuelto mayonesa mahonesa merengue flan natillas quiche carbonara", "egg"],
  ["pasta al huevo|fideos al huevo|huevo hilado|salsa tartara|crema catalana", "egg"],
  ["pasta al huevo|fideos al huevo", "gluten"],
  ["alioli", "egg?"],
  ["salsa rosa|", "egg?"],
  ["tortilla de trigo|tortilla mexicana|wrap", "gluten"],
  ["tortilla de maiz|", ""],
  // Dairy.
  ["leche queso nata mantequilla yogur yogurt kefir requeson bechamel cuajada lacteo lactosa mozzarella parmesano feta ricotta mascarpone burrata cheddar gouda emmental brie camembert provolone manchego gorgonzola roquefort ghee paneer natillas flan carbonara", "dairy"],
  ["crema de leche|suero de leche|suero lacteo|leche condensada|leche evaporada|leche en polvo|proteina de leche|queso de cabra|leche de cabra|leche de oveja|queso de oveja|leche de vaca|queso de vaca|crema catalana", "dairy"],
  ["gratinado gratinada suero helado", "dairy?"],
  ["pure de patata|pure de patatas", "dairy?"],
  // Plant drinks and spreads: not dairy (their own group when they have one).
  ["leche de coco|leche de arroz|bebida vegetal|bebida de arroz|bebida de coco|yogur de coco|nata vegetal|queso vegano|queso vegetal|mantequilla vegetal|yogur vegetal", ""],
  ["leche de soja|bebida de soja|yogur de soja|nata de soja", "soy"],
  ["leche de avena|bebida de avena|nata de avena", "gluten?"],
  ["leche de almendra|bebida de almendra|leche de avellana|bebida de avellana|mantequilla de almendra|crema de almendra|harina de almendra|crema de avellana", "nuts"],
  ["mantequilla de cacahuete|crema de cacahuete|salsa satay", "peanuts"],
  // Gluten.
  ["trigo pan tosta espelta cebada centeno kamut seitan semola cuscus bulgur freekeh pasta espagueti spaghetti macarron fideo tallarin lasana canelon ravioli tortellini noquis pizza empanada empanadilla bizcocho galleta magdalena hojaldre panko picatoste crutones colines brioche bollo malta tempura migas torrija", "gluten"],
  ["harina de trigo|harina de fuerza|harina integral|pan rallado|pan de molde|cous cous|masa quebrada|pasta brisa", "gluten"],
  ["rebozado rebozada empanado empanada", "gluten egg?"],
  ["croqueta", "gluten dairy egg?"],
  ["bechamel", "gluten"],
  ["lasana canelon", "dairy meat?"],
  ["crepe crepes", "gluten egg dairy"],
  ["harina tostada avena", "gluten?"],
  ["harina de avena|", "gluten?"],
  ["salsa de soja|", "soy gluten?"],
  ["cerveza", "gluten alcohol"],
  ["harina de maiz|harina de arroz|harina de garbanzo|harina de garbanzos|trigo sarraceno|pasta de arroz|pasta de legumbres|pasta de lentejas|pasta de garbanzos|pasta de curry|pasta de aceitunas|fideos de arroz|semola de maiz|semola de arroz|pan de maiz", ""],
  ["pasta de sesamo|", "sesame"],
  ["pasta de miso|", "soy"],
  ["pasta fresca|fideos chinos|noodles", "egg?"],
  ["pizza", "dairy?"],
  ["bizcocho", "egg dairy?"],
  ["galleta hojaldre", "dairy?"],
  ["salmorejo ajoblanco", "gluten"],
  ["gazpacho", "gluten?"],
  // Nuts (EU «frutos de cáscara», plus pine nuts). Peanuts are their own group.
  ["almendra avellana nuez anacardo pistacho pinon macadamia pecana pesto mazapan praline turron nougat romesco ajoblanco", "nuts"],
  ["fruto seco|fruto de cascara|nuez de brasil|nuez de macadamia|nuez pecana", "nuts"],
  ["nuez moscada|nuez de coco", ""],
  ["pesto", "dairy"],
  ["mazapan", "egg?"],
  ["cacahuete mani", "peanuts"],
  // Alcohol.
  ["vino cerveza sidra brandy conac licor ron jerez oporto cava champan champagne vermut vermouth whisky vodka ginebra orujo pacharan marsala sake tequila sangria calvados amaretto kirsch", "alcohol"],
  ["anis mirin moscatel", "alcohol?"],
  ["anis estrellado|anis verde|vinagre de vino|vinagre de jerez|vinagre de sidra|vinagre de cava|vinagre de modena", ""],
  ["vino", "sulphites"],
  ["vinagre", "sulphites?"],
  // Vegan: honey and gelatine.
  ["miel", "honey"],
  ["miel de cana|", ""],
  ["gelatina colapez", "gelatin"],
  ["hojas de gelatina|", "gelatin"],
  ["cola de pescado|", "gelatin"],
  ["gelatina vegetal|agar agar", ""],
  ["agar", ""],
  // Other EU-14 allergens.
  ["sesamo ajonjoli tahini tahin hummus", "sesame"],
  ["mostaza", "mustard"],
  ["apio", "celery"],
  ["soja tofu tempeh edamame miso tamari", "soy"],
  ["brotes de soja|", "soy?"],
  ["sulfito orejones", "sulphites"],
  ["dioxido de azufre|", "sulphites"],
  ["altramuz altramuces", "lupin"],
  ["harina de altramuz|", "lupin"],
];

function parseMarks(spec: string): Mark[] {
  return spec
    .split(" ")
    .filter(Boolean)
    .map((code) => ({
      group: code.replace("?", "") as FoodGroup,
      certainty: code.endsWith("?") ? ("possible" as const) : ("certain" as const),
    }));
}

// Same word in singular or plural: «nueces»/«nuez», «gambas»/«gamba», «panes»/«pan».
function wordForms(token: string): string[] {
  const forms = [token];
  if (token.endsWith("ces") && token.length > 4) forms.push(`${token.slice(0, -3)}z`);
  if (token.endsWith("s") && token.length > 3) forms.push(token.slice(0, -1));
  // «-es» after a consonant: «limones» → «limón», «panes» → «pan».
  if (token.endsWith("es") && token.length > 4 && !/[aeiou]/.test(token.at(-3) ?? "")) forms.push(token.slice(0, -2));
  return forms;
}

const sameWord = (a: string, b: string) => {
  if (a === b) return true;
  const formsB = wordForms(b);
  return wordForms(a).some((form) => formsB.includes(form));
};

function buildEntries() {
  const byKey = new Map<string, Entry>();
  for (const [phrases, spec] of definitions) {
    // «a|b c» is a list of phrases; «a b» a list of single words.
    const list = phrases.includes("|") ? phrases.split("|") : phrases.split(" ");
    for (const phrase of list) {
      const key = normalizeFood(phrase);
      if (!key) continue;
      const existing = byKey.get(key);
      const marks = parseMarks(spec);
      if (existing) {
        for (const mark of marks) {
          if (!existing.marks.some((other) => other.group === mark.group && other.certainty === mark.certainty)) existing.marks.push(mark);
        }
      } else {
        byKey.set(key, { key, tokens: key.split(" "), marks });
      }
    }
  }
  // A certain mark wins over a possible one of the same group.
  for (const entry of byKey.values()) {
    entry.marks = entry.marks.filter(
      (mark) => mark.certainty === "certain" || !entry.marks.some((other) => other.group === mark.group && other.certainty === "certain"),
    );
  }
  // Longest phrases first: «nuez moscada» before «nuez», «pan rallado» before «pan».
  return [...byKey.values()].sort((a, b) => b.tokens.length - a.tokens.length);
}

const entries = buildEntries();
const entryIndex = new Map<string, Entry[]>();
for (const entry of entries) {
  for (const form of wordForms(entry.tokens[0])) {
    const bucket = entryIndex.get(form) ?? [];
    if (!bucket.includes(entry)) bucket.push(entry);
    entryIndex.set(form, bucket);
  }
}

// Names of a whole group, for «sin …» and for free text («alergia al marisco»).
const groupNameDefinitions: [string, FoodNegation[]][] = [
  ["carne|carnes", ["meat"]],
  ["cerdo|porcino", ["pork"]],
  ["pescado", ["fish"]],
  ["crustaceo", ["crustaceans"]],
  ["molusco", ["molluscs"]],
  ["marisco|frutos del mar|frutos de mar", ["crustaceans", "molluscs"]],
  ["huevo", ["egg"]],
  ["leche|lacteo|proteina de leche|proteina de la leche|leche de vaca", ["dairy"]],
  ["lactosa", ["lactose"]],
  ["gluten|celiaco|celiaca|celiaquia", ["gluten"]],
  ["fruto seco|fruto de cascara", ["nuts"]],
  ["cacahuete|mani", ["peanuts"]],
  ["alcohol", ["alcohol"]],
  ["miel", ["honey"]],
  ["gelatina", ["gelatin"]],
  ["sesamo|ajonjoli", ["sesame"]],
  ["mostaza", ["mustard"]],
  ["apio", ["celery"]],
  ["soja", ["soy"]],
  ["sulfito|dioxido de azufre", ["sulphites"]],
  ["altramuz|altramuces", ["lupin"]],
];

const groupNames = groupNameDefinitions
  .flatMap(([phrases, groups]) => phrases.split("|").map((phrase) => ({ tokens: normalizeFood(phrase).split(" "), groups })))
  .sort((a, b) => b.tokens.length - a.tokens.length);

function matchesAt(tokens: string[], start: number, phrase: string[]) {
  if (start + phrase.length > tokens.length) return false;
  return phrase.every((word, offset) => sameWord(tokens[start + offset], word));
}

export type FoodMention = {
  // Normalised words of the text that matched («queso parmesano» → «queso», then «parmesano»).
  term: string;
  // The lexicon entry («nueces» → «nuez»).
  entry: string;
  group: FoodGroup;
  certainty: Certainty;
};

export type FoodAnalysis = {
  tokens: string[];
  mentions: FoodMention[];
  // Entries that matched, in order (also exceptions without groups), with their word span.
  hits: { entry: string; start: number; end: number }[];
  negated: Set<FoodNegation>;
};

// Group names at a position («sin frutos secos» → nuts). Longest first.
export function groupNameAt(tokens: string[], start: number): { groups: FoodNegation[]; length: number } | null {
  for (const name of groupNames) {
    if (matchesAt(tokens, start, name.tokens)) return { groups: name.groups, length: name.tokens.length };
  }
  return null;
}

export function analyzeFoodText(text: string): FoodAnalysis {
  const tokens = normalizeFood(text).split(" ").filter(Boolean);
  const mentions: FoodMention[] = [];
  const hits: FoodAnalysis["hits"] = [];
  const negated = new Set<FoodNegation>();
  let index = 0;
  while (index < tokens.length) {
    // «sin X» / «apto para celiacos»: X does not count, and a whole group named after it is cancelled.
    if ((tokens[index] === "sin" || tokens[index] === "libre") && index + 1 < tokens.length) {
      const offset = tokens[index] === "libre" && tokens[index + 1] === "de" ? 2 : 1;
      const named = groupNameAt(tokens, index + offset);
      if (named) {
        named.groups.forEach((group) => negated.add(group));
        index += offset + named.length;
        continue;
      }
      const entry = entryAt(tokens, index + offset);
      if (entry) {
        index += offset + entry.tokens.length;
        continue;
      }
    }
    if (/^apt[oa]s?$/.test(tokens[index]) && tokens[index + 1] === "para" && /^celiac/.test(tokens[index + 2] ?? "")) {
      negated.add("gluten");
      index += 3;
      continue;
    }
    const entry = entryAt(tokens, index);
    if (!entry) {
      index += 1;
      continue;
    }
    const term = tokens.slice(index, index + entry.tokens.length).join(" ");
    hits.push({ entry: entry.key, start: index, end: index + entry.tokens.length });
    for (const mark of entry.marks) mentions.push({ term, entry: entry.key, group: mark.group, certainty: mark.certainty });
    index += entry.tokens.length;
  }
  return { tokens, mentions, hits, negated };
}

function entryAt(tokens: string[], start: number): Entry | null {
  const token = tokens[start];
  if (token === undefined) return null;
  const candidates = new Set<Entry>();
  for (const form of wordForms(token)) for (const entry of entryIndex.get(form) ?? []) candidates.add(entry);
  // Longest phrase first; on a tie, the exact word («colines» is breadsticks, not «colín»).
  const score = (entry: Entry) => entry.tokens.length * 2 + (entry.tokens[0] === token ? 1 : 0);
  let best: Entry | null = null;
  for (const entry of candidates) {
    if ((!best || score(entry) > score(best)) && matchesAt(tokens, start, entry.tokens)) best = entry;
  }
  return best;
}

// The lexicon entry a free-text item is exactly («almendras» → «almendra»), if any.
export function lexiconEntryFor(text: string): string | null {
  const tokens = normalizeFood(text).split(" ").filter(Boolean);
  if (!tokens.length) return null;
  const entry = entryAt(tokens, 0);
  return entry && entry.tokens.length === tokens.length ? entry.key : null;
}

// The groups a lexicon entry marks («almendra» → nuts).
export function lexiconEntryGroups(key: string): Mark[] {
  return entries.find((entry) => entry.key === key)?.marks ?? [];
}

// Whether a literal phrase appears as whole words, singular or plural («fresa» in «Fresas con nata»).
export function mentionsPhrase(text: string, phrase: string): string | null {
  const tokens = normalizeFood(text).split(" ").filter(Boolean);
  const words = normalizeFood(phrase).split(" ").filter(Boolean);
  if (!words.length) return null;
  for (let start = 0; start + words.length <= tokens.length; start += 1) {
    if (matchesAt(tokens, start, words)) return tokens.slice(start, start + words.length).join(" ");
  }
  return null;
}
