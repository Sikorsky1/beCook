import { normalizeFood } from "./validation";

// Culinary rules (step 21): a title must name a recognisable dish. A sauce, dressing or
// garnish whose composition the title leaves open («salsa especial», «pollo con salsa»)
// is rejected; concrete ones («salsa de tomate», «salsa verde», «al pesto») are fine.
// Rules only reject: a title is never «fixed» by inventing ingredients.

export type CulinaryIssue = "vague_qualifier" | "unspecified_sauce";

// Words that make any element of the dish indeterminate.
const vagueQualifier =
  /\b(especial(es)?|secret[oa]s?|sorpresa|al gusto|a elegir|a tu gusto|de la casa|del chef|de la abuela|favorit[oa]s?|personalizad[oa]s?|misterios[oa]s?|magic[oa]s?|de siempre|lo que (haya|tengas))\b/;

// Elements whose composition must be stated when they appear in the title.
const openElement = /\b(salsas?|alino|aderezo|marinada|adobo|guarnicion|acompanamiento|relleno|toppings?)\b/;

// Concrete sauces named by adjective or proper name, not by «de …».
const namedSauce =
  /\bsalsas? (verde|brava|bravas|romesco|vizcaina|pesto|teriyaki|bechamel|holandesa|barbacoa|bbq|alioli|tartara|rosa|carbonara|bolonesa|marinera|americana|espanola|agridulce|chimichurri|tzatziki|tahini|curry|pico de gallo|mojo|mojo picon|mojo verde|mojo rojo|ponzu|hoisin|sriracha|kimchi|satay|gribiche|bearnesa|pizzaiola|puttanesca|arrabbiata|napolitana|cesar|ranchera|criolla|picante de tomate)\b/;

// «salsa de/al/a la X», «salsa con X»: the sauce is specified by what follows.
const specifiedSauce = /\bsalsas? (de|del|al|a la|a las|con) [a-z]/;

// Traditional dishes whose name already fixes the sauce.
const traditionalSauceDishes = /\b(albondigas en salsa|pollo en pepitoria|callos|bacalao al pil ?pil|merluza en salsa verde|chipirones en su tinta|calamares en su tinta)\b/;

function sauceIsUnspecified(text: string) {
  if (traditionalSauceDishes.test(text)) return false;
  // Every «salsa …» occurrence must be concrete.
  return text.split(/\b(?=salsas?\b)/).slice(1).some((part) => !namedSauce.test(part) && !specifiedSauce.test(part));
}

export function culinaryIssue(dishName: string): CulinaryIssue | null {
  const text = normalizeFood(dishName);
  if (openElement.test(text) && vagueQualifier.test(text)) return "vague_qualifier";
  if (/\b(ingrediente|toque) (secreto|especial|sorpresa)\b/.test(text)) return "vague_qualifier";
  if (sauceIsUnspecified(text)) return "unspecified_sauce";
  return null;
}

export function isCulinarilyDetermined(dishName: string) {
  return culinaryIssue(dishName) === null;
}
