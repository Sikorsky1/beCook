import { createClient } from "@supabase/supabase-js";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const shouldLogSupabaseConfig =
  process.env.NODE_ENV === "development" ||
  process.argv?.some((arg) => arg.includes("test-save-week")) === true;

if (shouldLogSupabaseConfig) {
  console.log("Supabase client URL loaded:", Boolean(supabaseUrl));
  console.log("Supabase client KEY loaded:", Boolean(supabaseAnonKey));
}

if (process.env.NODE_ENV === "development" && (!supabaseUrl || !supabaseAnonKey)) {
  console.warn(
    "Supabase client is not configured. Set NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY in .env.local.",
  );
}

export const supabase =
  supabaseUrl && supabaseAnonKey
    ? createClient(supabaseUrl, supabaseAnonKey)
    : null;
