// Warnings on the dishes of an imported menu (C6, roadmap step 22). The user chose these dishes, so
// nothing is ever changed or blocked: the preview only says what the restriction check (C3) finds in
// the dish name and whether the name leaves a sauce or garnish open (culinary rules, C5).
import { culinaryIssue } from "@/lib/menu-generation/culinary-rules";
import { readMenuProfile } from "@/lib/menu-generation/prompt";
import { dishCompatibilityView } from "@/lib/recipes/dishCardFlow";
import type { RestrictionProfile } from "@/lib/recipes/restriction-check";

export type ImportedDishWarning = { tone: "danger" | "warning"; text: string };

const culinaryTexts = {
  unspecified_sauce: "El nombre no dice qué salsa lleva: no podemos saber sus ingredientes.",
  vague_qualifier: "El nombre deja algo sin concretar («especial», «de la casa»…): no podemos saber sus ingredientes.",
} as const;

// The profile the preview checks against, or null if there is none or it cannot be read (then only
// the culinary rules apply; a malformed profile is never read as «no restrictions»).
export function importWarningProfile(profile: unknown): RestrictionProfile | null {
  if (profile === null || profile === undefined) return null;
  try {
    return readMenuProfile(profile);
  } catch {
    return null;
  }
}

export function importedDishWarnings(title: string, profile: RestrictionProfile | null): ImportedDishWarning[] {
  const dish = title.trim();
  if (!dish || dish === "LIBRE") return [];
  const warnings: ImportedDishWarning[] = [];

  if (profile) {
    const view = dishCompatibilityView(dish, null, { state: "ready", profile });
    // Only what was found in the name: «No podemos comprobarlo» on every dish would be noise (the
    // dish card says it when opened).
    if (view.tone !== "neutral" && view.lines.length) {
      warnings.push({
        tone: view.tone === "danger" ? "danger" : "warning",
        text: `${view.heading}. ${view.lines.join(" ")} ${view.basis ?? ""}`.trim(),
      });
    }
  }

  const issue = culinaryIssue(dish);
  if (issue) warnings.push({ tone: "warning", text: culinaryTexts[issue] });

  return warnings;
}
