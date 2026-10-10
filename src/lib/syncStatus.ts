// Visible save state of one entity (B5, roadmap step 15, audit H9).
// One label per real result, the same on Semana, Compra, Despensa and Perfil:
// - «Solo en este dispositivo»: guest data; there is no account to save it to.
// - «Guardando…» / «Comprobando tu cuenta…»: a write or a read of the account is on its way.
// - «Guardado en tu cuenta»: the account confirmed what is shown.
// - «Pendiente de sincronizar»: a change made here is not in the account yet. «Reintentar» resends
//   only that change (never a new AI call); it is also resent when the connection comes back.
// - «Error: reintentar»: the account could not be read; the device copy is shown.
// Nothing reads «Guardado en tu cuenta» until the account has answered.

export type SyncStatusKind = "device" | "saving" | "checking" | "saved" | "pending" | "error";

export type SyncStatusInput = {
  signedIn: boolean;
  // A write to the account is on its way.
  saving?: boolean;
  // The account has not answered the first read yet.
  checking?: boolean;
  // The last read could not reach the account (device copy shown).
  offline?: boolean;
  // Something on this device is not in the account yet.
  pending?: boolean;
};

export type SyncStatusView = {
  kind: SyncStatusKind;
  label: string;
  detail: string | null;
  canRetry: boolean;
};

export const syncStatusLabels: Record<SyncStatusKind, string> = {
  device: "Solo en este dispositivo",
  saving: "Guardando…",
  checking: "Comprobando tu cuenta…",
  saved: "Guardado en tu cuenta",
  pending: "Pendiente de sincronizar",
  error: "Error: reintentar",
};

export const syncStatusDetails = {
  pending:
    "Hay cambios en este dispositivo que tu cuenta aún no tiene. Se envían al pulsar «Reintentar» o al recuperar la conexión.",
  error: "No se ha podido comprobar tu cuenta: se muestra la copia de este dispositivo.",
} as const;

export function syncStatus({ signedIn, saving, checking, offline, pending }: SyncStatusInput): SyncStatusView {
  const view = (kind: SyncStatusKind, detail: string | null = null, canRetry = false) => ({
    kind,
    label: syncStatusLabels[kind],
    detail,
    canRetry,
  });

  if (!signedIn) return view("device");
  if (saving) return view("saving");
  if (pending) return view("pending", syncStatusDetails.pending, true);
  if (offline) return view("error", syncStatusDetails.error, true);
  if (checking) return view("checking");
  return view("saved");
}
