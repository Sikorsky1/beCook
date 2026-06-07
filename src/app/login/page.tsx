"use client";

import { LogIn, UserPlus } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { FormEvent } from "react";
import { useEffect, useState } from "react";

import { PrimaryButton, TertiaryButton } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { TextInput } from "@/components/ui/TextInput";
import { getCurrentUser, signIn } from "@/lib/supabase/auth";
import { pageContentClass, pageShellClass } from "@/lib/ui";

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [message, setMessage] = useState("");
  const [errorMessage, setErrorMessage] = useState("");

  useEffect(() => {
    let isCancelled = false;

    void getCurrentUser().then((user) => {
      if (!user || isCancelled) {
        return;
      }

      setMessage(`Sesión iniciada como ${user.email ?? "usuario"}.`);
    });

    return () => {
      isCancelled = true;
    };
  }, []);

  async function handleSignIn() {
    const trimmedEmail = email.trim();

    if (!trimmedEmail || !password) {
      setErrorMessage("Introduce email y contraseña.");
      return;
    }

    setIsSubmitting(true);
    setErrorMessage("");
    setMessage("");

    try {
      await signIn(trimmedEmail, password);
      const currentUser = await getCurrentUser();

      setMessage("Sesión iniciada.");

      if (currentUser) {
        router.push("/profile");
        router.refresh();
      }
    } catch (error: unknown) {
      setErrorMessage(
        error instanceof Error
          ? error.message
          : "No se pudo completar la autenticación.",
      );
    } finally {
      setIsSubmitting(false);
    }
  }

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    void handleSignIn();
  };

  return (
    <main className={pageShellClass}>
      <div className={`${pageContentClass} gap-5 sm:gap-6`}>
        <section>
          <p className="ui-eyebrow text-[0.78rem]">Cuenta beCook</p>
          <h1 className="mt-2 text-2xl font-semibold text-[color:var(--color-foreground)] sm:text-3xl">
            Guarda tus planes cuando quieras
          </h1>
          <p className="mt-2 text-sm font-medium leading-6 text-[color:var(--color-muted-foreground)]">
            Puedes iniciar sesión para asociar lo nuevo a tu cuenta. Si no,
            beCook sigue funcionando en este dispositivo.
          </p>
        </section>

        <Card className="space-y-4 p-4 sm:p-5">
          <form onSubmit={handleSubmit} className="space-y-3">
            <label className="block space-y-1.5">
              <span className="text-[0.78rem] font-semibold text-[color:var(--color-foreground)]">
                Email
              </span>
              <TextInput
                type="email"
                autoComplete="email"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                placeholder="tu@email.com"
                required
              />
            </label>

            <label className="block space-y-1.5">
              <span className="text-[0.78rem] font-semibold text-[color:var(--color-foreground)]">
                Contraseña
              </span>
              <TextInput
                type="password"
                autoComplete="current-password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                placeholder="Mínimo 6 caracteres"
                required
              />
            </label>

            {errorMessage ? (
              <p className="rounded-[1rem] border border-[color:var(--color-danger-soft)] bg-[color:var(--color-danger-soft)] px-3 py-2 text-sm font-semibold text-[color:var(--color-danger)]">
                {errorMessage}
              </p>
            ) : null}

            {message ? (
              <p className="rounded-[1rem] border border-[color:var(--color-secondary-soft)] bg-[color:var(--color-secondary-soft)] px-3 py-2 text-sm font-semibold text-[color:var(--color-secondary-hover)]">
                {message}
              </p>
            ) : null}

            <div className="grid gap-2 sm:grid-cols-2">
              <PrimaryButton
                type="submit"
                disabled={isSubmitting}
                className="w-full"
              >
                <LogIn aria-hidden="true" className="h-4 w-4" />
                Entrar
              </PrimaryButton>
              <Link
                href="/signup"
                className="inline-flex min-h-12 touch-manipulation items-center justify-center gap-2 rounded-2xl border border-[color:var(--color-border)] bg-[color:var(--color-surface)] px-5 text-sm font-semibold text-[color:var(--color-foreground)] shadow-[0_8px_22px_rgba(46,42,38,0.04)] transition-[background-color,border-color,color,box-shadow,transform,opacity] duration-200 ease-out hover:-translate-y-0.5 hover:bg-[color:var(--color-surface-muted)] hover:shadow-[0_12px_28px_rgba(217,184,121,0.14)] active:translate-y-0 active:scale-[0.98] motion-reduce:transition-none motion-reduce:hover:translate-y-0 motion-reduce:active:scale-100"
              >
                <UserPlus aria-hidden="true" className="h-4 w-4" />
                Crear cuenta
              </Link>
            </div>
          </form>
        </Card>

        <Link
          href="/week"
          className="text-center text-sm font-semibold text-[color:var(--color-muted-foreground)] underline-offset-4 hover:text-[color:var(--color-foreground)] hover:underline"
        >
          Seguir sin iniciar sesión
        </Link>
      </div>
    </main>
  );
}
