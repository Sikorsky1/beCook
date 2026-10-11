const {test} = require("node:test");
const assert = require("node:assert/strict");

// C3 (roadmap step 18): restrictions against structured ingredients. Synthetic data only.
const {analyzeFoodText, normalizeFood, mentionsPhrase} = require("../src/lib/recipes/food-lexicon.ts");
const {checkDish, blocksAutomaticProposal, mentionsDislikedFood, resolveFreeText, compileRestrictions, hasFoodRestrictions} = require("../src/lib/recipes/restriction-check.ts");
const {readMenuProfile} = require("../src/lib/menu-generation/prompt.ts");
const {selectionToMenu, visibleFoodConflict} = require("../src/lib/menu-generation/validation.ts");
const {checkReplacement} = require("../src/lib/menu-generation/substitution.ts");

const profile = (value) => readMenuProfile(value);
const groups = (text) => analyzeFoodText(text).mentions.map((m) => `${m.group}${m.certainty === "possible" ? "?" : ""}`);
const has = (text, group) => groups(text).includes(group);
const card = (names, possibleAllergens = [], reviewStatus = "inferred") => ({
 reviewStatus,
 possibleAllergens,
 ingredients: names.map((name) => typeof name === "string" ? {name, quantity: 1, unit: "ud", category: "despensa", optional: false} : {quantity: null, unit: null, category: "despensa", optional: false, ...name}),
});

test("defect (title filter before C3): carbonara and fabada pass «sin cerdo», free-text allergies are ignored when generating", () => {
 assert.equal(visibleFoodConflict("Espaguetis carbonara", profile({dietaryRestrictions: ["no_pork"]})), true, "carbonara lleva guanciale, panceta o beicon");
 assert.equal(visibleFoodConflict("Fabada asturiana", profile({dietaryRestrictions: ["no_pork"]})), true, "fabada lleva chorizo y morcilla");
 const lunches = ["Pollo al sésamo con arroz", "Lentejas estofadas", "Arroz meloso de sepia", "Espaguetis con setas", "Garbanzos con espinacas", "Merluza al horno", "Paella de pollo"];
 const dinners = ["Tortilla de patata", "Ensalada de tomate y queso fresco", "Salmón a la plancha", "Crema de calabaza", "Revuelto de champiñones", "Bacalao al pilpil", "Tosta de aguacate"];
 assert.throws(() => selectionToMenu({lunches, dinners}, profile({allergies: ["other"], otherAllergies: "sésamo"})), /restriction_conflict/);
});

test("defect (title filter before C3): false alarms on nutmeg, coconut milk and peanut butter", () => {
 assert.equal(visibleFoodConflict("Crema de calabaza con nuez moscada", profile({allergies: ["nuts"]})), false);
 assert.equal(visibleFoodConflict("Curry de garbanzos con leche de coco", profile({allergies: ["lactose"]})), false);
 assert.equal(visibleFoodConflict("Tostadas con mantequilla de cacahuete", profile({allergies: ["lactose"]})), false);
 assert.equal(visibleFoodConflict("Tostadas con mantequilla de cacahuete", profile({dietaryRestrictions: ["vegan"]})), false);
});

test("defect (title filter before C3): a pesto card with nuts is invisible from a title without «pesto»", () => {
 const genovese = card(["espaguetis", "albahaca", "piñones", "queso parmesano", "aceite de oliva"], ["gluten", "milk", "nuts"]);
 const result = checkDish({title: "Pasta a la genovesa", card: genovese}, profile({allergies: ["nuts"]}));
 assert.equal(result.status, "conflict");
 assert.ok(result.findings.some((f) => f.source === "ingredient" && f.ingredient === "piñones"));
 assert.equal(visibleFoodConflict("Pasta a la genovesa", profile({allergies: ["nuts"]})), false, "the title alone says nothing");
});

test("lexicon: whole words only («pan» ≠ «panceta», «cebolla» ≠ «cebada», «colines» ≠ «colín»)", () => {
 assert.equal(normalizeFood("  Jamón  IBÉRICO, ñoquis! "), "jamon iberico noquis");
 assert.ok(has("Pan con tomate", "gluten"));
 assert.ok(!has("Panceta asada", "gluten"));
 assert.ok(has("Panceta asada", "pork"));
 assert.ok(!has("Cebolla caramelizada", "gluten"));
 assert.ok(has("Sopa de cebada", "gluten"));
 assert.deepEqual(groups("Colines"), ["gluten"]);
 assert.deepEqual(groups("Pimientos del piquillo"), []);
 assert.deepEqual(groups("Ensalada de rúcula"), []);
 assert.ok(!has("Patatas a lo pobre", "meat"));
});

test("lexicon: plurals, accents and variants", () => {
 for (const [text, group] of [
  ["Nueces", "nuts"], ["nuez", "nuts"], ["Gambas al ajillo", "crustaceans"], ["Langostinos", "crustaceans"], ["Mejillones al vapor", "molluscs"],
  ["Calamares a la romana", "molluscs"], ["Huevos rotos", "egg"], ["Yemas", "egg"], ["Claras montadas", "egg"], ["Mahonesa", "egg"],
  ["Jamones", "pork"], ["Beicon", "pork"], ["Bacon", "pork"], ["Sobrasada", "pork"], ["Lomo a la plancha", "pork"], ["Manteca de cerdo", "pork"],
  ["Chorizo", "pork"], ["Albóndigas", "meat"], ["Panes", "gluten"], ["Pan rallado", "gluten"], ["Sémola", "gluten"], ["Espelta", "gluten"],
  ["Centeno", "gluten"], ["Seitán", "gluten"], ["Cuscús", "gluten"], ["Cerveza", "gluten"], ["Cerveza", "alcohol"], ["Jerez", "alcohol"],
  ["Vino blanco", "alcohol"], ["Sidra", "alcohol"], ["Brandy", "alcohol"], ["Coñac", "alcohol"], ["Quesos", "dairy"], ["Requesón", "dairy"],
  ["Kéfir", "dairy"], ["Yogures", "dairy"], ["Bechamel", "dairy"], ["Bechamel", "gluten"], ["Suero de leche", "dairy"], ["Nata", "dairy"],
  ["Mantequilla", "dairy"], ["Anchoas", "fish"], ["Surimi", "fish"], ["Caldo de pescado", "fish"], ["Salsa de pescado", "fish"],
  ["Mazapán", "nuts"], ["Praliné", "nuts"], ["Piñones", "nuts"], ["Pesto", "nuts"], ["Pesto", "dairy"], ["Miel", "honey"], ["Gelatina", "gelatin"],
  ["Sésamo", "sesame"], ["Tahini", "sesame"], ["Mostaza", "mustard"], ["Apio", "celery"], ["Tofu", "soy"], ["Altramuces", "lupin"],
  ["Cacahuetes", "peanuts"], ["Buey de mar", "crustaceans"], ["Pez espada", "fish"], ["Lomo de salmón", "fish"],
 ]) assert.ok(has(text, group), `${text} → ${group}: ${groups(text)}`);
});

test("lexicon: possible mentions (unqualified flour, oats, soy sauce, alioli, peanuts are not nuts)", () => {
 assert.deepEqual(groups("Harina"), ["gluten?"]);
 assert.deepEqual(groups("Harina de trigo"), ["gluten"]);
 assert.deepEqual(groups("Harina de maíz"), []);
 assert.deepEqual(groups("Copos de avena"), ["gluten?"]);
 assert.deepEqual(groups("Salsa de soja").sort(), ["gluten?", "soy"]);
 assert.deepEqual(groups("Alioli"), ["egg?"]);
 assert.deepEqual(groups("Pasta al huevo").sort(), ["egg", "gluten"].sort());
 assert.ok(groups("Pasta fresca").includes("egg?"));
 assert.deepEqual(groups("Cacahuetes"), ["peanuts"]);
});

test("lexicon: exceptions (nutmeg, coconut milk, plant drinks, peanut butter, wine vinegar, «buey de mar»)", () => {
 assert.deepEqual(groups("Nuez moscada"), []);
 assert.deepEqual(groups("Una pizca de nuez moscada"), []);
 assert.deepEqual(groups("Leche de coco"), []);
 assert.deepEqual(groups("Bebida vegetal de arroz"), []);
 assert.deepEqual(groups("Leche de soja"), ["soy"]);
 assert.deepEqual(groups("Leche de almendras"), ["nuts"]);
 assert.deepEqual(groups("Mantequilla de cacahuete"), ["peanuts"]);
 assert.deepEqual(groups("Vinagre de vino"), []);
 assert.deepEqual(groups("Buey de mar"), ["crustaceans"]);
 assert.ok(!has("Leche de vaca", "meat"));
 assert.ok(!has("Carne de membrillo", "meat"));
 assert.ok(!has("Jamón de pavo", "pork"));
 assert.ok(has("Jamón de pavo", "meat"));
 assert.ok(!has("Hamburguesa vegetal", "meat"));
 assert.ok(!has("Tortilla de maíz", "egg"));
 assert.deepEqual(groups("Huevas de merluza"), ["fish", "fish"]);
 assert.ok(!has("Pico de gallo", "fish"));
});

test("lexicon: negations «sin …» cancel the group for that text only", () => {
 assert.ok(analyzeFoodText("Pan sin gluten").negated.has("gluten"));
 assert.ok(analyzeFoodText("Leche sin lactosa").negated.has("lactose"));
 assert.ok(!analyzeFoodText("Leche sin lactosa").negated.has("dairy"), "still dairy for a vegan");
 assert.ok(analyzeFoodText("Bizcocho sin huevo").negated.has("egg"));
 assert.ok(analyzeFoodText("Pesto sin frutos secos").negated.has("nuts"));
 assert.ok(analyzeFoodText("Cerveza sin alcohol").negated.has("alcohol"));
 assert.ok(analyzeFoodText("Pan libre de gluten").negated.has("gluten"));
 assert.ok(analyzeFoodText("Galletas aptas para celíacos").negated.has("gluten"));
 assert.deepEqual(groups("Huevos rotos sin jamón"), ["egg"], "«sin X» drops that word");
 assert.equal(mentionsPhrase("Fresas con nata", "fresa"), "fresas");
 assert.equal(mentionsPhrase("Fresones", "fresa"), null);
});

test("checkDish: title only never says «none detected» when there are restrictions", () => {
 const vegan = profile({dietaryRestrictions: ["vegan"]});
 assert.deepEqual(checkDish({title: "Lentejas estofadas", card: null}, vegan), {status: "unverifiable", basis: "title_only", findings: [], uninterpretable: []});
 const carbonara = checkDish({title: "Espaguetis a la carbonara", card: null}, vegan);
 assert.equal(carbonara.status, "conflict");
 assert.equal(carbonara.basis, "title_only");
 assert.ok(carbonara.findings.every((f) => f.source === "title" && f.term === "carbonara"));
 assert.equal(checkDish({title: "Lentejas estofadas", card: null}, profile({})).status, "none_detected", "nothing to check");
 assert.equal(hasFoodRestrictions(profile({})), false);
 assert.equal(hasFoodRestrictions(profile({dislikedFoods: ["coliflor"]})), true);
});

test("checkDish: reviewed and inferred cards are checked by ingredient and by allergen tag", () => {
 const lactose = profile({allergies: ["lactose"]});
 const gratin = card(["patatas", {name: "queso rallado"}, "sal"], ["milk"], "reviewed");
 const reviewed = checkDish({title: "Patatas al horno", card: gratin}, lactose);
 assert.equal(reviewed.status, "conflict");
 assert.equal(reviewed.basis, "reviewed_card");
 assert.deepEqual(reviewed.findings.map((f) => [f.source, f.term, f.ingredient ?? null]).sort(), [["allergen_tag", "leche", null], ["ingredient", "queso", "queso rallado"]]);
 const inferred = checkDish({title: "Patatas al horno", card: {...gratin, reviewStatus: "inferred"}}, lactose);
 assert.equal(inferred.basis, "inferred_card");
 assert.equal(inferred.status, "conflict");
 // Tag only (the ingredient names do not say it): still a conflict, the card lists it.
 const tagOnly = checkDish({title: "Salsa de la casa", card: card(["tomate"], ["eggs"])}, profile({allergies: ["egg"]}));
 assert.equal(tagOnly.status, "conflict");
 assert.deepEqual(tagOnly.findings.map((f) => f.source), ["allergen_tag"]);
 // Clean card: none detected (never «apto»), unless free text could not be read.
 const clean = card(["lentejas", "zanahoria", "puerro", "aceite de oliva"], [], "reviewed");
 assert.equal(checkDish({title: "Lentejas con verduras", card: clean}, profile({dietaryRestrictions: ["vegan"], allergies: ["gluten"]})).status, "none_detected");
 const vague = checkDish({title: "Lentejas con verduras", card: clean}, profile({allergies: ["other"], otherAllergies: "algunas frutas, trazas"}));
 assert.equal(vague.status, "unverifiable");
 assert.deepEqual(vague.uninterpretable, ["algunas frutas", "trazas"]);
});

test("checkDish: optional ingredients and possible mentions are possible conflicts; negations clear them", () => {
 const nuts = profile({allergies: ["nuts"]});
 const optional = checkDish({title: "Ensalada verde", card: card(["lechuga", {name: "nueces", optional: true}])}, nuts);
 assert.equal(optional.status, "possible_conflict");
 assert.equal(optional.findings[0].ingredient, "nueces");
 const peanut = checkDish({title: "Pollo con salsa satay", card: card(["pollo", "salsa satay"], ["peanuts"])}, nuts);
 assert.equal(peanut.status, "possible_conflict", "peanuts are possible under «frutos secos»");
 const nutmeg = checkDish({title: "Bechamel ligera", card: card(["leche", "harina de arroz", "nuez moscada"], ["milk"])}, nuts);
 assert.equal(nutmeg.status, "none_detected");
 const glutenFree = checkDish({title: "Ensalada de tomate", card: card(["pan sin gluten", "tomate", "lechuga"], [])}, profile({allergies: ["gluten"]}));
 assert.equal(glutenFree.status, "none_detected");
 const lactoseFree = card(["leche sin lactosa", "arroz", "canela"], []);
 assert.equal(checkDish({title: "Arroz con leche", card: lactoseFree}, profile({allergies: ["lactose"]})).status, "conflict", "the title still says «leche»");
 assert.equal(checkDish({title: "Arroz con leche sin lactosa", card: lactoseFree}, profile({allergies: ["lactose"]})).status, "none_detected");
 assert.equal(checkDish({title: "Arroz con leche sin lactosa", card: lactoseFree}, profile({dietaryRestrictions: ["vegan"]})).status, "conflict", "still dairy for a vegan");
});

test("checkDish: each diet against its groups", () => {
 const cases = [
  ["vegetarian", "Pollo al limón", "conflict"], ["vegetarian", "Merluza en salsa verde", "conflict"], ["vegetarian", "Arroz con gambas", "conflict"],
  ["vegetarian", "Tortilla de patata", "unverifiable"], ["pescatarian", "Merluza en salsa verde", "unverifiable"], ["pescatarian", "Lentejas con chorizo", "conflict"],
  ["vegan", "Tortilla de patata", "conflict"], ["vegan", "Yogur con miel", "conflict"], ["vegan", "Panna cotta con gelatina", "conflict"],
  ["no_pork", "Alcachofas con jamón", "conflict"], ["no_pork", "Pollo asado", "unverifiable"], ["no_pork", "Albóndigas en salsa", "possible_conflict"],
  ["no_alcohol", "Pollo al vino", "conflict"], ["no_alcohol", "Ensalada con vinagre de vino", "unverifiable"], ["no_alcohol", "Mejillones a la cerveza sin alcohol", "unverifiable"],
 ];
 for (const [diet, title, status] of cases) assert.equal(checkDish({title, card: null}, profile({dietaryRestrictions: [diet]})).status, status, `${diet}: ${title}`);
});

test("free text: groups, allergens, literal words with plurals, vague text is uninterpretable", () => {
 assert.deepEqual(resolveFreeText("alergia al marisco"), {type: "groups", groups: ["crustaceans", "molluscs"], term: "marisco"});
 assert.deepEqual(resolveFreeText("Sésamo"), {type: "groups", groups: ["sesame"], term: "sesamo"});
 assert.deepEqual(resolveFreeText("mostaza").type, "groups");
 assert.deepEqual(resolveFreeText("intolerancia a la lactosa"), {type: "groups", groups: ["lactose"], term: "lactosa"});
 assert.deepEqual(resolveFreeText("pescado azul").type, "groups", "conservative: the whole group");
 assert.deepEqual(resolveFreeText("almendras"), {type: "entry", entry: "almendra"});
 assert.deepEqual(resolveFreeText("kiwi"), {type: "literal", phrase: "kiwi"});
 assert.deepEqual(resolveFreeText("no me gustan las coles"), {type: "literal", phrase: "coles"});
 for (const vague of ["algunas frutas", "trazas", "té", "frutas", "legumbres", "picante", "otras cosas", "la comida muy grasa que me sienta mal"]) {
  assert.equal(resolveFreeText(vague).type, "uninterpretable", vague);
 }
 const {compiled, uninterpretable} = compileRestrictions(profile({allergies: ["other"], otherAllergies: "Sésamo, mostaza y algunas frutas; kiwi", dislikedFoods: ["coliflor"]}));
 assert.deepEqual(compiled.map((c) => [c.restriction.kind, c.restriction.label]), [["other_allergy", "Sésamo"], ["other_allergy", "mostaza"], ["other_allergy", "kiwi"], ["disliked", "coliflor"]]);
 assert.deepEqual(uninterpretable, ["algunas frutas"]);
 assert.deepEqual(compileRestrictions(profile({allergies: ["other"]})).uninterpretable, ["Otra alergia sin especificar"]);
 assert.deepEqual(compileRestrictions(profile({dietaryRestrictions: ["keto"]})).uninterpretable, ["keto"], "an unknown diet is never ignored silently");
});

test("free text against dishes: allergens by name and by tag, literal plurals, nutmeg is not «nuez»", () => {
 const sesame = profile({allergies: ["other"], otherAllergies: "sésamo"});
 assert.equal(checkDish({title: "Pollo teriyaki", card: card(["pollo", "salsa de soja", "semillas de sésamo"])}, sesame).status, "conflict");
 assert.equal(checkDish({title: "Hummus con crudités", card: null}, sesame).status, "conflict");
 assert.equal(checkDish({title: "Pollo teriyaki", card: card(["pollo", "arroz"], ["sesame"])}, sesame).status, "conflict", "by tag");
 const almonds = profile({allergies: ["other"], otherAllergies: "almendras"});
 assert.equal(checkDish({title: "Ajoblanco", card: card(["almendra cruda", "ajo", "pan"])}, almonds).status, "conflict");
 assert.equal(checkDish({title: "Tarta", card: card(["harina", "huevo"], ["nuts"])}, almonds).status, "possible_conflict", "nuts listed, maybe not almonds");
 const walnut = profile({allergies: ["other"], otherAllergies: "nuez"});
 assert.equal(checkDish({title: "Crema de calabaza con nuez moscada", card: null}, walnut).status, "unverifiable");
 assert.equal(checkDish({title: "Ensalada con nueces", card: null}, walnut).status, "conflict");
 const kiwi = profile({allergies: ["other"], otherAllergies: "kiwi"});
 assert.equal(checkDish({title: "Macedonia con kiwis", card: null}, kiwi).status, "conflict");
 assert.equal(checkDish({title: "Macedonia", card: card(["kiwi", "fresas"])}, kiwi).findings[0].ingredient, "kiwi");
});

test("automatic proposals: blocked on certain conflicts and on possible allergy conflicts; dislikes apart", () => {
 const block = (title, value) => blocksAutomaticProposal(checkDish({title, card: null}, profile(value)));
 assert.equal(block("Espaguetis carbonara", {dietaryRestrictions: ["no_pork"]}), true);
 assert.equal(block("Albóndigas en salsa", {dietaryRestrictions: ["no_pork"]}), false, "possible pork: a warning, not a block");
 assert.equal(block("Pollo con salsa satay", {allergies: ["nuts"]}), true, "possible allergen: blocked");
 assert.equal(block("Tostadas de aguacate", {allergies: ["gluten"]}), true);
 assert.equal(block("Coliflor gratinada", {dislikedFoods: ["coliflor"]}), false);
 assert.equal(mentionsDislikedFood(checkDish({title: "Coliflor gratinada", card: null}, profile({dislikedFoods: ["coliflor"]}))), true);
 assert.equal(mentionsDislikedFood(checkDish({title: "Arroz con gambas", card: null}, profile({dislikedFoods: ["marisco"]}))), true);
});

test("replacement checks use the lexicon: free-text allergies are a restriction, dislikes stay «disliked_food»", () => {
 const request = {day: "Lunes", meal: "lunch", currentDish: "Lentejas estofadas", otherDishes: [], rejected: []};
 assert.equal(checkReplacement("Pollo al sésamo", request, profile({allergies: ["other"], otherAllergies: "sésamo"})), "restriction_conflict");
 assert.equal(checkReplacement("Espaguetis carbonara", request, profile({dietaryRestrictions: ["no_pork"]})), "restriction_conflict");
 assert.equal(checkReplacement("Arroz con gambas", request, profile({dislikedFoods: ["marisco"]})), "disliked_food");
 assert.equal(checkReplacement("Crema de calabaza con nuez moscada", request, profile({allergies: ["nuts"]})), null);
 // A reviewed card of the catalogue is checked by its ingredients.
 const reviewedPesto = card(["espaguetis", "albahaca", "piñones", "parmesano"], ["gluten", "milk", "nuts"], "reviewed");
 assert.equal(checkReplacement("Pasta a la genovesa", request, profile({allergies: ["nuts"]}), reviewedPesto), "restriction_conflict");
 assert.equal(checkReplacement("Pasta a la genovesa", request, profile({allergies: ["nuts"]}), {...reviewedPesto, reviewStatus: "inferred"}), null, "only reviewed cards decide automatic ideas");
});

test("review 1: free-text wheat, barley, rye, spelt and wheat flour mean all gluten", () => {
 for (const word of ["trigo", "cebada", "centeno", "espelta", "harina de trigo", "alergia al trigo"]) {
  assert.deepEqual(resolveFreeText(word), {type: "groups", groups: ["gluten"], term: normalizeFood(word).replace(/^alergia al /, "")}, word);
  assert.equal(checkDish({title: "Pan con tomate", card: null}, profile({allergies: ["other"], otherAllergies: word})).status, "conflict", word);
 }
 assert.equal(checkDish({title: "Espaguetis con setas", card: card(["espaguetis", "setas"])}, profile({allergies: ["other"], otherAllergies: "trigo"})).status, "conflict");
 assert.ok(!analyzeFoodText("Pan sin trigo").mentions[0].negated.includes("gluten"), "«sin trigo» does not make bread gluten-free");
});

test("review 2: «sin X» cancels only the term it qualifies, never other terms of the group", () => {
 assert.equal(checkDish({title: "Crema sin leche con mantequilla", card: null}, profile({allergies: ["lactose"]})).status, "conflict");
 assert.equal(checkDish({title: "Arroz sin marisco con gambas", card: null}, profile({allergies: ["shellfish"]})).status, "conflict");
 assert.equal(checkDish({title: "Ensalada sin huevo con mayonesa", card: null}, profile({allergies: ["egg"]})).status, "conflict");
 assert.equal(checkDish({title: "Pasta sin huevo a la carbonara", card: null}, profile({allergies: ["egg"]})).status, "conflict");
 assert.equal(checkDish({title: "Pan sin gluten con queso", card: null}, profile({allergies: ["gluten"]})).status, "unverifiable", "the bread is gluten-free");
 assert.equal(checkDish({title: "Pan sin gluten con queso", card: null}, profile({allergies: ["lactose"]})).status, "conflict");
 assert.equal(checkDish({title: "Bizcocho de chocolate sin huevo", card: null}, profile({allergies: ["egg"]})).status, "unverifiable");
 assert.equal(checkDish({title: "Pizza sin queso", card: card(["masa de pizza sin gluten", "tomate"])}, profile({allergies: ["gluten"]})).status, "conflict", "the title still says pizza");
});

test("review 3: dishes whose name implies the ingredients", () => {
 const expect = [
  ["Arroz negro", "molluscs"], ["Fideuá", "gluten"], ["Fideuá", "crustaceans?"], ["Paella valenciana", "meat?"], ["Paella", "crustaceans?"],
  ["Zarzuela de pescado", "fish"], ["Mariscada", "crustaceans"], ["Salpicón", "molluscs?"], ["Calamares a la romana", "gluten"], ["Calamares a la romana", "egg?"],
  ["Bocadillo de tortilla", "gluten"], ["Bocata de calamares", "gluten"], ["Sándwich mixto", "gluten"], ["Montaditos", "gluten"], ["Croissant", "gluten"],
  ["Cruasán", "gluten"], ["Brownie", "gluten"], ["Churros", "gluten"], ["Buñuelos", "gluten"], ["Gofres", "gluten"], ["Tortitas", "gluten"],
  ["Burrito", "gluten"], ["Ramen", "gluten"], ["Gnocchi", "gluten"], ["Ñoquis", "gluten"], ["Couscous", "gluten"], ["Tiramisú", "gluten"],
  ["Tiramisú", "egg"], ["Tiramisú", "dairy"], ["Ensaladilla rusa", "egg"], ["Sushi", "fish"], ["Ceviche", "fish"], ["Caviar", "fish"],
  ["Ternasco asado", "meat"], ["Pad thai", "peanuts?"],
 ];
 for (const [text, group] of expect) assert.ok(groups(text).includes(group), `${text} → ${group}: ${groups(text)}`);
 assert.ok(!has("Lechuga romana", "gluten"));
});

test("review 4: in automatic proposals «sin gluten» / «apto para celíacos» only lowers to possible", () => {
 const gluten = profile({allergies: ["gluten"]});
 for (const title of ["Pizza sin gluten", "Pan apto para celíacos"]) {
  const shown = checkDish({title, card: null}, gluten);
  assert.equal(shown.findings.length, 0, title);
  const automatic = checkDish({title, card: null}, gluten, {automatic: true});
  assert.equal(automatic.status, "possible_conflict", title);
  assert.equal(blocksAutomaticProposal(automatic), true, "an allergy possible blocks");
  assert.equal(visibleFoodConflict(title, gluten), true, title);
 }
});

test("review 5: «tostada» as an adjective is not bread; flour and oats stay possible", () => {
 assert.deepEqual(groups("Almendras tostadas"), ["nuts"]);
 assert.deepEqual(groups("Harina tostada"), ["gluten?"]);
 assert.deepEqual(groups("Avena"), ["gluten?"]);
 assert.ok(has("Tostadas de aguacate", "gluten"));
 assert.ok(has("Aguacate con tostadas", "gluten"));
});

test("ola 6: «cocido» as an adjective is not the stew («garbanzos cocidos» is vegetarian)", () => {
 assert.deepEqual(groups("Garbanzos cocidos"), []);
 assert.deepEqual(groups("Huevo cocido"), ["egg"]);
 assert.ok(has("Cocido madrileño", "meat"));
 assert.ok(has("Sopa de cocido", "pork"));
 assert.ok(has("Garbanzos del cocido", "meat"));
 assert.notEqual(checkDish({title: "Garbanzos con espinacas", card: card(["Garbanzos cocidos", "Espinacas"])}, profile({dietaryRestrictions: ["vegetarian"]})).status, "conflict");
});

test("review 6: quail and hen eggs are only egg; pepper flesh and tomato paste have no group", () => {
 for (const text of ["Huevos de codorniz", "Huevo de gallina", "Huevos de pato", "Huevo de oca"]) assert.deepEqual(groups(text), ["egg"], text);
 assert.deepEqual(groups("Carne de pimiento choricero"), []);
 assert.deepEqual(groups("Carne de pimiento"), []);
 for (const text of ["Pasta de tomate", "Pasta de pimiento", "Pasta de ajo"]) assert.deepEqual(groups(text), [], text);
 assert.equal(checkDish({title: "Ensalada con huevos de codorniz", card: null}, profile({dietaryRestrictions: ["vegetarian"]})).status, "unverifiable");
});

test("review 7: «ninguna», «nada», «n/a», «-» are an empty field", () => {
 for (const text of ["ninguna", "Ninguno", "nada", "No", "n/a", "N/A", "-", "  "]) {
  assert.deepEqual(compileRestrictions(profile({allergies: ["other"], otherAllergies: text})), {compiled: [], uninterpretable: ["Otra alergia sin especificar"]}, text);
  assert.equal(hasFoodRestrictions(profile({otherAllergies: text, dislikedFoods: [text].filter((t) => t.trim())})), false, text);
 }
 assert.deepEqual(compileRestrictions(profile({otherAllergies: "kiwi, ninguna"})).compiled.map((c) => c.restriction.label), ["kiwi"]);
 assert.equal(compileRestrictions(profile({allergies: ["other"], otherAllergies: "Alergia a las fresas"})).compiled[0].restriction.label, "fresas");
});
