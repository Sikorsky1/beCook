"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";

import { FormError } from "@/components/session/AuthPageShell";
import {
  enabledOAuthProviders,
  googleUnavailableFailure,
  oauthProviderLabels,
  signInWithGoogleIdToken,
  signInWithProvider,
  type OAuthProvider,
} from "@/lib/auth/account";
import { createNonce, googleButtonWidth, googleClientId, loadGoogleIdentity } from "@/lib/auth/google";
import { defaultAfterLoginPath, oauthRedirectUrl } from "@/lib/navigation";
import { supabase } from "@/lib/supabase/client";

// Inlined at build time: each Vercel environment decides which providers it shows. Google also
// needs its public client ID (NEXT_PUBLIC_GOOGLE_CLIENT_ID); without it there is no Google button.
const clientId = googleClientId(process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID);
const providers = enabledOAuthProviders(process.env.NEXT_PUBLIC_AUTH_PROVIDERS).filter(
  (provider) => provider !== "google" || clientId !== null,
);

// Same height and shape as the app buttons; colours follow each provider's brand rules
// (Google: white with a grey border and the four-colour «G»; Apple: black with the white logo).
const baseClass =
  "inline-flex min-h-11 w-full touch-manipulation items-center justify-center gap-3 rounded-[var(--radius-control)] border px-5 text-sm font-medium transition-[background-color,box-shadow,opacity] duration-200 ease-out focus-visible:outline-none focus-visible:shadow-focus disabled:cursor-not-allowed disabled:opacity-60 motion-reduce:transition-none";

const providerClass: Record<OAuthProvider, string> = {
  google: "border-[#747775] bg-white text-[#1f1f1f] hover:bg-[#f2f2f2]",
  apple: "border-black bg-black text-white hover:bg-[#333333]",
};

function GoogleLogo() {
  return (
    <svg aria-hidden="true" viewBox="0 0 48 48" className="h-[18px] w-[18px] shrink-0">
      <path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z" />
      <path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z" />
      <path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z" />
      <path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z" />
    </svg>
  );
}

function AppleLogo() {
  return (
    <svg aria-hidden="true" viewBox="0 0 384 512" className="h-[18px] w-[18px] shrink-0" fill="currentColor">
      <path d="M318.7 268.7c-.2-36.7 16.4-64.4 50-84.8-18.8-26.9-47.2-41.7-84.7-44.6-35.5-2.8-74.3 20.7-88.5 20.7-15 0-49.4-19.7-76.4-19.7C63.3 141.2 4 184.8 4 273.5q0 39.3 14.4 81.2c12.8 36.7 59 126.7 107.2 125.2 25.2-.6 43-17.9 75.8-17.9 31.8 0 48.3 17.9 76.4 17.9 48.6-.7 90.4-82.5 102.6-119.3-65.2-30.7-61.7-90-61.7-91.9zm-56.6-164.2c27.3-32.4 24.8-61.9 24-72.5-24.1 1.4-52 16.4-67.9 34.9-17.5 19.8-27.8 44.3-25.6 71.9 26.1 2 49.9-11.4 69.5-34.3z" />
    </svg>
  );
}

type GoogleStatus = "loading" | "ready" | "signing-in" | "failed";

// Google's own button (Google Identity Services, popup): it gives this page an ID token and Auth
// opens the session with it, without leaving becook.xyz. A new nonce and a fresh button for every
// attempt. Closing Google's window just leaves the button as it was.
function GoogleSignIn({
  context,
  next,
  onBusyChange,
  onError,
}: {
  context: "signin" | "signup";
  next: string | null;
  onBusyChange?: (busy: boolean) => void;
  onError: (message: string) => void;
}) {
  const router = useRouter();
  const container = useRef<HTMLDivElement>(null);
  const [status, setStatus] = useState<GoogleStatus>("loading");
  const [attempt, setAttempt] = useState(0);
  // The latest callbacks, read from Google's callback without setting the button up again.
  const latest = useRef({ next, onBusyChange, onError, router });
  useEffect(() => {
    latest.current = { next, onBusyChange, onError, router };
  });

  useEffect(() => {
    if (!clientId) return;
    let active = true;
    (async () => {
      try {
        const identity = await loadGoogleIdentity();
        const nonce = await createNonce();
        const parent = container.current;
        if (!active || !parent) return;
        identity.initialize({
          client_id: clientId,
          nonce: nonce.hashed,
          ux_mode: "popup",
          context,
          auto_select: false,
          itp_support: true,
          callback: async ({ credential }) => {
            const { onBusyChange, onError } = latest.current;
            setStatus("signing-in");
            onBusyChange?.(true);
            onError("");
            const result = await signInWithGoogleIdToken(supabase, { token: credential, nonce: nonce.raw });
            if (result.ok) {
              // replace: going back must not return to the login form.
              latest.current.router.replace(latest.current.next ?? defaultAfterLoginPath);
              return;
            }
            onBusyChange?.(false);
            onError(result.message);
            // A new nonce and button for the next try.
            setStatus("loading");
            setAttempt((value) => value + 1);
          },
        });
        parent.replaceChildren();
        identity.renderButton(parent, {
          type: "standard",
          theme: "outline",
          size: "large",
          text: "continue_with",
          shape: "rectangular",
          logo_alignment: "left",
          width: googleButtonWidth(parent.clientWidth),
          locale: "es",
        });
        setStatus("ready");
      } catch {
        if (!active) return;
        setStatus("failed");
        latest.current.onError(googleUnavailableFailure(navigator.onLine).message);
      }
    })();
    return () => {
      active = false;
    };
  }, [attempt, context]);

  return (
    <div aria-busy={status === "loading" || status === "signing-in"}>
      {/* Google draws its button here (an iframe); same height as its «large» button. */}
      <div
        ref={container}
        className={status === "ready" ? "flex min-h-10 justify-center" : "hidden"}
        data-testid="google-button"
      />
      {status === "loading" ? (
        <div aria-hidden="true" className="min-h-10 rounded-[var(--radius-control)] border border-[color:var(--color-border)]" />
      ) : null}
      {status === "signing-in" || status === "failed" ? (
        <button
          type="button"
          className={`${baseClass} ${providerClass.google}`}
          disabled={status === "signing-in"}
          onClick={() => {
            latest.current.onError("");
            setStatus("loading");
            setAttempt((value) => value + 1);
          }}
        >
          <GoogleLogo />
          {status === "signing-in" ? "Entrando con Google…" : "Continuar con Google"}
        </button>
      ) : null}
    </div>
  );
}

// «Continuar con Google/Apple» above the email form of /login and /signup, with the
// «o con tu email» divider. Renders nothing when no provider is enabled.
export function OAuthButtons({
  next,
  context = "signin",
  onBusyChange,
}: {
  next: string | null;
  context?: "signin" | "signup";
  onBusyChange?: (busy: boolean) => void;
}) {
  const [pending, setPending] = useState<OAuthProvider | null>(null);
  const [errorMessage, setErrorMessage] = useState("");

  // Back from Apple with «atrás»: the page may come from the back/forward cache with the button
  // still busy.
  useEffect(() => {
    const reset = (event: PageTransitionEvent) => {
      if (event.persisted) setPending(null);
    };
    window.addEventListener("pageshow", reset);
    return () => window.removeEventListener("pageshow", reset);
  }, []);

  if (!providers.length) return null;

  // Apple still goes through Auth's redirection (it is not enabled anywhere yet).
  async function handleApple() {
    setPending("apple");
    setErrorMessage("");
    const result = await signInWithProvider(supabase, "apple", {
      redirectTo: oauthRedirectUrl(window.location.origin, next),
    });
    // On success the page is already leaving for Apple; the button stays busy.
    if (!result.ok) {
      setPending(null);
      setErrorMessage(result.message);
    }
  }

  return (
    <div className="space-y-4">
      <div className="grid gap-2">
        {providers.map((provider) =>
          provider === "google" ? (
            <GoogleSignIn
              key={provider}
              context={context}
              next={next}
              onBusyChange={onBusyChange}
              onError={setErrorMessage}
            />
          ) : (
            <button
              key={provider}
              type="button"
              className={`${baseClass} ${providerClass[provider]}`}
              disabled={pending !== null}
              aria-busy={pending === provider}
              onClick={() => void handleApple()}
            >
              <AppleLogo />
              {pending === provider ? `Abriendo ${oauthProviderLabels[provider]}…` : `Continuar con ${oauthProviderLabels[provider]}`}
            </button>
          ),
        )}
      </div>
      {providers.includes("apple") ? (
        <p className="t-meta leading-5">
          Si ya tienes cuenta con email y en Apple eliges ocultar tu email, se creará otra cuenta: entra mejor con tu email.
        </p>
      ) : null}
      {errorMessage ? <FormError>{errorMessage}</FormError> : null}
      <div className="flex items-center gap-3">
        <span aria-hidden="true" className="h-px flex-1 bg-[color:var(--color-border)]" />
        <span className="t-meta">o con tu email</span>
        <span aria-hidden="true" className="h-px flex-1 bg-[color:var(--color-border)]" />
      </div>
    </div>
  );
}
