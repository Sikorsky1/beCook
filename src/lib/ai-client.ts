import { getAccessToken } from "@/lib/supabase/auth";

export const aiLoginRequiredMessage = "Inicia sesión para generar con IA.";

export class AiLoginRequiredError extends Error {
  constructor() {
    super(aiLoginRequiredMessage);
    this.name = "AiLoginRequiredError";
  }
}

export function isAiLoginRequiredError(error: unknown): error is AiLoginRequiredError {
  return error instanceof AiLoginRequiredError;
}

// Calls a paid AI route with the current session token. Guests never reach the API.
export async function postAi(path: string, body: unknown, signal?: AbortSignal) {
  const accessToken = await getAccessToken();

  if (!accessToken) {
    throw new AiLoginRequiredError();
  }

  const response = await fetch(path, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${accessToken}`,
    },
    body: JSON.stringify(body),
    signal,
  });

  if (response.status === 401) {
    throw new AiLoginRequiredError();
  }

  return response;
}
