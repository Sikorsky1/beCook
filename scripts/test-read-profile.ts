import dotenv from "dotenv";

dotenv.config({ path: ".env.local" });

async function main() {
  const { getLatestProfileFromSupabase } = await import(
    "../src/lib/supabase/profiles"
  );

  const latestProfile = await getLatestProfileFromSupabase();

  if (!latestProfile) {
    console.log("No profiles found in Supabase.");
    return;
  }

  console.log("Latest profile from Supabase:");
  console.log(JSON.stringify(latestProfile, null, 2));
}

main().catch((error: unknown) => {
  console.error(
    "Could not read latest profile:",
    error instanceof Error ? error.message : error,
  );
  process.exitCode = 1;
});
