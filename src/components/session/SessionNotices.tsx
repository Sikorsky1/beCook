"use client";

import { LogIn } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";

import { PrimaryButton, SecondaryButton } from "@/components/ui/Button";
import { StateMessage } from "@/components/ui/StateMessage";
import { useIdentity, useIdentityActions } from "@/components/session/IdentityProvider";
import {
  declineLegacyImport,
  hasPendingLegacyData,
  importLegacyData,
  type LegacyImportResult,
} from "@/lib/data/legacy-import";
import { loginHrefFor } from "@/lib/navigation";

function describeResult(result: LegacyImportResult) {
  const parts: string[] = [];
  if (result.imported.length) parts.push(`${result.imported.length} añadido(s) a tu cuenta`);
  if (result.keptInAccount.length) {
    parts.push(`${result.keptInAccount.length} ya existía(n) en tu cuenta y se han conservado; la copia del dispositivo sigue como invitado`);
  }
  if (result.failed.length) parts.push(`${result.failed.length} no se pudo(pudieron) añadir; puedes volver a intentarlo`);
  return parts.join(" · ") || "No había nada que añadir.";
}

export function SessionNotices() {
  const identity = useIdentity();
  const { dismissExpiredNotice, refresh } = useIdentityActions();
  const pathname = usePathname();
  const [legacyOffer, setLegacyOffer] = useState(false);
  const [importStatus, setImportStatus] = useState<"idle" | "working">("idle");
  const [importMessage, setImportMessage] = useState("");

  useEffect(() => {
    // Re-evaluated on every identity change; guests are never asked.
    const offer = identity.status === "ready" && identity.userId !== null && hasPendingLegacyData();
    const timer = window.setTimeout(() => setLegacyOffer(offer), 0);
    return () => window.clearTimeout(timer);
  }, [identity.status, identity.userId, identity.epoch]);

  useEffect(() => {
    // A result message belongs to the user who imported; it goes away with that user.
    const timer = window.setTimeout(() => setImportMessage(""), 0);
    return () => window.clearTimeout(timer);
  }, [identity.userId]);

  if (identity.status !== "ready") return null;

  return (
    <div className="mx-auto w-full max-w-3xl space-y-3 px-3 pt-3 empty:hidden sm:px-6">
      {identity.sessionExpired ? (
        <StateMessage
          className="mt-0"
          title="Tu sesión ha caducado."
          action={
            <div className="flex flex-wrap gap-2">
              <PrimaryButton asChild size="md">
                <Link href={loginHrefFor(pathname || "/week")}>
                  <LogIn aria-hidden="true" className="h-4 w-4" />
                  Iniciar sesión
                </Link>
              </PrimaryButton>
              <SecondaryButton size="md" onClick={dismissExpiredNotice}>
                Seguir sin cuenta
              </SecondaryButton>
            </div>
          }
        >
          <p>Ahora ves los datos de este dispositivo sin cuenta. Los de tu cuenta siguen guardados y volverán al iniciar sesión.</p>
        </StateMessage>
      ) : null}

      {legacyOffer ? (
        <StateMessage
          className="mt-0"
          title="Tienes datos guardados en este dispositivo. ¿Quieres añadirlos a tu cuenta?"
          action={
            <div className="flex flex-wrap gap-2">
              <PrimaryButton
                size="md"
                disabled={importStatus === "working"}
                onClick={async () => {
                  setImportStatus("working");
                  const result = await importLegacyData({ scope: identity.scope, userId: identity.userId });
                  setImportStatus("idle");
                  setImportMessage(describeResult(result));
                  setLegacyOffer(hasPendingLegacyData());
                  if (result.imported.length > 0) refresh();
                }}
              >
                {importStatus === "working" ? "Añadiendo…" : "Añadir a mi cuenta"}
              </PrimaryButton>
              <SecondaryButton
                size="md"
                disabled={importStatus === "working"}
                onClick={() => {
                  declineLegacyImport();
                  setLegacyOffer(false);
                  setImportMessage("Los datos se quedan en este dispositivo, disponibles sin iniciar sesión.");
                }}
              >
                No, dejarlos en este dispositivo
              </SecondaryButton>
            </div>
          }
        >
          <p>Son datos de antes de iniciar sesión. Solo se añade lo que tu cuenta todavía no tiene; nada de tu cuenta se sobrescribe.</p>
        </StateMessage>
      ) : null}

      {importMessage ? (
        <StateMessage className="mt-0" title="Datos del dispositivo" variant="success">
          <p>{importMessage}</p>
        </StateMessage>
      ) : null}
    </div>
  );
}
