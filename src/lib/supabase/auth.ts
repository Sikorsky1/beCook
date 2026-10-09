import type { User } from "@supabase/supabase-js";

import { supabase } from "./client";

export async function getCurrentUser(): Promise<User | null> {
  if (!supabase) {
    return null;
  }

  const { data, error } = await supabase.auth.getUser();

  if (error) {
    console.warn("No se pudo obtener el usuario actual de Supabase Auth:", {
      message: error.message,
      status: error.status,
      name: error.name,
    });

    return null;
  }

  return data.user;
}

export async function getAccessToken(): Promise<string | null> {
  if (!supabase) {
    return null;
  }

  // getSession refreshes an expired access token when a refresh token exists.
  const { data, error } = await supabase.auth.getSession();

  if (error) {
    return null;
  }

  return data.session?.access_token ?? null;
}
