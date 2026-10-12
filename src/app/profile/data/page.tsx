"use client";

import { ArrowLeft, Download, LogIn, Trash2 } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { FormEvent } from "react";
import { useEffect, useRef, useState } from "react";

import { useIdentity, useIdentityActions } from "@/components/session/IdentityProvider";
import { Button, PrimaryButton, TertiaryButton } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { TextInput } from "@/components/ui/TextInput";
import {
  DELETE_CONFIRMATION_WORD,
  clearDeviceDataAfterDeletion,
  isDeleteConfirmation,
  requestAccountDeletion,
  requestAccountExport,
  saveBlob,
} from "@/lib/account/client";
import { signInMethodLabels } from "@/lib/auth/account";
import { loginHrefFor } from "@/lib/navigation";
import { supabase } from "@/lib/supabase/client";
import { getAccessToken } from "@/lib/supabase/auth";
import { pageShellClass } from "@/lib/ui";

type Notice = { kind: "status" | "error"; text: string } | null;

// A persistent polite region for progress and results; errors are alerts (and take the focus).
function Notices({ notice }: { notice: Notice }) {
  return (
    <>
      <div role="status" aria-live="polite" aria-atomic="true">
        {notice?.kind === "status" ? (
          <p className="rounded-[var(--radius-control)] border border-[color:var(--color-secondary-soft)] bg-[color:var(--color-secondary-soft)] px-3 py-2 text-sm font-semibold leading-6 text-[color:var(--color-secondary-hover)]">
            {notice.text}
          </p>
        ) : null}
      </div>
      {notice?.kind === "error" ? (
        <p
          role="alert"
          tabIndex={-1}
          className="rounded-[var(--radius-control)] border border-[color:var(--color-danger-soft)] bg-[color:var(--color-danger-soft)] px-3 py-2 text-sm font-semibold leading-6 text-[color:var(--color-danger)] outline-none"
        >
          {notice.text}
        </p>
      ) : null}
    </>
  );
}

export default function AccountDataPage() {
  const identity = useIdentity();
  const { signOut } = useIdentityActions();
  const router = useRouter();
  const [exporting, setExporting] = useState(false);
  const [exportNotice, setExportNotice] = useState<Notice>(null);
  const [confirmation, setConfirmation] = useState("");
  const [deleting, setDeleting] = useState(false);
  const [deleteNotice, setDeleteNotice] = useState<Notice>(null);
  const deleteNoticeRef = useRef<HTMLDivElement>(null);
  const [signInMethods, setSignInMethods] = useState<{ userId: string; labels: string[] } | null>(null);

  // How this account signs in (email, Google, Apple), from the session kept on this device.
  useEffect(() => {
    if (!identity.userId || !supabase) return;
    let active = true;
    void supabase.auth.getSession().then(({ data }) => {
      const user = data.session?.user;
      if (active && user) setSignInMethods({ userId: user.id, labels: signInMethodLabels(user.identities) });
    });
    return () => {
      active = false;
    };
  }, [identity.userId]);
  const methods = signInMethods?.userId === identity.userId ? signInMethods.labels : [];

  // A failed deletion moves the focus to its explanation.
  useEffect(() => {
    if (deleteNotice?.kind === "error") deleteNoticeRef.current?.querySelector<HTMLElement>("[role=alert]")?.focus();
  }, [deleteNotice]);

  async function handleExport() {
    setExporting(true);
    setExportNotice({ kind: "status", text: "Preparando la copia de tus datos…" });
    const result = await requestAccountExport({ getToken: getAccessToken });
    setExporting(false);
    if (!result.ok) {
      setExportNotice({ kind: "error", text: result.message });
      return;
    }
    saveBlob(result.blob, result.fileName);
    setExportNotice({ kind: "status", text: `Descarga lista: ${result.fileName}. Guárdala en un lugar seguro.` });
  }

  async function handleDelete(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (deleting) return;
    if (!isDeleteConfirmation(confirmation)) {
      setDeleteNotice({ kind: "error", text: `Escribe ${DELETE_CONFIRMATION_WORD} en mayúsculas para confirmar.` });
      return;
    }
    setDeleting(true);
    setDeleteNotice({ kind: "status", text: "Eliminando tu cuenta…" });
    const scope = identity.scope;
    const result = await requestAccountDeletion({ getToken: getAccessToken, confirmation });
    if (!result.ok) {
      setDeleting(false);
      setDeleteNotice({ kind: "error", text: result.message });
      return;
    }
    // The account no longer exists: this device forgets the session and its copy of the data.
    await signOut({ localOnly: true }).catch(() => undefined);
    clearDeviceDataAfterDeletion(scope);
    router.replace("/week");
  }

  const signedIn = identity.status === "ready" && identity.userId !== null;
  const confirmed = isDeleteConfirmation(confirmation);

  return (
    <main className={pageShellClass}>
      <div className="mx-auto flex w-full max-w-2xl flex-col gap-5 sm:gap-6">
        <section>
          <Link
            href="/profile"
            className="-ml-2 inline-flex min-h-11 items-center gap-1.5 rounded-full px-2 text-sm font-semibold text-[color:var(--color-muted-foreground)] hover:text-[color:var(--color-foreground)]"
          >
            <ArrowLeft aria-hidden="true" className="h-4 w-4" />
            Perfil
          </Link>
          <h1 className="t-h1 mt-2 text-[color:var(--color-foreground)]">Tus datos</h1>
          <p className="t-body mt-2 text-[color:var(--color-muted-foreground)]">
            Descarga una copia de todo lo que guarda tu cuenta o elimina la cuenta con todos sus datos.
          </p>
        </section>

        {identity.status !== "ready" ? (
          <p role="status" className="t-meta">
            Cargando tu cuenta…
          </p>
        ) : !signedIn ? (
          <Card className="space-y-3 p-4 sm:p-5">
            <h2 className="t-h2 text-[color:var(--color-foreground)]">Sin cuenta</h2>
            <p className="t-body text-[color:var(--color-foreground)]">
              Sin iniciar sesión, lo que haces en beCook se guarda solo en este dispositivo y no llega a ningún servidor.
              Para descargar o eliminar los datos de una cuenta, inicia sesión.
            </p>
            <TertiaryButton asChild>
              <Link href={loginHrefFor("/profile/data")}>
                <LogIn aria-hidden="true" className="h-4 w-4" />
                Iniciar sesión
              </Link>
            </TertiaryButton>
          </Card>
        ) : (
          <>
            {methods.length ? (
              <p className="t-body text-[color:var(--color-foreground)]">
                Entras con: <strong className="font-semibold">{methods.join(" · ")}</strong>
              </p>
            ) : null}
            <Card className="space-y-3 p-4 sm:p-5" aria-labelledby="export-title">
              <h2 id="export-title" className="t-h2 text-[color:var(--color-foreground)]">
                Descargar tus datos
              </h2>
              <p className="t-body text-[color:var(--color-foreground)]">
                Un archivo JSON con tu cuenta (email y fechas), tu perfil, tus menús, tu lista de la compra, tu despensa,
                tus fichas de plato y el registro de tus peticiones de IA.
              </p>
              <PrimaryButton type="button" onClick={() => void handleExport()} disabled={exporting} aria-busy={exporting} className="w-full sm:w-auto">
                <Download aria-hidden="true" className="h-4 w-4" />
                {exporting ? "Preparando…" : "Descargar mis datos"}
              </PrimaryButton>
              <Notices notice={exportNotice} />
            </Card>

            <Card className="space-y-3 p-4 sm:p-5" aria-labelledby="delete-title">
              <h2 id="delete-title" className="t-h2 text-[color:var(--color-foreground)]">
                Eliminar tu cuenta
              </h2>
              <div id="delete-help" className="t-body space-y-2 text-[color:var(--color-foreground)]">
                <p>
                  Se borran al momento y para siempre tu cuenta, tu perfil (también alergias y dietas), tus menús, tu
                  compra, tu despensa y tus fichas. No se puede deshacer.
                </p>
                <p className="text-[color:var(--color-muted-foreground)]">
                  Si quieres conservar algo, descarga antes tus datos. Del registro de IA se queda solo el consumo, sin
                  relación con tu cuenta, y las copias de seguridad se borran cuando caducan.
                </p>
              </div>
              <form onSubmit={(event) => void handleDelete(event)} className="space-y-3" noValidate>
                <div className="space-y-1.5">
                  <label htmlFor="delete-confirmation" className="block text-sm font-semibold text-[color:var(--color-foreground)]">
                    Escribe {DELETE_CONFIRMATION_WORD} para confirmar
                  </label>
                  <TextInput
                    id="delete-confirmation"
                    value={confirmation}
                    onChange={(event) => setConfirmation(event.target.value)}
                    autoComplete="off"
                    autoCapitalize="characters"
                    autoCorrect="off"
                    spellCheck={false}
                    aria-describedby="delete-help"
                    aria-invalid={deleteNotice?.kind === "error" && !confirmed ? true : undefined}
                    disabled={deleting}
                  />
                </div>
                <Button type="submit" variant="danger" disabled={deleting || !confirmed} aria-busy={deleting} className="w-full sm:w-auto">
                  <Trash2 aria-hidden="true" className="h-4 w-4" />
                  {deleting ? "Eliminando…" : "Eliminar mi cuenta"}
                </Button>
                <div ref={deleteNoticeRef} className="space-y-2">
                  <Notices notice={deleteNotice} />
                </div>
              </form>
            </Card>
          </>
        )}
      </div>
    </main>
  );
}
