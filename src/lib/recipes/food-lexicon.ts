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
  // Minced-meat dishes usually carry breadcrumbs and egg.
  ["albondiga hamburguesa", "gluten? egg?"],
  ["hamburguesa de pollo|hamburguesa de ternera|hamburguesa de pavo", "gluten? egg?"],
  ["jamon de pavo|pechuga de pavo|salchicha de pollo|salchicha de pavo|hamburguesa de pollo|hamburguesa de ternera|hamburguesa de pavo|solomillo de ternera|chuleta de cordero|chuleta de ternera|costilla de ternera|lomo de ternera|lomo de vacuno|lomo de buey", "meat"],
  ["carne de membrillo|carne de pimiento choricero|carne de pimiento|chorizo vegetal|chorizo vegano|hamburguesa vegetal|hamburguesa vegana|salchicha vegetal|salchicha vegana|manteca de cacao|carne vegetal|carne vegana", ""],
  // Meat.
  ["pollo gallina pavo ternera vaca vacuno buey cordero lechazo cabrito conejo liebre pato oca codorniz perdiz faisan jabali venado ciervo carne cecina chuleton entrecot pechuga muslo contramuslo alita higado rinon molleja rabo osobuco kebab fabada cocido", "meat"],
  ["ternasco", "meat"],
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
  ["arroz negro|", "molluscs"],
  ["zarzuela", "fish crustaceans molluscs"],
  ["mariscada", "crustaceans molluscs"],
  ["salpicon", "crustaceans? molluscs? fish?"],
  ["paella", "crustaceans? molluscs? meat?"],
  ["fideua", "gluten crustaceans? molluscs?"],
  ["sushi ceviche caviar", "fish"],
  ["pad thai|", "peanuts? egg? fish?"],
  // Egg.
  ["huevo yema clara tortilla revuelto mayonesa mahonesa merengue flan natillas quiche carbonara", "egg"],
  ["pasta al huevo|fideos al huevo|huevo hilado|salsa tartara|crema catalana", "egg"],
  ["pasta al huevo|fideos al huevo", "gluten"],
  ["alioli", "egg?"],
  ["salsa rosa|", "egg?"],
  ["tortilla de trigo|tortilla mexicana|wrap", "gluten"],
  ["tortilla de maiz|", ""],
  ["huevo de codorniz|huevo de gallina|huevo de pato|huevo de oca", "egg"],
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
  // Pasta shapes and breads that recipe titles name by their own word.
  ["fusilli penne rigatoni tagliatelle linguine farfalle orzo noodles udon bruschetta panzanella focaccia pita naan chapata", "gluten"],
  ["noodles de arroz|noodles de konjac|fideos de konjac", ""],
  ["harina de trigo|harina de fuerza|harina integral|pan rallado|pan de molde|cous cous|masa quebrada|pasta brisa", "gluten"],
  ["rebozado rebozada empanado empanada", "gluten egg?"],
  ["croqueta", "gluten dairy egg?"],
  ["bechamel", "gluten"],
  ["lasana canelon", "dairy meat?"],
  ["crepe crepes", "gluten egg dairy"],
  ["a la romana|", "gluten egg?"],
  ["bocadillo bocata sandwich montadito croissant cruasan brownie churro bunuelo gofre tortita burrito ramen gnocchi couscous", "gluten"],
  ["croissant cruasan brownie gofre tortita", "egg? dairy?"],
  ["bunuelo ramen", "egg?"],
  ["tiramisu", "gluten egg dairy alcohol?"],
  ["ensaladilla", "egg"],
  ["ensaladilla rusa|", "egg fish?"],
  ["harina tostada|harina|avena", "gluten?"],
  // «tostada» is bread only as a noun (see nounOnlyEntries): «almendras tostadas» is not.
  ["tostada", "gluten"],
  ["harina de avena|", "gluten?"],
  ["salsa de soja|", "soy gluten?"],
  ["cerveza", "gluten alcohol"],
  ["harina de maiz|harina de arroz|harina de garbanzo|harina de garbanzos|trigo sarraceno|pasta de arroz|pasta de legumbres|pasta de lentejas|pasta de garbanzos|pasta de curry|pasta de aceitunas|pasta de tomate|pasta de pimiento|pasta de ajo|fideos de arroz|semola de maiz|semola de arroz|pan de maiz", ""],
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
  // Dish names of the recipe catalogue whose title does not name what they carry.
  ["frittata shakshuka pericos avgolemono", "egg"],
  ["latkes", "egg gluten"],
  ["tres delicias|", "egg pork? crustaceans?"],
  ["quesadilla pizzadilla minipizza", "gluten dairy"],
  ["fajita bagel capunti kushari", "gluten"],
  ["taco taquito rollito pocket", "gluten?"],
  ["pastel pastelito tarta", "gluten? egg? dairy?"],
  ["strudel spanakopita", "gluten dairy egg?"],
  ["falafel", "gluten? sesame?"],
  ["musaka moussaka papoutzakia", "meat dairy gluten? egg?"],
  ["cesar", "dairy egg? fish? gluten?"],
  ["caprese pecorino havarti cottage", "dairy"],
  ["risotto", "dairy? alcohol?"],
  ["biryani tandoori", "dairy?"],
  ["marmitako pargo cogote sardinilla empedrat esqueixada puttanesca", "fish"],
  ["tuna melt|", "fish gluten dairy"],
  ["pipirrana", "fish? egg?"],
  ["marsellesa", "fish? crustaceans? molluscs?"],
  ["arroz a banda|", "fish crustaceans? molluscs?"],
  ["gambon", "crustaceans"],
  ["pota pulpito", "molluscs"],
  ["serrano iberico york", "pork"],
  ["moruno moruna", "meat pork?"],
  ["lengua picadillo escalopin fiambre", "meat"],
  ["escalopin", "gluten? egg?"],
  ["tahina zatar", "sesame"],
  ["salchicha", "gluten?"],
  // «Crema de calabaza»: a vegetable cream often carries cream or cheese.
  ["crema", "dairy?"],
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
// Third value: only for free text («alergia al trigo» → all gluten); after «sin» it is just a word
// («pan sin trigo» may still have rye or barley).
const groupNameDefinitions: [string, FoodNegation[], "free_text_only"?][] = [
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
  ["trigo|cebada|centeno|espelta|kamut|harina de trigo", ["gluten"], "free_text_only"],
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
  .flatMap(([phrases, groups, scope]) =>
    phrases.split("|").map((phrase) => ({ tokens: normalizeFood(phrase).split(" "), groups, freeTextOnly: scope === "free_text_only" })),
  )
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
  // «sin …» right after this term («pan sin gluten», «leche sin lactosa»): cancelled for those.
  negated: FoodNegation[];
};

export type FoodAnalysis = {
  tokens: string[];
  mentions: FoodMention[];
  // Entries that matched, in order (also exceptions without groups), with their word span.
  hits: { entry: string; start: number; end: number }[];
  // Every group some «sin …» of the text names (each one only cancels its own term).
  negated: Set<FoodNegation>;
};

// Group names at a position («sin frutos secos» → nuts). Longest first.
export function groupNameAt(
  tokens: string[],
  start: number,
  use: "free_text" | "negation" = "free_text",
): { groups: FoodNegation[]; length: number } | null {
  for (const name of groupNames) {
    if (use === "negation" && name.freeTextOnly) continue;
    if (matchesAt(tokens, start, name.tokens)) return { groups: name.groups, length: name.tokens.length };
  }
  return null;
}

// Words that end the term a «sin …» qualifies: «Pasta sin huevo a la carbonara» (carbonara still
// counts), «Arroz sin marisco con gambas» (gambas still count).
const termBoundaries = new Set(["con", "y", "e", "o", "a", "al", "sobre", "en", "mas", "sin", "libre", "apto", "apta", "aptos", "aptas"]);
// Bread only as a noun: first word or after a connector («Tostadas de aguacate», «con tostadas»),
// never after another food («almendras tostadas»).
// «cocido» is the stew only as a noun: «garbanzos cocidos» or «huevo cocido» are not meat.
const nounOnlyEntries = new Set(["tostada", "cocido"]);
const nounContext = new Set(["con", "y", "e", "o", "una", "unas", "un", "el", "los", "la", "las", "sobre", "de", "del"]);

export function analyzeFoodText(text: string): FoodAnalysis {
  const tokens = normalizeFood(text).split(" ").filter(Boolean);
  const mentions: FoodMention[] = [];
  const hits: FoodAnalysis["hits"] = [];
  const negated = new Set<FoodNegation>();
  // Term start of the current stretch (after the last boundary word).
  let termStart = 0;
  const tracked: (FoodMention & { start: number })[] = [];
  let index = 0;
  while (index < tokens.length) {
    // «sin X» / «libre de X»: X does not count. Only a group name («gluten», «lactosa», «huevo»)
    // cancels that group for the term before it; another word («sin queso», «sin trigo») only itself.
    if ((tokens[index] === "sin" || tokens[index] === "libre") && index + 1 < tokens.length) {
      const offset = tokens[index] === "libre" && tokens[index + 1] === "de" ? 2 : 1;
      const named = groupNameAt(tokens, index + offset, "negation");
      const entry = named ? null : entryAt(tokens, index + offset);
      if (named || entry) {
        if (named) {
          negateTracked(tracked, termStart, index, named.groups);
          named.groups.forEach((group) => negated.add(group));
        }
        index += offset + (named ? named.length : (entry as Entry).tokens.length);
        termStart = index;
        continue;
      }
    }
    if (/^apt[oa]s?$/.test(tokens[index]) && tokens[index + 1] === "para" && /^celiac/.test(tokens[index + 2] ?? "")) {
      negateTracked(tracked, termStart, index, ["gluten"]);
      negated.add("gluten");
      index += 3;
      termStart = index;
      continue;
    }
    const entry = entryAt(tokens, index);
    if (termBoundaries.has(tokens[index])) {
      termStart = entry ? index : index + 1;
      // A phrase may start with a connector («a la romana»).
      if (!entry) {
        index += 1;
        continue;
      }
    }
    if (!entry || (nounOnlyEntries.has(entry.key) && index > 0 && !nounContext.has(tokens[index - 1]))) {
      index += 1;
      continue;
    }
    const term = tokens.slice(index, index + entry.tokens.length).join(" ");
    hits.push({ entry: entry.key, start: index, end: index + entry.tokens.length });
    for (const mark of entry.marks) {
      tracked.push({ term, entry: entry.key, group: mark.group, certainty: mark.certainty, negated: [], start: index });
    }
    index += entry.tokens.length;
  }
  for (const { start: _start, ...mention } of tracked) {
    void _start;
    mentions.push(mention);
  }
  return { tokens, mentions, hits, negated };
}

function negateTracked(tracked: (FoodMention & { start: number })[], from: number, until: number, groups: FoodNegation[]) {
  for (const mention of tracked) {
    if (mention.start >= from && mention.start < until) mention.negated.push(...groups);
  }
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
