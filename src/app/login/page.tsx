"use client";

import { ArrowRight, LogIn, UserPlus } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { FormEvent } from "react";
import { Suspense, useState } from "react";

import {
  AuthPageShell,
  FieldLabel,
  FormError,
  FormNotice,
  authTextLinkClass,
  useNextParam,
} from "@/components/session/AuthPageShell";
import { useIdentity } from "@/components/session/IdentityProvider";
import { PrimaryButton, SecondaryButton, TertiaryButton } from "@/components/ui/Button";
import { TextInput } from "@/components/ui/TextInput";
import { resendSignupConfirmation, signInWithEmail } from "@/lib/auth/account";
import { authHref, authRedirectUrl, defaultAfterLoginPath } from "@/lib/navigation";
import { supabase } from "@/lib/supabase/client";

function LoginForm() {
  const router = useRouter();
  const identity = useIdentity();
  const next = useNextParam();
  const destination = next ?? defaultAfterLoginPath;
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState("");
  const [needsConfirmation, setNeedsConfirmation] = useState(false);
  const [notice, setNotice] = useState("");

  async function handleSignIn() {
    setIsSubmitting(true);
    setErrorMessage("");
    setNotice("");
    setNeedsConfirmation(false);
    const result = await signInWithEmail(supabase, { email, password });
    if (result.ok) {
      // replace: going back must not return to the login form.
      router.replace(destination);
      return;
    }
    setIsSubmitting(false);
    setErrorMessage(result.message);
    setNeedsConfirmation(result.code === "email_not_confirmed");
  }

  async function handleResend() {
    setIsSubmitting(true);
    const result = await resendSignupConfirmation(supabase, {
      email,
      redirectTo: authRedirectUrl(window.location.origin, "/auth/callback", next),
    });
    setIsSubmitting(false);
    if (result.ok) {
      setErrorMessage("");
      setNeedsConfirmation(false);
      setNotice(`Te hemos enviado otro enlace a ${email.trim()}. Ábrelo para activar tu cuenta.`);
    } else {
      setErrorMessage(result.message);
    }
  }

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    void handleSignIn();
  };

  if (identity.status === "ready" && identity.userId && !isSubmitting) {
    return (
      <AuthPageShell title="Ya has iniciado sesión">
        <p className="text-sm leading-6 text-[color:var(--color-foreground)]">
          Estás usando beCook con <strong className="break-all">{identity.email ?? "tu cuenta"}</strong>.
        </p>
        <div className="grid gap-2">
          <PrimaryButton asChild className="w-full">
            <Link href={destination} replace>
              Continuar
              <ArrowRight aria-hidden="true" className="h-4 w-4" />
            </Link>
          </PrimaryButton>
          <SecondaryButton asChild className="w-full">
            <Link href="/profile">Cambiar de cuenta en Perfil</Link>
          </SecondaryButton>
        </div>
      </AuthPageShell>
    );
  }

  return (
    <AuthPageShell
      title="Entra en beCook"
      guestHref={destination}
      lede={
        <p>
          Con tu cuenta, tu menú de la semana, la lista de la compra y la despensa te
          esperan en el móvil y en el ordenador. Para crear menús con IA necesitas
          una cuenta.
        </p>
      }
    >
      <form onSubmit={handleSubmit} className="space-y-3" noValidate>
        <div className="space-y-1.5">
          <FieldLabel htmlFor="login-email">Email</FieldLabel>
          <TextInput
            id="login-email"
            type="email"
            inputMode="email"
            autoComplete="email"
            autoCapitalize="none"
            spellCheck={false}
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            placeholder="tu@email.com"
            required
          />
        </div>

        <div className="space-y-1.5">
          <div className="flex items-baseline justify-between gap-3">
            <FieldLabel htmlFor="login-password">Contraseña</FieldLabel>
            <Link href={authHref("/forgot-password", next)} className={`text-xs ${authTextLinkClass}`}>
              ¿La has olvidado?
            </Link>
          </div>
          <TextInput
            id="login-password"
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            required
          />
        </div>

        {errorMessage ? <FormError>{errorMessage}</FormError> : null}
        {needsConfirmation ? (
          <SecondaryButton
            type="button"
            className="w-full"
            disabled={isSubmitting}
            onClick={() => void handleResend()}
          >
            Enviarme otro enlace de confirmación
          </SecondaryButton>
        ) : null}
        {notice ? <FormNotice>{notice}</FormNotice> : null}

        <div className="grid gap-2 sm:grid-cols-2">
          <PrimaryButton type="submit" disabled={isSubmitting} className="w-full">
            <LogIn aria-hidden="true" className="h-4 w-4" />
            {isSubmitting ? "Entrando…" : "Entrar"}
          </PrimaryButton>
          <TertiaryButton asChild>
            <Link href={authHref("/signup", next)}>
              <UserPlus aria-hidden="true" className="h-4 w-4" />
              Crear cuenta
            </Link>
          </TertiaryButton>
        </div>
      </form>
    </AuthPageShell>
  );
}

export default function LoginPage() {
  return (
    <Suspense fallback={null}>
      <LoginForm />
    </Suspense>
  );
}
