import { createClient, type User } from "@supabase/supabase-js";
import { NextResponse } from "next/server";

export type AiRequestGuardResult =
  | { ok: true; user: User; body: Record<string, unknown>; accessToken: string }
  | { ok: false; response: NextResponse };

function reject(status: number, error: string): AiRequestGuardResult {
  return { ok: false, response: NextResponse.json({ error }, { status }) };
}

const loginRequired = "Inicia sesión para generar con IA.";
const tooLarge = "La petición es demasiado grande.";

function readBearerToken(request: Request) {
  const match = /^Bearer\s+(\S+)$/i.exec(request.headers.get("authorization") ?? "");
  return match?.[1] ?? null;
}

async function readLimitedText(request: Request, maxBytes: number) {
  if (!request.body) return "";
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > maxBytes) {
      await reader.cancel().catch(() => undefined);
      return null;
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder().decode(bytes);
}

// Checks run from cheapest to most expensive; nothing here calls OpenAI.
export async function guardAiRequest(
  request: Request,
  { maxBytes }: { maxBytes: number },
): Promise<AiRequestGuardResult> {
  const token = readBearerToken(request);
  if (!token) return reject(401, loginRequired);

  const contentType = request.headers.get("content-type") ?? "";
  if (contentType.split(";")[0].trim().toLowerCase() !== "application/json") {
    return reject(415, "La petición debe enviarse como JSON.");
  }

  const declaredLength = Number(request.headers.get("content-length"));
  if (Number.isFinite(declaredLength) && declaredLength > maxBytes) return reject(413, tooLarge);

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!supabaseUrl || !supabaseAnonKey) {
    return reject(503, "La verificación de sesión no está disponible.");
  }

  const supabase = createClient(supabaseUrl, supabaseAnonKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
  let user: User | null = null;
  try {
    const { data, error } = await supabase.auth.getUser(token);
    // Auth unreachable is not the user's fault: fail closed without asking them to log in again.
    if (error?.name === "AuthRetryableFetchError") {
      return reject(503, "La verificación de sesión no está disponible.");
    }
    user = error ? null : data.user;
  } catch {
    return reject(503, "La verificación de sesión no está disponible.");
  }
  if (!user) return reject(401, loginRequired);

  const text = await readLimitedText(request, maxBytes);
  if (text === null) return reject(413, tooLarge);

  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    return reject(400, "La petición no contiene JSON válido.");
  }
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return reject(400, "La petición no tiene el formato esperado.");
  }

  return { ok: true, user, body: body as Record<string, unknown>, accessToken: token };
}
