import dotenv from "dotenv";

dotenv.config({ path: ".env.local" });

async function getLatestWeekId() {
  const { getLatestWeekFromSupabase } = await import(
    "../src/lib/supabase/weeks"
  );
  const { supabase } = await import("../src/lib/supabase/client");
  const latestWeek = await getLatestWeekFromSupabase();

  if (!latestWeek) {
    throw new Error("No weeks found in Supabase. Save a week before testing.");
  }

  if (!supabase) {
    throw new Error("Supabase client is not configured after loading .env.local.");
  }

  const { data: latestWeekRow, error: latestWeekError } = await supabase
    .from("weeks")
    .select("id")
    .order("created_at", { ascending: false })
    .limit(1)
    .single();

  if (latestWeekError) {
    throw new Error(`Could not read latest week id: ${latestWeekError.message}`);
  }

  if (!latestWeekRow?.id) {
    throw new Error("Could not read latest week id: Supabase returned no id.");
  }

  return latestWeekRow.id as string;
}

async function main() {
  const { saveShoppingListToSupabase } = await import(
    "../src/lib/supabase/shopping-lists"
  );
  const weekId = await getLatestWeekId();
  const testItems = [
    {
      name: "Manzanas",
      quantity: 6,
      unit: "uds",
      category: "frutería",
      checked: false,
    },
    {
      name: "Pechuga de pollo",
      quantity: 800,
      unit: "g",
      category: "carnicería",
      checked: false,
    },
    {
      name: "Merluza",
      quantity: 500,
      unit: "g",
      category: "pescadería",
      checked: true,
    },
    {
      name: "Arroz integral",
      quantity: 1,
      unit: "kg",
      category: "despensa",
      checked: false,
    },
  ] satisfies Parameters<typeof saveShoppingListToSupabase>[1];

  const shoppingListId = await saveShoppingListToSupabase(weekId, testItems);

  console.log("Saved test shopping list:");
  console.log({ weekId, shoppingListId, items: testItems.length });
}

main().catch((error: unknown) => {
  console.error(
    "Could not save test shopping list:",
    error instanceof Error ? error.message : error,
  );
  process.exitCode = 1;
});
