import { trainingWeekdaysOf } from "@/lib/trainingDays";
import type { MenuProfile } from "./validation";

// The profile and list fields of a menu request, validated (from prompt.ts). Kept apart so the
// browser can read a profile without loading the catalogue modules of the menu generator.

export function stringList(value: unknown, max = 40, length = 100): string[] {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.filter((v): v is string => typeof v === "string").map(v => v.trim().replace(/\s+/g, " ").slice(0, length)).filter(Boolean))].slice(0, max);
}

export function shortText(value: unknown, length = 300) {
  return typeof value === "string" ? value.trim().slice(0, length) : "";
}

export function readMenuProfile(value: unknown): MenuProfile {
  const profile = value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
  // Never silently drop malformed or oversized safety constraints.
  for (const key of ["allergies", "dietaryRestrictions"]) {
    const list = profile[key];
    if (list !== undefined && (!Array.isArray(list) || list.length > 40 || list.some(v => typeof v !== "string" || v.length > 100))) throw new Error("invalid_profile");
  }
  if (profile.otherAllergies !== undefined && (typeof profile.otherAllergies !== "string" || profile.otherAllergies.length > 1000)) throw new Error("invalid_profile");
  return {
    dietaryRestrictions: stringList(profile.dietaryRestrictions),
    allergies: stringList(profile.allergies),
    otherAllergies: shortText(profile.otherAllergies, 1000),
    dislikedFoods: stringList(profile.dislikedFoods),
    goals: stringList(profile.goals ?? (profile.goal ? [profile.goal] : [])),
    otherGoal: shortText(profile.otherGoal),
    weeklyTrainingDays: typeof profile.weeklyTrainingDays === "number" ? Math.max(0, Math.min(7, profile.weeklyTrainingDays)) : 0,
    trainingWeekdays: trainingWeekdaysOf(profile),
    trainingTypes: stringList(profile.trainingTypes, 12),
  };
}

