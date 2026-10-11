export type MealSlot = "LIBRE" | string;
export type MealKey = "lunch" | "dinner";

// C2: the dish card a planned meal points to (an immutable recipe version). Absent: no card,
// only the title is known (menus before C2, free meals, or a title edited after linking).
export type WeekRecipeLink = { versionId: string };

export type WeekDay = {
  day: string;
  date: string;
  lunch: MealSlot;
  dinner: MealSlot;
  lunchRecipe?: WeekRecipeLink;
  dinnerRecipe?: WeekRecipeLink;
};

export type MockWeek = {
  dateRange: string;
  days: WeekDay[];
};

export const mockWeek: MockWeek = {
  dateRange: "31 de marzo al 6 de abril",
  days: [
    {
      day: "Lunes",
      date: "31 mar",
      lunch: "Salmón con calabacín",
      dinner: "LIBRE",
    },
    {
      day: "Martes",
      date: "1 abr",
      lunch: "Pollo con arroz y brócoli",
      dinner: "Tortilla francesa con tomate",
    },
    {
      day: "Miércoles",
      date: "2 abr",
      lunch: "Lentejas estofadas con verduras",
      dinner: "Crema de calabaza y tostadas",
    },
    {
      day: "Jueves",
      date: "3 abr",
      lunch: "Pasta integral con atún y espinacas",
      dinner: "LIBRE",
    },
    {
      day: "Viernes",
      date: "4 abr",
      lunch: "Albóndigas con puré de patata",
      dinner: "Ensalada césar con pollo",
    },
    {
      day: "Sábado",
      date: "5 abr",
      lunch: "Arroz salteado con verduras y gambas",
      dinner: "Pizza casera de verduras",
    },
    {
      day: "Domingo",
      date: "6 abr",
      lunch: "Paella de pollo y verduras",
      dinner: "Sopa ligera con huevo cocido",
    },
  ],
};
