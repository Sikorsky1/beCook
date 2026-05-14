import type { WeekDay } from "@/data/mockWeek";

export const mockImportedWeekInput = `LUNES
Comida: Pasta con verduras (*)
Cena: Libre

MARTES
Comida: Pollo al horno con patatas
Cena: Ensalada de garbanzos

MIERCOLES
Comida: Arroz con salmón
Cena: Tortilla de calabacín

JUEVES
Comida: Libre
Cena: Crema de verduras

VIERNES	Albóndigas con tomate	Pizza casera
SABADO	Paella de pollo	Libre
DOMINGO	Lasaña de verduras	Sopa y tostadas`;

export const mockImportedWeekPreview: WeekDay[] = [
  {
    day: "Lunes",
    date: "31 mar",
    lunch: "Pasta con verduras (*)",
    dinner: "LIBRE",
  },
  {
    day: "Martes",
    date: "1 abr",
    lunch: "Pollo al horno con patatas",
    dinner: "Ensalada de garbanzos",
  },
  {
    day: "Miércoles",
    date: "2 abr",
    lunch: "Arroz con salmón",
    dinner: "Tortilla de calabacín",
  },
  {
    day: "Jueves",
    date: "3 abr",
    lunch: "LIBRE",
    dinner: "Crema de verduras",
  },
  {
    day: "Viernes",
    date: "4 abr",
    lunch: "Albóndigas con tomate",
    dinner: "Pizza casera",
  },
  {
    day: "Sábado",
    date: "5 abr",
    lunch: "Paella de pollo",
    dinner: "LIBRE",
  },
  {
    day: "Domingo",
    date: "6 abr",
    lunch: "Lasaña de verduras",
    dinner: "Sopa y tostadas",
  },
];
