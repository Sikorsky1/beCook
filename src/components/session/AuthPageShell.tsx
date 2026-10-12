"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import type { ReactNode } from "react";
import { useSyncExternalStore } from "react";

import { Card } from "@/components/ui/Card";
import { readAuthLinkError } from "@/lib/auth/account";
import { safeNextPath } from "@/lib/navigation";
import { pageShellClass } from "@/lib/ui";

// Requested destination from ?next= (already validated); null when there is none.
export function useNextParam() {
  const searchParams = useSearchParams();
  return safeNextPath(searchParams.get("next"), "") || null;
}

const noSubscription = () => () => {};

// A failed email link leaves its error in the address; a primitive keeps the snapshot stable.
export function useAuthLinkErrorMessage() {
  return useSyncExternalStore(
    noSubscription,
    () => readAuthLinkError(window.location.href)?.message ?? "",
    () => "",
  );
}

type AuthPageShellProps = {
  title: string;
  lede?: ReactNode;
  children: ReactNode;
  // Where "Seguir sin iniciar sesión" goes; omitted on screens that need the account.
  guestHref?: string;
};

export function AuthPageShell({ title, lede, children, guestHref }: AuthPageShellProps) {
  return (
    <main className={pageShellClass}>
      <div className="mx-auto flex w-full max-w-md flex-col gap-5 sm:gap-6">
        <section>
          <p className="t-eyebrow">Tu cuenta beCook</p>
          <h1 className="mt-2 text-2xl font-semibold text-[color:var(--color-foreground)] sm:text-3xl">
            {title}
          </h1>
          {lede ? (
            <div className="mt-2 space-y-2 text-sm font-medium leading-6 text-[color:var(--color-muted-foreground)]">
              {lede}
            </div>
          ) : null}
        </section>

        <Card className="space-y-4 p-4 sm:p-5">{children}</Card>

        {guestHref ? (
          <div className="space-y-1 text-center">
            <Link
              href={guestHref}
              className="inline-flex min-h-11 items-center text-sm font-semibold text-[color:var(--color-muted-foreground)] underline-offset-4 hover:text-[color:var(--color-foreground)] hover:underline"
            >
              Seguir sin iniciar sesión
            </Link>
            <p className="t-meta leading-5">
              Sin cuenta, beCook funciona igual, pero lo que hagas se queda solo en este dispositivo.
            </p>
          </div>
        ) : null}
      </div>
    </main>
  );
}

export function FormError({ children }: { children: ReactNode }) {
  return (
    <p
      role="alert"
      className="rounded-[var(--radius-control)] border border-[color:var(--color-danger-soft)] bg-[color:var(--color-danger-soft)] px-3 py-2 text-sm font-semibold text-[color:var(--color-danger)]"
    >
      {children}
    </p>
  );
}

export function FormNotice({ children }: { children: ReactNode }) {
  return (
    <div
      role="status"
      className="rounded-[var(--radius-control)] border border-[color:var(--color-secondary-soft)] bg-[color:var(--color-secondary-soft)] px-3 py-2 text-sm font-semibold leading-6 text-[color:var(--color-secondary-hover)]"
    >
      {children}
    </div>
  );
}

export function FieldLabel({ children, htmlFor }: { children: ReactNode; htmlFor: string }) {
  return (
    <label
      htmlFor={htmlFor}
      className="block text-sm font-semibold text-[color:var(--color-foreground)]"
    >
      {children}
    </label>
  );
}

export const authTextLinkClass =
  "font-semibold text-[color:var(--color-foreground)] underline underline-offset-4 hover:text-[color:var(--color-accent-hover)]";

// Under the account forms (/login, /signup): where the legal texts are.
export function LegalNotice() {
  return (
    <p className="t-meta leading-5">
      Consulta la <Link href="/privacidad" className={authTextLinkClass}>política de privacidad</Link> y las{" "}
      <Link href="/condiciones" className={authTextLinkClass}>condiciones de uso</Link>.
    </p>
  );
}
