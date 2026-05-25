import dotenv from "dotenv";

dotenv.config({ path: ".env.local" });

async function main() {
  const { getLatestWeekFromSupabase } = await import("../src/lib/supabase/weeks");

  const latestWeek = await getLatestWeekFromSupabase();

  if (!latestWeek) {
    console.log("No weeks found in Supabase.");
    return;
  }

  console.log("Latest week from Supabase:");
  console.log(JSON.stringify(latestWeek, null, 2));
}

main().catch((error: unknown) => {
  console.error(
    "Could not read latest week:",
    error instanceof Error ? error.message : error,
  );
  process.exitCode = 1;
});
