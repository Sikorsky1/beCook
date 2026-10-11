import type { MealKey, MealSlot, WeekDay, WeekRecipeLink } from "@/data/mockWeek";
import { getDayPosition, getIsoWeekDay, type IsoWeek } from "@/lib/isoWeek";
import type { SupabaseMealSlot, SupabaseWeek } from "@/lib/supabase/weeks";

// Pure week helpers. Persistence lives in @/lib/data/repositories (scoped by identity).

// Each day is dated by its name inside the ISO week, never by its index: a partial week
// (only Wednesday, or skipped days) keeps the real dates. Days are returned Monday→Sunday.
export function withWeekDates(weekDays: WeekDay[], isoWeek: IsoWeek) {
  const order = (day: WeekDay) => {
    const position = getDayPosition(day.day);
    return position === -1 ? Number.MAX_SAFE_INTEGER : position;
  };

  return [...weekDays]
    .sort((left, right) => order(left) - order(right))
    .map((day) => ({
      ...day,
      date: getIsoWeekDay(isoWeek, day.day)?.label ?? "",
    }));
}

export function mealSlotToSupabase(slot: MealSlot) {
  if (slot === "LIBRE") {
    return {
      status: "free" as const,
      dishName: "",
    };
  }

  return {
    status: "planned" as const,
    dishName: slot,
  };
}

export const recipeLinkKey = { lunch: "lunchRecipe", dinner: "dinnerRecipe" } as const satisfies Record<MealKey, keyof WeekDay>;

// C2: the card link of one meal, only while the meal is planned.
export function mealRecipeLink(day: WeekDay, meal: MealKey): WeekRecipeLink | null {
  const link = day[recipeLinkKey[meal]];
  return day[meal] !== "LIBRE" && link?.versionId ? link : null;
}

// One meal of one day with a new card link (null removes it). The title does not change.
export function withMealRecipe(weekDays: WeekDay[], dayName: string, meal: MealKey, link: WeekRecipeLink | null): WeekDay[] {
  return weekDays.map((day) => {
    if (day.day !== dayName) return day;
    const next = { ...day };
    if (link) next[recipeLinkKey[meal]] = link;
    else delete next[recipeLinkKey[meal]];
    return next;
  });
}

// What a whole-week write sends for one meal (C2). A free meal: null (no card). A planned meal with
// a link: that version. A planned meal without a link: undefined, so apply_week keeps whatever the
// account has (safest: a device copy from before C2, or one read before a card was linked on
// another device, never drops a card). A card is only removed by a title change, a free meal or
// update_week_slot_recipe with null; the database never leaves it on another dish.
function recipeLinkToSend(day: WeekDay, meal: MealKey): string | null | undefined {
  if (day[meal] === "LIBRE") return null;
  return mealRecipeLink(day, meal)?.versionId;
}

export function weekDaysToSupabaseWeek(weekDays: WeekDay[]): SupabaseWeek {
  return {
    days: weekDays.map((day) => ({
      dayName: day.day,
      lunch: { ...mealSlotToSupabase(day.lunch), recipeVersionId: recipeLinkToSend(day, "lunch") },
      dinner: { ...mealSlotToSupabase(day.dinner), recipeVersionId: recipeLinkToSend(day, "dinner") },
    })),
  };
}

function supabaseMealSlotToWeekMeal(slot: SupabaseMealSlot) {
  return slot.status === "free" ? "LIBRE" : slot.dishName;
}

function supabaseRecipeLink(slot: SupabaseMealSlot): WeekRecipeLink | undefined {
  return slot.status === "planned" && slot.recipeVersionId ? { versionId: slot.recipeVersionId } : undefined;
}

export function supabaseWeekToWeekDays(week: SupabaseWeek, isoWeek: IsoWeek): WeekDay[] {
  return withWeekDates(
    week.days.map((day) => {
      const lunchRecipe = supabaseRecipeLink(day.lunch);
      const dinnerRecipe = supabaseRecipeLink(day.dinner);
      return {
        day: day.dayName,
        date: "",
        lunch: supabaseMealSlotToWeekMeal(day.lunch),
        dinner: supabaseMealSlotToWeekMeal(day.dinner),
        ...(lunchRecipe ? { lunchRecipe } : {}),
        ...(dinnerRecipe ? { dinnerRecipe } : {}),
      };
    }),
    isoWeek,
  );
}
