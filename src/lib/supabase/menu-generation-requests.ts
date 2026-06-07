import { supabase } from "./client";

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
  console.log("Saving menu request with user:", userId ?? null);

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

export function markMenuGenerationRequestGenerated(id: string) {
  return updateMenuGenerationRequest(id, { status: "generated" });
}

export function markMenuGenerationRequestFailed(id: string) {
  return updateMenuGenerationRequest(id, { status: "failed" });
}

export function markMenuGenerationRequestApplied(id: string, weekId: string) {
  return updateMenuGenerationRequest(id, {
    status: "applied",
    created_week_id: weekId,
  });
}
