import dotenv from "dotenv";
import type { SupabaseWeek } from "../src/lib/supabase/weeks";

dotenv.config({ path: ".env.local" });

const testWeek: SupabaseWeek = {
  title: "Test full week from beCook",
  days: [
    {
      dayName: "Lunes",
      lunch: { status: "planned", dishName: "Salmón con calabacín" },
      dinner: { status: "free", dishName: "Esto no se guarda" },
    },
    {
      dayName: "Martes",
      lunch: { status: "planned", dishName: "Pollo con arroz" },
      dinner: { status: "planned", dishName: "Tortilla francesa" },
    },
    {
      dayName: "Miércoles",
      lunch: { status: "planned", dishName: "Lentejas estofadas" },
      dinner: { status: "planned", dishName: "Crema de calabaza" },
    },
    {
      dayName: "Jueves",
      lunch: { status: "planned", dishName: "Pasta integral con atún" },
      dinner: { status: "free", dishName: "" },
    },
    {
      dayName: "Viernes",
      lunch: { status: "planned", dishName: "Albóndigas con puré" },
      dinner: { status: "planned", dishName: "Ensalada césar" },
    },
    {
      dayName: "Sábado",
      lunch: { status: "planned", dishName: "Arroz salteado" },
      dinner: { status: "planned", dishName: "Pizza casera" },
    },
    {
      dayName: "Domingo",
      lunch: { status: "planned", dishName: "Paella de pollo" },
      dinner: { status: "planned", dishName: "Sopa ligera" },
    },
  ],
};

async function main() {
  console.log("SUPABASE URL loaded:", Boolean(process.env.NEXT_PUBLIC_SUPABASE_URL));
  console.log(
    "SUPABASE KEY loaded:",
    Boolean(process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY),
  );

  const { saveWeekToSupabase } = await import("../src/lib/supabase/weeks");
  const { supabase } = await import("../src/lib/supabase/client");
  const weekId = await saveWeekToSupabase(testWeek);

  if (!supabase) {
    throw new Error("Supabase client is not configured after loading .env.local.");
  }

  const { count: savedDaysCount, error: savedDaysError } = await supabase
    .from("week_days")
    .select("id", { count: "exact", head: true })
    .eq("week_id", weekId);

  if (savedDaysError) {
    throw new Error(`Could not verify saved week days: ${savedDaysError.message}`);
  }

  if (savedDaysCount !== testWeek.days.length) {
    throw new Error(
      `Expected ${testWeek.days.length} saved days, but found ${savedDaysCount ?? 0}.`,
    );
  }

  console.log("Saved full test week:");
  console.log({ weekId, days: savedDaysCount });
}

main().catch((error: unknown) => {
  console.error(
    "Could not save full test week:",
    error instanceof Error ? error.message : error,
  );
  process.exitCode = 1;
});
