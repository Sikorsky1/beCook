// Account flows (sign-up, sign-in, confirmation, password recovery) with plain Spanish results.
// The auth client is injected so the flows can be tested without a browser or network.
import type { SupabaseClient } from "@supabase/supabase-js";

type AuthClient = Pick<SupabaseClient, "auth">;

export const newPasswordMinLength = 8;

export type AccountFailure = { ok: false; message: string; code: string | null };

type ErrorLike = { code?: unknown; status?: unknown; name?: unknown; message?: unknown };

export const accountUnavailableMessage =
  "Ahora mismo no podemos conectar con tu cuenta. Puedes seguir usando beCook en este dispositivo.";

const fallbackByAction = {
  signIn: "No se pudo iniciar sesión. Inténtalo de nuevo.",
  signUp: "No se pudo crear la cuenta. Inténtalo de nuevo.",
  recover: "No se pudo enviar el email. Inténtalo de nuevo.",
  resend: "No se pudo reenviar el email. Inténtalo de nuevo.",
  updatePassword: "No se pudo cambiar la contraseña. Inténtalo de nuevo.",
  oauth: "No se pudo conectar. Inténtalo de nuevo o entra con tu email.",
} as const;

export type AccountAction = keyof typeof fallbackByAction;

const messageByCode: Record<string, string> = {
  invalid_credentials: "El email o la contraseña no son correctos.",
  email_not_confirmed:
    "Aún no has confirmado tu email. Abre el enlace que te enviamos o pide uno nuevo.",
  user_already_exists: "Ya hay una cuenta con ese email. Inicia sesión o recupera tu contraseña.",
  email_exists: "Ya hay una cuenta con ese email. Inicia sesión o recupera tu contraseña.",
  weak_password: `Elige una contraseña más segura: al menos ${newPasswordMinLength} caracteres, mezclando letras y números.`,
  same_password: "La contraseña nueva tiene que ser distinta de la anterior.",
  email_address_invalid: "Revisa el email: no parece una dirección válida.",
  validation_failed: "Revisa el email y la contraseña.",
  over_email_send_rate_limit:
    "Ya te hemos enviado varios emails. Espera unos minutos antes de pedir otro.",
  over_request_rate_limit: "Demasiados intentos seguidos. Espera unos minutos y vuelve a probar.",
  signup_disabled: "Ahora mismo no se pueden crear cuentas nuevas.",
  email_provider_disabled: "Ahora mismo no se pueden crear cuentas nuevas.",
  otp_expired: "El enlace ha caducado o ya se ha usado. Pide uno nuevo.",
  flow_state_expired: "El enlace ha caducado o ya se ha usado. Pide uno nuevo.",
  flow_state_not_found: "El enlace ha caducado o ya se ha usado. Pide uno nuevo.",
  bad_code_verifier: "Abre el enlace en el mismo navegador donde lo pediste, o pide uno nuevo.",
  session_not_found: "Tu sesión ha caducado. Vuelve a pedir el enlace.",
  session_expired: "Tu sesión ha caducado. Vuelve a pedir el enlace.",
  refresh_token_not_found: "Tu sesión ha caducado. Vuelve a pedir el enlace.",
  reauthentication_needed: "Por seguridad, vuelve a pedir el enlace para cambiar la contraseña.",
  // Return from Google or Apple (/auth/callback).
  access_denied: "Has cancelado el inicio de sesión. Puedes volver a intentarlo o entrar con tu email.",
  provider_disabled: "Ahora mismo no se puede entrar así. Entra con tu email.",
  bad_oauth_state: "No se pudo completar el inicio de sesión. Vuelve a intentarlo desde el principio.",
  bad_oauth_callback: "No se pudo completar el inicio de sesión. Vuelve a intentarlo desde el principio.",
  provider_email_needs_verification:
    "Tu cuenta de ese proveedor no tiene el email verificado. Verifícalo allí o entra con tu email.",
  identity_already_exists: "Esa cuenta ya está vinculada a otro usuario de beCook.",
  user_banned: "Esta cuenta no puede entrar ahora mismo.",
};

// Errors that only come back from a provider sign-in: the callback offers to try again, not
// to resend an email link.
const providerErrorCodes = new Set([
  "access_denied",
  "provider_disabled",
  "bad_oauth_state",
  "bad_oauth_callback",
  "provider_email_needs_verification",
  "identity_already_exists",
  "user_banned",
]);

// Never shows provider wording (English, technical); unknown errors fall back per action.
export function describeAccountError(error: unknown, action: AccountAction): AccountFailure {
  const value = (error && typeof error === "object" ? error : {}) as ErrorLike;
  const code = typeof value.code === "string" ? value.code : null;
  if (code && messageByCode[code]) return { ok: false, message: messageByCode[code], code };
  if (value.status === 429) return { ok: false, message: messageByCode.over_request_rate_limit, code: code ?? "rate_limited" };
  const offline =
    value.name === "AuthRetryableFetchError" ||
    value.status === 0 ||
    (value.name === "TypeError" && typeof value.message === "string" && /fetch|network/i.test(value.message));
  if (offline) {
    return { ok: false, message: "No hay conexión. Comprueba tu red e inténtalo de nuevo.", code: "offline" };
  }
  return { ok: false, message: fallbackByAction[action], code };
}

const unavailable: AccountFailure = { ok: false, message: accountUnavailableMessage, code: "unavailable" };

export function normalizeEmail(email: string) {
  return email.trim();
}

export function validateEmail(email: string): string | null {
  const value = normalizeEmail(email);
  if (!value) return "Escribe tu email.";
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) return "Revisa el email: no parece una dirección válida.";
  return null;
}

export function validateNewPassword(password: string, confirmation: string): string | null {
  if (!password) return "Escribe una contraseña.";
  if (password.length < newPasswordMinLength) {
    return `La contraseña necesita al menos ${newPasswordMinLength} caracteres.`;
  }
  if (!confirmation) return "Repite la contraseña para confirmarla.";
  if (password !== confirmation) return "Las contraseñas no coinciden.";
  return null;
}

async function attempt<T>(action: AccountAction, run: () => Promise<T>): Promise<T | AccountFailure> {
  try {
    return await run();
  } catch (error: unknown) {
    return describeAccountError(error, action);
  }
}

export async function signInWithEmail(
  client: AuthClient | null,
  { email, password }: { email: string; password: string },
): Promise<{ ok: true } | AccountFailure> {
  const invalid = validateEmail(email) ?? (password ? null : "Escribe tu contraseña.");
  if (invalid) return { ok: false, message: invalid, code: "invalid_input" };
  if (!client) return unavailable;
  return attempt("signIn", async () => {
    const { data, error } = await client.auth.signInWithPassword({ email: normalizeEmail(email), password });
    if (error) return describeAccountError(error, "signIn");
    if (!data.session) return describeAccountError(null, "signIn");
    return { ok: true as const };
  });
}

export type SignUpResult =
  | { ok: true; status: "signed_in" }
  // Confirmation is required. Also returned for an address that already has an account,
  // so the screen does not reveal which emails are registered.
  | { ok: true; status: "confirm_email"; email: string }
  | AccountFailure;

export async function signUpWithEmail(
  client: AuthClient | null,
  { email, password, confirmation, redirectTo }: { email: string; password: string; confirmation: string; redirectTo: string },
): Promise<SignUpResult> {
  const invalid = validateEmail(email) ?? validateNewPassword(password, confirmation);
  if (invalid) return { ok: false, message: invalid, code: "invalid_input" };
  if (!client) return unavailable;
  const address = normalizeEmail(email);
  return attempt("signUp", async () => {
    const { data, error } = await client.auth.signUp({
      email: address,
      password,
      options: { emailRedirectTo: redirectTo },
    });
    if (error) return describeAccountError(error, "signUp");
    if (data.session) return { ok: true as const, status: "signed_in" as const };
    return { ok: true as const, status: "confirm_email" as const, email: address };
  });
}

export async function resendSignupConfirmation(
  client: AuthClient | null,
  { email, redirectTo }: { email: string; redirectTo: string },
): Promise<{ ok: true } | AccountFailure> {
  const invalid = validateEmail(email);
  if (invalid) return { ok: false, message: invalid, code: "invalid_input" };
  if (!client) return unavailable;
  return attempt("resend", async () => {
    const { error } = await client.auth.resend({
      type: "signup",
      email: normalizeEmail(email),
      options: { emailRedirectTo: redirectTo },
    });
    return error ? describeAccountError(error, "resend") : { ok: true as const };
  });
}

// The same answer whether or not the address has an account.
export async function requestPasswordReset(
  client: AuthClient | null,
  { email, redirectTo }: { email: string; redirectTo: string },
): Promise<{ ok: true } | AccountFailure> {
  const invalid = validateEmail(email);
  if (invalid) return { ok: false, message: invalid, code: "invalid_input" };
  if (!client) return unavailable;
  return attempt("recover", async () => {
    const { error } = await client.auth.resetPasswordForEmail(normalizeEmail(email), { redirectTo });
    if (!error) return { ok: true as const };
    // Some configurations answer "user not found"; it must look like a sent email.
    if (error.code === "user_not_found") return { ok: true as const };
    return describeAccountError(error, "recover");
  });
}

export async function updatePassword(
  client: AuthClient | null,
  { password, confirmation }: { password: string; confirmation: string },
): Promise<{ ok: true } | AccountFailure> {
  const invalid = validateNewPassword(password, confirmation);
  if (invalid) return { ok: false, message: invalid, code: "invalid_input" };
  if (!client) return unavailable;
  return attempt("updatePassword", async () => {
    const { error } = await client.auth.updateUser({ password });
    return error ? describeAccountError(error, "updatePassword") : { ok: true as const };
  });
}

// Error returned by an email link (confirmation or recovery), in the query or the fragment.
// Auth leaves it in the address when the link fails; a successful link carries no error.
export function readAuthLinkError(href: string): AccountFailure | null {
  let url: URL;
  try {
    url = new URL(href);
  } catch {
    return null;
  }
  const params = new URLSearchParams(url.search);
  new URLSearchParams(url.hash.replace(/^#/, "")).forEach((value, key) => params.set(key, value));
  const code = params.get("error_code");
  const error = params.get("error");
  if (!code && !error && !params.get("error_description")) return null;
  if (code && messageByCode[code]) return { ok: false, message: messageByCode[code], code };
  // A cancelled provider screen comes back as error=access_denied, sometimes without error_code.
  if (!code && error === "access_denied") return { ok: false, message: messageByCode.access_denied, code: error };
  return { ok: false, message: "El enlace no es válido o ya se ha usado. Pide uno nuevo.", code: code ?? error };
}

export function isProviderSignInError(failure: AccountFailure | null) {
  return Boolean(failure?.code && providerErrorCodes.has(failure.code));
}

// --- Sign-in with Google or Apple ---------------------------------------------------------------

export type OAuthProvider = "google" | "apple";

// Display order on the account screens.
const oauthProviders: readonly OAuthProvider[] = ["google", "apple"];

export const oauthProviderLabels: Record<OAuthProvider, string> = { google: "Google", apple: "Apple" };

// NEXT_PUBLIC_AUTH_PROVIDERS ("google", "google,apple"): providers enabled in this environment.
// Unset or unknown values show no buttons, so an environment without the provider looks as before.
export function enabledOAuthProviders(value: string | null | undefined): OAuthProvider[] {
  const listed = new Set(
    (value ?? "")
      .split(",")
      .map((name) => name.trim().toLowerCase())
      .filter(Boolean),
  );
  return oauthProviders.filter((provider) => listed.has(provider));
}

// Leaves for the provider's screen (the auth client changes the page); it comes back to
// `redirectTo` (/auth/callback) with the session or with an error in the address.
export async function signInWithProvider(
  client: AuthClient | null,
  provider: OAuthProvider,
  { redirectTo }: { redirectTo: string },
): Promise<{ ok: true } | AccountFailure> {
  if (!client) return unavailable;
  return attempt("oauth", async () => {
    const { error } = await client.auth.signInWithOAuth({ provider, options: { redirectTo } });
    return error ? describeAccountError(error, "oauth") : { ok: true as const };
  });
}

// How the account signs in, from `user.identities` (email first, then providers in display order).
export function signInMethodLabels(identities: readonly { provider?: string | null }[] | null | undefined) {
  const providers = new Set((identities ?? []).map((identity) => identity.provider ?? ""));
  const labels: string[] = [];
  if (providers.has("email")) labels.push("Email y contraseña");
  for (const provider of oauthProviders) if (providers.has(provider)) labels.push(oauthProviderLabels[provider]);
  return labels;
}
