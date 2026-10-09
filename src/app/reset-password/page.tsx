"use client";

import { ArrowRight, CheckCircle2 } from "lucide-react";
import Link from "next/link";
import type { FormEvent } from "react";
import { Suspense, useState } from "react";

import {
  AuthPageShell,
  FieldLabel,
  FormError,
  useAuthLinkErrorMessage,
  useNextParam,
} from "@/components/session/AuthPageShell";
import { useIdentity } from "@/components/session/IdentityProvider";
import { PrimaryButton, SecondaryButton } from "@/components/ui/Button";
import { TextInput } from "@/components/ui/TextInput";
import { newPasswordMinLength, updatePassword } from "@/lib/auth/account";
import { authHref, defaultAfterLoginPath } from "@/lib/navigation";
import { supabase } from "@/lib/supabase/client";

function ResetPasswordForm() {
  const identity = useIdentity();
  const next = useNextParam();
  const linkError = useAuthLinkErrorMessage();
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState("");
  const [done, setDone] = useState(false);

  async function handleUpdate() {
    setIsSubmitting(true);
    setErrorMessage("");
    const result = await updatePassword(supabase, { password, confirmation: confirmPassword });
    setIsSubmitting(false);
    if (result.ok) {
      setDone(true);
      setPassword("");
      setConfirmPassword("");
    } else {
      setErrorMessage(result.message);
    }
  }

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    void handleUpdate();
  };

  if (identity.status !== "ready") {
    return (
      <AuthPageShell title="Comprobando el enlace…">
        <p className="text-sm text-[color:var(--color-muted-foreground)]" role="status">Un momento.</p>
      </AuthPageShell>
    );
  }

  if (done) {
    return (
      <AuthPageShell title="Contraseña cambiada">
        <div className="flex gap-3" role="status">
          <CheckCircle2 aria-hidden="true" className="mt-0.5 h-5 w-5 shrink-0 text-[color:var(--color-success-hover)]" />
          <p className="text-sm leading-6 text-[color:var(--color-foreground)]">
            Ya puedes usar tu contraseña nueva en todos tus dispositivos. Has iniciado sesión en este.
          </p>
        </div>
        <PrimaryButton asChild className="w-full">
          <Link href={next ?? defaultAfterLoginPath} replace>
            Continuar
            <ArrowRight aria-hidden="true" className="h-4 w-4" />
          </Link>
        </PrimaryButton>
      </AuthPageShell>
    );
  }

  if (linkError || !identity.userId) {
    return (
      <AuthPageShell title="Este enlace ya no sirve" guestHref={next ?? "/week"}>
        <FormError>
          {linkError || "El enlace no es válido, ha caducado o ya se ha usado. Pide uno nuevo."}
        </FormError>
        <div className="grid gap-2 sm:grid-cols-2">
          <PrimaryButton asChild>
            <Link href={authHref("/forgot-password", next)}>Pedir otro enlace</Link>
          </PrimaryButton>
          <SecondaryButton asChild>
            <Link href={authHref("/login", next)}>Iniciar sesión</Link>
          </SecondaryButton>
        </div>
      </AuthPageShell>
    );
  }

  return (
    <AuthPageShell
      title="Crea una contraseña nueva"
      lede={
        <p>
          Para <strong className="break-all text-[color:var(--color-foreground)]">{identity.email ?? "tu cuenta"}</strong>.
          La usarás a partir de ahora en todos tus dispositivos.
        </p>
      }
    >
      <form onSubmit={handleSubmit} className="space-y-3" noValidate>
        {/* Lets password managers attach the new password to the right account. */}
        <input type="email" name="email" autoComplete="username" value={identity.email ?? ""} readOnly hidden />
        <div className="space-y-1.5">
          <FieldLabel htmlFor="reset-password">Contraseña nueva</FieldLabel>
          <TextInput
            id="reset-password"
            type="password"
            autoComplete="new-password"
            minLength={newPasswordMinLength}
            aria-describedby="reset-password-hint"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            required
          />
          <p id="reset-password-hint" className="text-xs text-[color:var(--color-muted-foreground)]">
            Al menos {newPasswordMinLength} caracteres.
          </p>
        </div>
        <div className="space-y-1.5">
          <FieldLabel htmlFor="reset-confirm">Repite la contraseña</FieldLabel>
          <TextInput
            id="reset-confirm"
            type="password"
            autoComplete="new-password"
            value={confirmPassword}
            onChange={(event) => setConfirmPassword(event.target.value)}
            required
          />
        </div>

        {errorMessage ? <FormError>{errorMessage}</FormError> : null}

        <PrimaryButton type="submit" disabled={isSubmitting} className="w-full">
          {isSubmitting ? "Guardando…" : "Guardar contraseña"}
        </PrimaryButton>
      </form>
    </AuthPageShell>
  );
}

export default function ResetPasswordPage() {
  return (
    <Suspense fallback={null}>
      <ResetPasswordForm />
    </Suspense>
  );
}
