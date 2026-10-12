// P37: «Tus datos» in the browser. Export and deletion go through /api/account/* with the session
// token; after a deletion this device forgets that identity (its scoped cache and the drafts in
// sessionStorage) and leaves a one-time notice for the next screen.
import type { StorageScope } from "@/lib/storage/scoped-storage";

export const DELETE_CONFIRMATION_WORD = "ELIMINAR";
export const ACCOUNT_DELETED_FLAG = "becook-account-deleted";

type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;
type Options = { getToken: () => Promise<string | null>; fetchImpl?: FetchLike };

export type ExportResult = { ok: true; blob: Blob; fileName: string } | { ok: false; message: string; status: number | null };
export type DeleteResult = { ok: true } | { ok: false; message: string; status: number | null };

const offline = "No hemos podido conectar. Revisa tu conexión e inténtalo de nuevo.";
const expired = "Tu sesión ha caducado. Vuelve a iniciar sesión para continuar.";

export function isDeleteConfirmation(value: string) {
  return value.trim() === DELETE_CONFIRMATION_WORD;
}

async function serverMessage(response: Response, fallback: string) {
  try {
    const body = (await response.json()) as { error?: unknown };
    return typeof body.error === "string" && body.error.trim() ? body.error : fallback;
  } catch {
    return fallback;
  }
}

function fileNameFrom(response: Response) {
  const match = /filename="([^"]+)"/.exec(response.headers.get("content-disposition") ?? "");
  return match?.[1] ?? `becook-datos-${new Date().toISOString().slice(0, 10)}.json`;
}

export async function requestAccountExport({ getToken, fetchImpl = fetch }: Options): Promise<ExportResult> {
  const token = await getToken().catch(() => null);
  if (!token) return { ok: false, message: expired, status: 401 };
  let response: Response;
  try {
    response = await fetchImpl("/api/account/export", { method: "GET", headers: { authorization: `Bearer ${token}` }, cache: "no-store" });
  } catch {
    return { ok: false, message: offline, status: null };
  }
  if (!response.ok) {
    const fallback = response.status === 401 ? expired : "No hemos podido preparar la copia de tus datos. Inténtalo de nuevo.";
    return { ok: false, message: await serverMessage(response, fallback), status: response.status };
  }
  return { ok: true, blob: await response.blob(), fileName: fileNameFrom(response) };
}

export async function requestAccountDeletion({ getToken, fetchImpl = fetch, confirmation }: Options & { confirmation: string }): Promise<DeleteResult> {
  if (!isDeleteConfirmation(confirmation)) {
    return { ok: false, message: `Escribe ${DELETE_CONFIRMATION_WORD} para confirmar.`, status: null };
  }
  const token = await getToken().catch(() => null);
  if (!token) return { ok: false, message: expired, status: 401 };
  let response: Response;
  try {
    response = await fetchImpl("/api/account/delete", {
      method: "POST",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify({ confirmation: DELETE_CONFIRMATION_WORD }),
      cache: "no-store",
    });
  } catch {
    return { ok: false, message: offline, status: null };
  }
  if (!response.ok) {
    const fallback = response.status === 401 ? expired : "No hemos podido eliminar la cuenta. Inténtalo de nuevo más tarde.";
    return { ok: false, message: await serverMessage(response, fallback), status: response.status };
  }
  return { ok: true };
}

type DeviceStores = { local: Storage | null; session: Storage | null };

function browserStores(): DeviceStores {
  const read = (name: "localStorage" | "sessionStorage") => {
    try {
      return typeof window === "undefined" ? null : window[name];
    } catch {
      return null;
    }
  };
  return { local: read("localStorage"), session: read("sessionStorage") };
}

function keysOf(store: Storage, keep: (key: string) => boolean) {
  const keys: string[] = [];
  for (let index = 0; index < store.length; index++) {
    const key = store.key(index);
    if (key && keep(key)) keys.push(key);
  }
  return keys;
}

// After the account is gone: that identity's cache on this device, and the drafts and markers kept
// for the tab (Crear menú, onboarding), are removed. Guest data on the device is left alone.
export function clearDeviceDataAfterDeletion(scope: StorageScope, stores: DeviceStores = browserStores()) {
  try {
    if (stores.local && scope !== "guest") {
      for (const key of keysOf(stores.local, (key) => key.startsWith(`becook:${scope}:`))) stores.local.removeItem(key);
    }
    if (stores.session) {
      for (const key of keysOf(stores.session, (key) => key.startsWith("becook"))) stores.session.removeItem(key);
      stores.session.setItem(ACCOUNT_DELETED_FLAG, "1");
    }
  } catch {
    // Storage blocked: nothing else to clean on this device.
  }
}

// One-time notice: true once after a deletion, then forgotten.
export function consumeAccountDeletedNotice(session: Storage | null = browserStores().session) {
  try {
    if (session?.getItem(ACCOUNT_DELETED_FLAG) !== "1") return false;
    session.removeItem(ACCOUNT_DELETED_FLAG);
    return true;
  } catch {
    return false;
  }
}

export function saveBlob(blob: Blob, fileName: string) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = fileName;
  link.rel = "noopener";
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 30_000);
}
