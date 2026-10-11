import { createClient } from "@supabase/supabase-js";
import { NextResponse } from "next/server";
import {
  parseCurrentFoodContext,
  parseWeekFoodContextStatus,
  type CurrentFoodContext,
  type WeekFoodContextStatus,
} from "@/lib/menu-generation/food-context";
import type { IsoWeek } from "@/lib/isoWeek";

// The caller's food context, read on the server with their own session (RLS applies, as for any
// client read). The browser never supplies restrictions or allergies to the AI routes (C1).

type Read<T> = { ok: true; value: T } | { ok: false; response: NextResponse };

function userClient(accessToken: string) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anonKey) return null;
  return createClient(url, anonKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    global: { headers: { Authorization: `Bearer ${accessToken}` } },
  });
}

const unavailable = () =>
  NextResponse.json({ error: "No hemos podido leer tu perfil. Inténtalo de nuevo en unos segundos." }, { status: 503 });

async function callRpc<T>(accessToken: string, name: string, args: Record<string, unknown> | undefined, parse: (value: unknown) => T): Promise<Read<T>> {
  const client = userClient(accessToken);
  if (!client) return { ok: false, response: unavailable() };
  try {
    const { data, error } = await client.rpc(name, args);
    if (error) return { ok: false, response: unavailable() };
    return { ok: true, value: parse(data) };
  } catch {
    return { ok: false, response: unavailable() };
  }
}

// The saved profile now ({found: false} without one).
export function readCurrentFoodContext(accessToken: string): Promise<Read<CurrentFoodContext>> {
  return callRpc(accessToken, "current_food_context", undefined, parseCurrentFoodContext);
}

// The saved profile. Without one, a menu would be planned without knowing the allergies: 409.
export async function readProfileFoodContext(accessToken: string): Promise<Read<Extract<CurrentFoodContext, { found: true }>>> {
  const read = await readCurrentFoodContext(accessToken);
  if (!read.ok) return read;
  if (!read.value.found) {
    return {
      ok: false,
      response: NextResponse.json(
        { error: "Guarda tu perfil (comensales, restricciones y alergias) antes de pedir un menú.", reason: "profile_required" },
        { status: 409 },
      ),
    };
  }
  return { ok: true, value: read.value };
}

// The week's frozen context next to the current profile.
export function readWeekFoodContext(accessToken: string, isoWeek: IsoWeek): Promise<Read<WeekFoodContextStatus>> {
  return callRpc(
    accessToken,
    "week_food_context_status",
    { p_iso_year: isoWeek.isoYear, p_iso_week: isoWeek.isoWeek },
    parseWeekFoodContextStatus,
  );
}
