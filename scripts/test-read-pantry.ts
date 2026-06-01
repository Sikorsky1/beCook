import dotenv from "dotenv";

dotenv.config({ path: ".env.local" });

async function main() {
  const { getLatestPantryItemsFromSupabase } = await import(
    "../src/lib/supabase/pantry"
  );
  const pantryItems = await getLatestPantryItemsFromSupabase();

  console.log("Pantry items from Supabase:");
  console.log(JSON.stringify(pantryItems, null, 2));
}

main().catch((error: unknown) => {
  console.error(
    "Could not read pantry items:",
    error instanceof Error ? error.message : error,
  );
  process.exitCode = 1;
});
