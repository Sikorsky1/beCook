import "server-only";

import { createClient, type SupabaseClient, type User } from "@supabase/supabase-js";
import { NextResponse } from "next/server";

// P37: the account's own data (export) and the account itself (deletion), on the server.
// - The session is verified with Auth (the same check as the AI routes), never trusted from the body.
// - Export reads every application table with the caller's own session, so RLS applies exactly as
//   in the app; the AI usage ledger (no client access) is read with the service key filtered by the
//   verified user id, without ip_hash.
// - Deletion removes the Auth user with the service key; the database cascades to every table,
//   except the AI usage rows, which stay without owner (migration 20261015090000).

export const accountLimits = { deleteBodyBytes: 1024, pageSize: 1000, maxPagesPerTable: 50 } as const;

export const DELETE_CONFIRMATION = "ELIMINAR";

const noStore = { "Cache-Control": "no-store" };
const sessionUnavailable = "La verificación de sesión no está disponible. Inténtalo de nuevo en unos minutos.";

type Verified = { ok: true; user: User; accessToken: string } | { ok: false; response: NextResponse };

export function accountError(status: number, error: string, reason?: string) {
  return NextResponse.json(reason ? { error, reason } : { error }, { status, headers: noStore });
}

const clientOptions = { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } } as const;

function readBearerToken(request: Request) {
  const match = /^Bearer\s+(\S+)$/i.exec(request.headers.get("authorization") ?? "");
  return match?.[1] ?? null;
}

export function hasBearerToken(request: Request) {
  return readBearerToken(request) !== null;
}

export function loginRequired() {
  return accountError(401, "Inicia sesión para gestionar los datos de tu cuenta.");
}

// Cheap checks before asking Auth: JSON and declared size (same order as the AI routes).
export function precheckJson(request: Request, maxBytes: number): NextResponse | null {
  const contentType = request.headers.get("content-type") ?? "";
  if (contentType.split(";")[0].trim().toLowerCase() !== "application/json") {
    return accountError(415, "La petición debe enviarse como JSON.");
  }
  const declared = Number(request.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > maxBytes) return accountError(413, "La petición es demasiado grande.");
  return null;
}

export async function verifyAccountSession(request: Request): Promise<Verified> {
  const token = readBearerToken(request);
  if (!token) return { ok: false, response: loginRequired() };
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anonKey) return { ok: false, response: accountError(503, sessionUnavailable) };
  try {
    const { data, error } = await createClient(url, anonKey, clientOptions).auth.getUser(token);
    if (error?.name === "AuthRetryableFetchError") return { ok: false, response: accountError(503, sessionUnavailable) };
    if (error || !data.user) {
      return { ok: false, response: accountError(401, "Tu sesión ha caducado. Vuelve a iniciar sesión.") };
    }
    return { ok: true, user: data.user, accessToken: token };
  } catch {
    return { ok: false, response: accountError(503, sessionUnavailable) };
  }
}

export function userClient(accessToken: string): SupabaseClient | null {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anonKey) return null;
  return createClient(url, anonKey, { ...clientOptions, global: { headers: { Authorization: `Bearer ${accessToken}` } } });
}

export function serviceClient(): SupabaseClient | null {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceRoleKey) return null;
  return createClient(url, serviceRoleKey, clientOptions);
}

type TableSpec = {
  table: string;
  // Explicit owner filter on top of RLS (defence in depth); tables owned through their week rely on RLS.
  owner?: string;
  order: string;
  select?: string;
  // Rows the policy shows but that are not the user's (catalogue versions) are dropped here.
  keep?: (row: Record<string, unknown>) => boolean;
  strip?: string[];
};

// Every table that holds data of a user. Adding a table with user data means adding it here
// (tests/account-data.test.cjs compares this list with the migrations).
export const exportTables: TableSpec[] = [
  { table: "profiles", owner: "user_id", order: "id" },
  { table: "onboarding_progress", owner: "user_id", order: "user_id" },
  { table: "weeks", owner: "user_id", order: "id" },
  { table: "week_days", order: "id" },
  { table: "week_food_contexts", owner: "user_id", order: "week_id" },
  { table: "week_daily_meals", owner: "user_id", order: "iso_year" },
  { table: "nutrition_plans", owner: "user_id", order: "user_id" },
  { table: "menu_generation_requests", owner: "user_id", order: "id" },
  { table: "shopping_lists", order: "id" },
  { table: "shopping_items", order: "id" },
  { table: "pantry_items", owner: "user_id", order: "id" },
  { table: "recipes", owner: "owner_user_id", order: "id" },
  {
    table: "recipe_versions",
    order: "id",
    select: "*, recipes!inner(owner_user_id)",
    keep: (row) => Boolean(row.recipes),
    strip: ["recipes"],
  },
];

// The ledger columns a user gets back: everything except the keyed hash of the IP.
export const aiUsageExportColumns =
  "id,flow,status,reject_reason,model,prompt_tokens,completion_tokens,cost_usd,latency_ms,request_id,created_at,finished_at";

class ExportUnavailable extends Error {}

async function readAll(client: SupabaseClient, spec: TableSpec, userId: string) {
  const rows: Record<string, unknown>[] = [];
  for (let page = 0; page < accountLimits.maxPagesPerTable; page++) {
    const from = page * accountLimits.pageSize;
    let query = client.from(spec.table).select(spec.select ?? "*");
    if (spec.owner) query = query.eq(spec.owner, userId);
    if (spec.table === "recipe_versions") query = query.eq("recipes.owner_user_id", userId);
    const { data, error } = await query.order(spec.order, { ascending: true }).range(from, from + accountLimits.pageSize - 1);
    if (error || !Array.isArray(data)) throw new ExportUnavailable(spec.table);
    for (const raw of data as unknown as Record<string, unknown>[]) {
      if (spec.keep && !spec.keep(raw)) continue;
      const row = { ...raw };
      for (const key of spec.strip ?? []) delete row[key];
      rows.push(row);
    }
    if (data.length < accountLimits.pageSize) return rows;
  }
  // More rows than any real account has: refuse rather than return an incomplete copy.
  throw new ExportUnavailable(spec.table);
}

async function readAiUsage(service: SupabaseClient, userId: string) {
  const rows: Record<string, unknown>[] = [];
  for (let page = 0; page < accountLimits.maxPagesPerTable; page++) {
    const from = page * accountLimits.pageSize;
    const { data, error } = await service
      .from("ai_usage_events")
      .select(aiUsageExportColumns)
      .eq("user_id", userId)
      .order("created_at", { ascending: true })
      .order("id", { ascending: true })
      .range(from, from + accountLimits.pageSize - 1);
    if (error || !Array.isArray(data)) throw new ExportUnavailable("ai_usage_events");
    rows.push(...(data as unknown as Record<string, unknown>[]));
    if (data.length < accountLimits.pageSize) return rows;
  }
  throw new ExportUnavailable("ai_usage_events");
}

export type AccountExport = {
  format: "becook-account-export";
  version: 1;
  exportedAt: string;
  account: { id: string; email: string | null; createdAt: string | null; lastSignInAt: string | null; emailConfirmedAt: string | null };
  tables: Record<string, Record<string, unknown>[]>;
  aiUsage: Record<string, unknown>[];
  notes: string[];
};

export async function buildAccountExport(user: User, accessToken: string): Promise<AccountExport | null> {
  const client = userClient(accessToken);
  const service = serviceClient();
  if (!client || !service) return null;
  try {
    const tables: AccountExport["tables"] = {};
    for (const spec of exportTables) tables[spec.table] = await readAll(client, spec, user.id);
    const aiUsage = await readAiUsage(service, user.id);
    return {
      format: "becook-account-export",
      version: 1,
      exportedAt: new Date().toISOString(),
      account: {
        id: user.id,
        email: user.email ?? null,
        createdAt: user.created_at ?? null,
        lastSignInAt: user.last_sign_in_at ?? null,
        emailConfirmedAt: user.email_confirmed_at ?? null,
      },
      tables,
      aiUsage,
      notes: [
        "Copia de todos los datos de tu cuenta en beCook en el momento de la descarga.",
        "aiUsage: registro de tus peticiones de IA (tipo, resultado, modelo, tokens y coste estimado), sin la huella de red.",
        "Los datos guardados solo en este dispositivo (sin cuenta) no están en la cuenta y no se incluyen.",
      ],
    };
  } catch (error) {
    if (error instanceof ExportUnavailable) return null;
    throw error;
  }
}

export function exportFileName(date = new Date()) {
  return `becook-datos-${date.toISOString().slice(0, 10)}.json`;
}

export async function readLimitedJson(request: Request, maxBytes: number): Promise<{ ok: true; body: Record<string, unknown> } | { ok: false; response: NextResponse }> {
  const rejected = precheckJson(request, maxBytes);
  if (rejected) return { ok: false, response: rejected };
  let text = "";
  if (request.body) {
    const reader = request.body.getReader();
    const chunks: Uint8Array[] = [];
    let size = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > maxBytes) {
        await reader.cancel().catch(() => undefined);
        return { ok: false, response: accountError(413, "La petición es demasiado grande.") };
      }
      chunks.push(value);
    }
    text = new TextDecoder().decode(Buffer.concat(chunks));
  }
  try {
    const body: unknown = JSON.parse(text);
    if (!body || typeof body !== "object" || Array.isArray(body)) throw new Error("shape");
    return { ok: true, body: body as Record<string, unknown> };
  } catch {
    return { ok: false, response: accountError(400, "La petición no tiene el formato esperado.") };
  }
}
