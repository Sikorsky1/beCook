"use client";

import { LogIn, MailCheck } from "lucide-react";
import Link from "next/link";
import type { FormEvent } from "react";
import { Suspense, useState } from "react";

import {
  AuthPageShell,
  FieldLabel,
  FormError,
  useNextParam,
} from "@/components/session/AuthPageShell";
import { PrimaryButton, SecondaryButton, TertiaryButton } from "@/components/ui/Button";
import { TextInput } from "@/components/ui/TextInput";
import { requestPasswordReset } from "@/lib/auth/account";
import { authHref, authRedirectUrl } from "@/lib/navigation";
import { supabase } from "@/lib/supabase/client";

function ForgotPasswordForm() {
  const next = useNextParam();
  const [email, setEmail] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState("");
  const [sentTo, setSentTo] = useState<string | null>(null);

  async function handleRequest() {
    setIsSubmitting(true);
    setErrorMessage("");
    const result = await requestPasswordReset(supabase, {
      email,
      redirectTo: authRedirectUrl(window.location.origin, "/reset-password", next),
    });
    setIsSubmitting(false);
    if (result.ok) setSentTo(email.trim());
    else setErrorMessage(result.message);
  }

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    void handleRequest();
  };

  if (sentTo) {
    return (
      <AuthPageShell title="Revisa tu email" guestHref={next ?? "/week"}>
        <div className="flex gap-3">
          <MailCheck aria-hidden="true" className="mt-0.5 h-5 w-5 shrink-0 text-[color:var(--color-secondary-hover)]" />
          <div className="space-y-2 text-sm leading-6 text-[color:var(--color-foreground)]" role="status">
            <p>
              Si hay una cuenta con <strong className="break-all">{sentTo}</strong>, te hemos enviado un
              enlace para crear una contraseña nueva. Caduca en una hora y solo sirve una vez.
            </p>
            <p className="text-[color:var(--color-muted-foreground)]">
              Si no lo ves en unos minutos, mira en la carpeta de spam o revisa que el email esté bien escrito.
            </p>
          </div>
        </div>
        {errorMessage ? <FormError>{errorMessage}</FormError> : null}
        <div className="grid gap-2 sm:grid-cols-2">
          <SecondaryButton type="button" disabled={isSubmitting} onClick={() => void handleRequest()}>
            Enviar otro enlace
          </SecondaryButton>
          <TertiaryButton asChild>
            <Link href={authHref("/login", next)}>
              <LogIn aria-hidden="true" className="h-4 w-4" />
              Volver a iniciar sesión
            </Link>
          </TertiaryButton>
        </div>
      </AuthPageShell>
    );
  }

  return (
    <AuthPageShell
      title="Recupera tu contraseña"
      guestHref={next ?? "/week"}
      lede={<p>Escribe el email de tu cuenta y te enviaremos un enlace para crear una contraseña nueva.</p>}
    >
      <form onSubmit={handleSubmit} className="space-y-3" noValidate>
        <div className="space-y-1.5">
          <FieldLabel htmlFor="forgot-email">Email</FieldLabel>
          <TextInput
            id="forgot-email"
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

        {errorMessage ? <FormError>{errorMessage}</FormError> : null}

        <div className="grid gap-2 sm:grid-cols-2">
          <PrimaryButton type="submit" disabled={isSubmitting} className="w-full">
            {isSubmitting ? "Enviando…" : "Enviar enlace"}
          </PrimaryButton>
          <TertiaryButton asChild>
            <Link href={authHref("/login", next)}>
              <LogIn aria-hidden="true" className="h-4 w-4" />
              Volver
            </Link>
          </TertiaryButton>
        </div>
      </form>
    </AuthPageShell>
  );
}

export default function ForgotPasswordPage() {
  return (
    <Suspense fallback={null}>
      <ForgotPasswordForm />
    </Suspense>
  );
}
