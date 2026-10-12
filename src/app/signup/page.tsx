"use client";

import { LogIn, MailCheck, UserPlus } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { FormEvent } from "react";
import { Suspense, useState } from "react";

import {
  AuthPageShell,
  FieldLabel,
  FormError,
  FormNotice,
  LegalNotice,
  useNextParam,
} from "@/components/session/AuthPageShell";
import { useIdentity } from "@/components/session/IdentityProvider";
import { OAuthButtons } from "@/components/session/OAuthButtons";
import { PrimaryButton, SecondaryButton, TertiaryButton } from "@/components/ui/Button";
import { TextInput } from "@/components/ui/TextInput";
import {
  newPasswordMinLength,
  resendSignupConfirmation,
  signUpWithEmail,
} from "@/lib/auth/account";
import { authHref, authRedirectUrl, defaultAfterSignupPath } from "@/lib/navigation";
import { supabase } from "@/lib/supabase/client";

function SignupForm() {
  const router = useRouter();
  const identity = useIdentity();
  const next = useNextParam();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState("");
  const [sentTo, setSentTo] = useState<string | null>(null);
  const [resendNotice, setResendNotice] = useState("");

  const confirmationUrl = () => authRedirectUrl(window.location.origin, "/auth/callback", next);

  async function handleSignup() {
    setIsSubmitting(true);
    setErrorMessage("");
    const result = await signUpWithEmail(supabase, {
      email,
      password,
      confirmation: confirmPassword,
      redirectTo: confirmationUrl(),
    });
    if (result.ok && result.status === "signed_in") {
      router.replace(next ?? defaultAfterSignupPath);
      return;
    }
    setIsSubmitting(false);
    if (result.ok) {
      setSentTo(result.email);
      setPassword("");
      setConfirmPassword("");
      return;
    }
    setErrorMessage(result.message);
  }

  async function handleResend() {
    if (!sentTo) return;
    setIsSubmitting(true);
    setResendNotice("");
    setErrorMessage("");
    const result = await resendSignupConfirmation(supabase, { email: sentTo, redirectTo: confirmationUrl() });
    setIsSubmitting(false);
    if (result.ok) setResendNotice("Te hemos enviado otro enlace.");
    else setErrorMessage(result.message);
  }

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    void handleSignup();
  };

  if (identity.status === "ready" && identity.userId && !isSubmitting) {
    return (
      <AuthPageShell title="Ya tienes la sesión iniciada">
        <p className="text-sm leading-6 text-[color:var(--color-foreground)]">
          Estás usando beCook con <strong className="break-all">{identity.email ?? "tu cuenta"}</strong>.
          Para crear otra cuenta, cierra antes la sesión en Perfil.
        </p>
        <PrimaryButton asChild className="w-full">
          <Link href={next ?? defaultAfterSignupPath} replace>Continuar</Link>
        </PrimaryButton>
      </AuthPageShell>
    );
  }

  if (sentTo) {
    return (
      <AuthPageShell title="Revisa tu email" guestHref={next ?? "/week"}>
        <div className="flex gap-3">
          <MailCheck aria-hidden="true" className="mt-0.5 h-5 w-5 shrink-0 text-[color:var(--color-secondary-hover)]" />
          <div className="space-y-2 text-sm leading-6 text-[color:var(--color-foreground)]">
            <p>
              Te hemos enviado un enlace a <strong className="break-all">{sentTo}</strong>. Ábrelo para
              activar tu cuenta; después volverás a beCook con la sesión iniciada.
            </p>
            <p className="text-[color:var(--color-muted-foreground)]">
              Si no lo ves en unos minutos, mira en la carpeta de spam. Si ya tenías cuenta con este
              email, inicia sesión o recupera tu contraseña.
            </p>
          </div>
        </div>
        {errorMessage ? <FormError>{errorMessage}</FormError> : null}
        {resendNotice ? <FormNotice>{resendNotice}</FormNotice> : null}
        <div className="grid gap-2 sm:grid-cols-2">
          <SecondaryButton type="button" disabled={isSubmitting} onClick={() => void handleResend()}>
            Reenviar enlace
          </SecondaryButton>
          <TertiaryButton asChild>
            <Link href={authHref("/login", next)}>
              <LogIn aria-hidden="true" className="h-4 w-4" />
              Ir a iniciar sesión
            </Link>
          </TertiaryButton>
        </div>
      </AuthPageShell>
    );
  }

  return (
    <AuthPageShell
      title="Crea tu cuenta"
      guestHref={next ?? "/week"}
      lede={
        <p>
          Guarda tu menú de la semana, la lista de la compra y la despensa, y ábrelos
          desde cualquier dispositivo. Con cuenta también puedes crear menús con IA.
        </p>
      }
    >
      <OAuthButtons next={next} />
      <form onSubmit={handleSubmit} className="space-y-3" noValidate>
        <div className="space-y-1.5">
          <FieldLabel htmlFor="signup-email">Email</FieldLabel>
          <TextInput
            id="signup-email"
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
          <FieldLabel htmlFor="signup-password">Contraseña</FieldLabel>
          <TextInput
            id="signup-password"
            type="password"
            autoComplete="new-password"
            minLength={newPasswordMinLength}
            aria-describedby="signup-password-hint"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            required
          />
          <p id="signup-password-hint" className="t-meta">
            Al menos {newPasswordMinLength} caracteres.
          </p>
        </div>

        <div className="space-y-1.5">
          <FieldLabel htmlFor="signup-confirm">Repite la contraseña</FieldLabel>
          <TextInput
            id="signup-confirm"
            type="password"
            autoComplete="new-password"
            value={confirmPassword}
            onChange={(event) => setConfirmPassword(event.target.value)}
            required
          />
        </div>

        {errorMessage ? <FormError>{errorMessage}</FormError> : null}

        <div className="grid gap-2 sm:grid-cols-2">
          <PrimaryButton type="submit" disabled={isSubmitting} className="w-full">
            <UserPlus aria-hidden="true" className="h-4 w-4" />
            {isSubmitting ? "Creando…" : "Crear cuenta"}
          </PrimaryButton>
          <TertiaryButton asChild>
            <Link href={authHref("/login", next)}>
              <LogIn aria-hidden="true" className="h-4 w-4" />
              Ya tengo cuenta
            </Link>
          </TertiaryButton>
        </div>
      </form>
      <LegalNotice />
    </AuthPageShell>
  );
}

export default function SignupPage() {
  return (
    <Suspense fallback={null}>
      <SignupForm />
    </Suspense>
  );
}
