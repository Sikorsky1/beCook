// «Continuar con Google» with Google Identity Services (GIS) on our own page: Google's button
// returns an ID token here, and Auth checks it (signInWithIdToken). No redirection through the
// Supabase domain, so Google's consent screen only needs becook.xyz.
// https://developers.google.com/identity/gsi/web/reference/js-reference

export const googleIdentityScriptUrl = "https://accounts.google.com/gsi/client";

// NEXT_PUBLIC_GOOGLE_CLIENT_ID: the public web client ID (…apps.googleusercontent.com). Anything
// else counts as unset, so the Google button is not shown.
export function googleClientId(value: string | null | undefined) {
  const id = (value ?? "").trim();
  return /^[\w-]+\.apps\.googleusercontent\.com$/.test(id) ? id : null;
}

// A fresh nonce per attempt: Google signs its SHA-256 (hex) into the ID token and Auth hashes the
// plain value to compare, so a token taken from elsewhere cannot be replayed on this page.
export async function createNonce(crypto: Crypto = globalThis.crypto) {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  const raw = Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(raw));
  const hashed = Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
  return { raw, hashed };
}

// The part of window.google.accounts.id that beCook uses.
export type GoogleCredentialResponse = { credential?: string };
export type GoogleIdentity = {
  initialize(config: {
    client_id: string;
    callback: (response: GoogleCredentialResponse) => void;
    nonce: string;
    ux_mode: "popup";
    context: "signin" | "signup";
    auto_select: false;
    itp_support: true;
  }): void;
  renderButton(
    parent: HTMLElement,
    options: {
      type: "standard";
      theme: "outline";
      size: "large";
      text: "continue_with";
      shape: "rectangular";
      logo_alignment: "left";
      width: number;
      locale: string;
    },
  ): void;
  cancel(): void;
};

type GoogleWindow = Window & { google?: { accounts?: { id?: GoogleIdentity } } };

// GIS renders its button between 200 and 400 px wide: as wide as the form, within those limits.
export function googleButtonWidth(containerWidth: number) {
  return Math.round(Math.min(400, Math.max(200, containerWidth || 0)));
}

let loading: Promise<GoogleIdentity> | null = null;

// Loads Google's script once per page. Rejects when it cannot load (offline, blocked by an
// extension or a network filter) so the page can say so; a later attempt tries again.
export function loadGoogleIdentity(win: GoogleWindow = window, timeoutMs = 15000): Promise<GoogleIdentity> {
  const ready = win.google?.accounts?.id;
  if (ready) return Promise.resolve(ready);
  if (loading) return loading;
  loading = new Promise<GoogleIdentity>((resolve, reject) => {
    const script = win.document.createElement("script");
    const fail = () => {
      clearTimeout(timer);
      script.remove();
      loading = null;
      reject(new Error("google_unavailable"));
    };
    const timer = setTimeout(fail, timeoutMs);
    script.src = googleIdentityScriptUrl;
    script.async = true;
    script.onload = () => {
      const identity = win.google?.accounts?.id;
      if (!identity) return fail();
      clearTimeout(timer);
      resolve(identity);
    };
    script.onerror = fail;
    win.document.head.appendChild(script);
  });
  return loading;
}
