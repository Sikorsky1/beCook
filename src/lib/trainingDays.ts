// The days of the week the user trains (Perfil → Entrenamiento), 1 = Monday … 7 = Sunday (ISO).
// Stored in profiles.training_weekdays; profiles.weekly_training_days keeps their count. A profile
// saved when only the count was asked has no days yet: it reads as a spread of that many days
// (defaultTrainingWeekdays) until the user marks their own.
// Crear menú puts the starchy dishes (pasta, rice, potato…) on those days and lighter ones on the
// rest (menu-generation/carbs.ts).

export type TrainingWeekday = 1 | 2 | 3 | 4 | 5 | 6 | 7;

export const trainingWeekdays: { value: TrainingWeekday; initial: string; name: string }[] = [
  { value: 1, initial: "L", name: "Lunes" },
  { value: 2, initial: "M", name: "Martes" },
  { value: 3, initial: "X", name: "Miércoles" },
  { value: 4, initial: "J", name: "Jueves" },
  { value: 5, initial: "V", name: "Viernes" },
  { value: 6, initial: "S", name: "Sábado" },
  { value: 7, initial: "D", name: "Domingo" },
];

// Days with rest in between where possible: 3 → L X V, 4 → L M J V.
const spreads: Record<number, TrainingWeekday[]> = {
  0: [],
  1: [3],
  2: [2, 4],
  3: [1, 3, 5],
  4: [1, 2, 4, 5],
  5: [1, 2, 3, 4, 5],
  6: [1, 2, 3, 4, 5, 6],
  7: [1, 2, 3, 4, 5, 6, 7],
};

export function defaultTrainingWeekdays(count: number): TrainingWeekday[] {
  const days = Number.isInteger(count) ? Math.max(0, Math.min(7, count)) : 0;
  return [...spreads[days]];
}

// Sorted, without repeats; null when the value is not a list (unknown: use the count).
export function normalizeTrainingWeekdays(value: unknown): TrainingWeekday[] | null {
  if (!Array.isArray(value)) return null;
  const days = value.filter((day): day is TrainingWeekday => Number.isInteger(day) && day >= 1 && day <= 7);
  return [...new Set(days)].sort((a, b) => a - b);
}

export function isValidTrainingWeekdays(value: unknown) {
  return (
    Array.isArray(value) &&
    value.every((day) => Number.isInteger(day) && day >= 1 && day <= 7) &&
    new Set(value).size === value.length
  );
}

// The days of a profile: the marked ones, else the spread of its count.
export function trainingWeekdaysOf(profile: { trainingWeekdays?: unknown; weeklyTrainingDays?: unknown }): TrainingWeekday[] {
  return (
    normalizeTrainingWeekdays(profile.trainingWeekdays) ??
    defaultTrainingWeekdays(typeof profile.weeklyTrainingDays === "number" ? profile.weeklyTrainingDays : 0)
  );
}
