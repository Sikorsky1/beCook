"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import type { FormEvent } from "react";
import { Suspense, useEffect, useState, useSyncExternalStore } from "react";

import {
  AuthPageShell,
  FieldLabel,
  FormError,
  FormNotice,
  useAuthLinkErrorMessage,
  useNextParam,
} from "@/components/session/AuthPageShell";
import { useIdentity } from "@/components/session/IdentityProvider";
import { PrimaryButton, SecondaryButton } from "@/components/ui/Button";
import { TextInput } from "@/components/ui/TextInput";
import { isProviderSignInError, readAuthLinkError, resendSignupConfirmation } from "@/lib/auth/account";
import { authHref, authRedirectUrl, defaultAfterLoginPath } from "@/lib/navigation";
import { supabase } from "@/lib/supabase/client";

const noSubscription = () => () => {};

// The address carries an error from Google or Apple (not from an email link).
function useProviderSignInError() {
  return useSyncExternalStore(
    noSubscription,
    () => isProviderSignInError(readAuthLinkError(window.location.href), window.location.href),
    () => false,
  );
}

// Landing page of the sign-up confirmation email and of the return from Google or Apple. The auth
// client reads the session from the address on load. A new account is sent to the onboarding by
// OnboardingGate on /week.
function AuthCallback() {
  const router = useRouter();
  const identity = useIdentity();
  const next = useNextParam();
  const linkError = useAuthLinkErrorMessage();
  const providerError = useProviderSignInError();
  const destination = next ?? defaultAfterLoginPath;
  const signedIn = identity.status === "ready" && Boolean(identity.userId) && !linkError;
  const [email, setEmail] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState("");
  const [notice, setNotice] = useState("");

  useEffect(() => {
    // The destination is never an account screen (safeNextPath), so this cannot loop.
    if (signedIn) router.replace(destination);
  }, [signedIn, destination, router]);

  async function handleResend() {
    setIsSubmitting(true);
    setErrorMessage("");
    setNotice("");
    const result = await resendSignupConfirmation(supabase, {
      email,
      redirectTo: authRedirectUrl(window.location.origin, "/auth/callback", next),
    });
    setIsSubmitting(false);
    if (result.ok) setNotice(`Si ${email.trim()} tiene una cuenta pendiente, te hemos enviado otro enlace.`);
    else setErrorMessage(result.message);
  }

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    void handleResend();
  };

  if (identity.status !== "ready" || signedIn) {
    return (
      <AuthPageShell title="Entrando…">
        <p className="text-sm text-[color:var(--color-muted-foreground)]" role="status">
          {signedIn ? "Te llevamos a beCook…" : "Un momento."}
        </p>
      </AuthPageShell>
    );
  }

  // Back from Google or Apple with an error (cancelled, provider unavailable…): resending an email
  // link does not apply, only trying again.
  if (providerError) {
    return (
      <AuthPageShell title="No has iniciado sesión" guestHref={next ?? "/week"}>
        <FormError>{linkError}</FormError>
        <PrimaryButton asChild className="w-full">
          <Link href={authHref("/login", next)} replace>Volver a iniciar sesión</Link>
        </PrimaryButton>
      </AuthPageShell>
    );
  }

  return (
    <AuthPageShell title="No hemos podido activar la cuenta" guestHref={next ?? "/week"}>
      <FormError>
        {linkError || "El enlace no es válido, ha caducado o ya se ha usado."}
      </FormError>
      <p className="text-sm leading-6 text-[color:var(--color-foreground)]">
        Si ya activaste la cuenta, inicia sesión. Si no, te enviamos otro enlace.
      </p>
      <form onSubmit={handleSubmit} className="space-y-3" noValidate>
        <div className="space-y-1.5">
          <FieldLabel htmlFor="callback-email">Email</FieldLabel>
          <TextInput
            id="callback-email"
            type="email"
            inputMode="email"
            autoComplete="email"
            autoCapitalize="none"
            spellCheck={false}
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            placeholder="tu@email.com"
          />
        </div>
        {errorMessage ? <FormError>{errorMessage}</FormError> : null}
        {notice ? <FormNotice>{notice}</FormNotice> : null}
        <div className="grid gap-2 sm:grid-cols-2">
          <SecondaryButton type="submit" disabled={isSubmitting}>
            Enviar otro enlace
          </SecondaryButton>
          <PrimaryButton asChild>
            <Link href={authHref("/login", next)}>Iniciar sesión</Link>
          </PrimaryButton>
        </div>
      </form>
    </AuthPageShell>
  );
}

export default function AuthCallbackPage() {
  return (
    <Suspense fallback={null}>
      <AuthCallback />
    </Suspense>
  );
}
