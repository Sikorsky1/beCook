import { supabase } from "./client";

import type { OpenAIMenuGenerationTelemetry } from "@/lib/importMenu";

export type MenuGenerationRequestStatus =
  | "generating"
  | "generated"
  | "failed"
  | "applied";

type CreateMenuGenerationRequestInput = {
  profileId?: string | null;
  userId?: string | null;
  peopleCount: number;
  menuStyle: string;
  freeTextPrompt: string;
};

type MenuGenerationRequestRow = {
  id: string;
};

function ensureSupabaseClient() {
  if (!supabase) {
    throw new Error(
      "Supabase client is not configured. Check NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY in .env.local.",
    );
  }

  return supabase;
}

export async function createMenuGenerationRequest({
  profileId,
  userId,
  peopleCount,
  menuStyle,
  freeTextPrompt,
}: CreateMenuGenerationRequestInput) {
  const client = ensureSupabaseClient();

  const { data: insertedRequest, error } = await client
    .from("menu_generation_requests")
    .insert({
      profile_id: profileId ?? null,
      user_id: userId ?? null,
      people_count: peopleCount,
      menu_style: menuStyle,
      free_text_prompt: freeTextPrompt.trim(),
      status: "generating" satisfies MenuGenerationRequestStatus,
    })
    .select("id")
    .single<MenuGenerationRequestRow>();

  if (error) {
    throw new Error(
      `Could not create menu generation request: ${error.message}`,
    );
  }

  if (!insertedRequest?.id) {
    throw new Error(
      "Could not create menu generation request: Supabase did not return an id.",
    );
  }

  return insertedRequest.id;
}

async function updateMenuGenerationRequest(
  id: string,
  values: {
    status: MenuGenerationRequestStatus;
    created_week_id?: string;
    model_used?: string;
    prompt_tokens?: number | null;
    completion_tokens?: number | null;
    total_tokens?: number | null;
    estimated_cost_usd?: number | null;
    response_time_ms?: number;
  },
) {
  const client = ensureSupabaseClient();
  const { error } = await client
    .from("menu_generation_requests")
    .update(values)
    .eq("id", id);

  if (error) {
    throw new Error(
      `Could not update menu generation request ${id}: ${error.message}`,
    );
  }
}

export function markMenuGenerationRequestGenerated(
  id: string,
  telemetry?: OpenAIMenuGenerationTelemetry,
) {
  return updateMenuGenerationRequest(id, {
    status: "generated",
    ...(telemetry
      ? {
          model_used: telemetry.modelUsed,
          prompt_tokens: telemetry.promptTokens,
          completion_tokens: telemetry.completionTokens,
          total_tokens: telemetry.totalTokens,
          estimated_cost_usd: telemetry.estimatedCostUsd,
          response_time_ms: telemetry.responseTimeMs,
        }
      : {}),
  });
}

export function markMenuGenerationRequestFailed(
  id: string,
  telemetry?: OpenAIMenuGenerationTelemetry,
) {
  return updateMenuGenerationRequest(id, {
    status: "failed",
    ...(telemetry
      ? {
          model_used: telemetry.modelUsed,
          prompt_tokens: telemetry.promptTokens,
          completion_tokens: telemetry.completionTokens,
          total_tokens: telemetry.totalTokens,
          estimated_cost_usd: telemetry.estimatedCostUsd,
          response_time_ms: telemetry.responseTimeMs,
        }
      : {}),
  });
}
