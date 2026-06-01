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
  const { getLatestShoppingListForWeekFromSupabase } = await import(
    "../src/lib/supabase/shopping-lists"
  );
  const weekId = await getLatestWeekId();
  const latestShoppingList = await getLatestShoppingListForWeekFromSupabase(
    weekId,
  );

  if (!latestShoppingList) {
    console.log(`No shopping lists found in Supabase for week ${weekId}.`);
    return;
  }

  console.log("Latest shopping list from Supabase:");
  console.log(JSON.stringify(latestShoppingList, null, 2));
}

main().catch((error: unknown) => {
  console.error(
    "Could not read latest shopping list:",
    error instanceof Error ? error.message : error,
  );
  process.exitCode = 1;
});
