import dotenv from "dotenv";

dotenv.config({ path: ".env.local" });

async function main() {
  const { savePantryItemsToSupabase } = await import(
    "../src/lib/supabase/pantry"
  );
  const testItems = [
    {
      name: "Arroz",
      category: "básicos",
      active: true,
    },
    {
      name: "Pimienta negra",
      category: "especias",
      active: true,
    },
    {
      name: "Aceite de oliva",
      category: "básicos",
      active: true,
    },
    {
      name: "Salsa de soja",
      category: "salsas",
      active: false,
    },
  ] satisfies Parameters<typeof savePantryItemsToSupabase>[0];

  const pantryItemIds = await savePantryItemsToSupabase(testItems);

  console.log("Saved test pantry items:");
  console.log({ pantryItemIds });
}

main().catch((error: unknown) => {
  console.error(
    "Could not save test pantry items:",
    error instanceof Error ? error.message : error,
  );
  process.exitCode = 1;
});
