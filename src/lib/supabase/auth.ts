import type { User } from "@supabase/supabase-js";

import { supabase } from "./client";

function ensureSupabaseClient() {
  if (!supabase) {
    throw new Error(
      "Supabase client is not configured. Check NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY in .env.local.",
    );
  }

  return supabase;
}

export async function signIn(email: string, password: string) {
  const client = ensureSupabaseClient();
  const { data, error } = await client.auth.signInWithPassword({
    email: email.trim(),
    password,
  });

  if (error) {
    throw new Error(error.message);
  }

  return data.user;
}

export async function signUp(email: string, password: string) {
  const client = ensureSupabaseClient();
  const { data, error } = await client.auth.signUp({
    email: email.trim(),
    password,
  });

  if (error) {
    throw new Error(error.message);
  }

  return data.user;
}

export async function signOut() {
  const client = ensureSupabaseClient();
  const { error } = await client.auth.signOut();

  if (error) {
    throw new Error(error.message);
  }
}

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
