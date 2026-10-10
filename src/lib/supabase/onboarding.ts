import type { SupabaseClient } from "@supabase/supabase-js";

import type { OnboardingAccount, OnboardingProgress, OnboardingStep } from "@/lib/onboarding";

import { supabase } from "./client";
import { normalizeConfirmations } from "./profiles";

const steps = new Set<OnboardingStep>(["about", "profile", "pantry", "done"]);

function requireClient(client: SupabaseClient | null) {
  if (!client) {
    throw new Error(
      "Supabase client is not configured. Check NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY in .env.local.",
    );
  }

  return client;
}

function parseProgress(value: unknown): OnboardingProgress | null {
  const row = value as { step?: unknown; completed_at?: unknown } | null;

  if (!row || !steps.has(row.step as OnboardingStep)) {
    return null;
  }

  return {
    step: row.step as OnboardingStep,
    completedAt: typeof row.completed_at === "string" ? row.completed_at : null,
  };
}

// What the onboarding needs to know about the signed-in account (RLS limits it to the caller).
export async function getOnboardingAccount(
  userId: string,
  client: SupabaseClient | null = supabase,
): Promise<OnboardingAccount> {
  const db = requireClient(client);
  const [progress, profile, week] = await Promise.all([
    db.from("onboarding_progress").select("step,completed_at").eq("user_id", userId).maybeSingle(),
    db
      .from("profiles")
      .select("id,confirmed_sections")
      .eq("user_id", userId)
      .order("updated_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
    db.from("weeks").select("id").eq("user_id", userId).limit(1),
  ]);
  const error = progress.error ?? profile.error ?? week.error;

  if (error) {
    throw new Error(`Could not read onboarding state: ${error.message}`);
  }

  return {
    progress: parseProgress(progress.data),
    hasProfile: Boolean(profile.data),
    confirmedSections: normalizeConfirmations(
      (profile.data as { confirmed_sections?: unknown } | null)?.confirmed_sections,
    ),
    hasWeeks: (week.data ?? []).length > 0,
  };
}

// Moves the account forward to step (never back); returns the step the account is on.
export async function advanceOnboarding(
  step: OnboardingStep,
  client: SupabaseClient | null = supabase,
): Promise<OnboardingProgress> {
  const { data, error } = await requireClient(client).rpc("advance_onboarding", { p_step: step });

  if (error) {
    throw new Error(`Could not save onboarding progress: ${error.message}`);
  }

  const progress = parseProgress(data);

  if (!progress) {
    throw new Error("Could not save onboarding progress: unexpected answer.");
  }

  return progress;
}
