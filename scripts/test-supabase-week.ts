import { supabase } from "../src/lib/supabase/client";

const testTitle = "Test week from beCook";

async function main() {
  if (!supabase) {
    console.error(
      "Supabase client is not configured. Check NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY in .env.local.",
    );
    process.exitCode = 1;
    return;
  }

  const { data: insertedWeek, error: insertError } = await supabase
    .from("weeks")
    .insert({ title: testTitle })
    .select("id,title,created_at")
    .single();

  if (insertError) {
    console.error("Could not insert test week:", insertError.message);
    process.exitCode = 1;
    return;
  }

  console.log("Inserted test week:");
  console.log(insertedWeek);

  const { data: latestWeeks, error: readError } = await supabase
    .from("weeks")
    .select("id,title,created_at")
    .order("created_at", { ascending: false })
    .limit(5);

  if (readError) {
    console.error("Could not read weeks:", readError.message);
    process.exitCode = 1;
    return;
  }

  console.log("Latest weeks:");
  console.log(latestWeeks);
}

main().catch((error: unknown) => {
  console.error(
    "Unexpected Supabase test error:",
    error instanceof Error ? error.message : error,
  );
  process.exitCode = 1;
});
