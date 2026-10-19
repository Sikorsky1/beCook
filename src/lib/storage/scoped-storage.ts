// Local data is always stored under an identity scope: `guest` or one user.
// Key format: becook:<scope>:<entity>[:<week>]. Values carry a format version.

export type StorageScope = "guest" | `u_${string}`;

export type ScopedEntity =
  | "profile"
  | "pantry"
  | "week"
  | "selected-week"
  | "shopping"
  | "legacy-origin"
  // B5: a proposed menu not applied yet, per week (never pending: it is not account data).
  | "menu-proposal"
  // C6: the Crear menú form (pasted text and preferences), per week, until the menu is saved.
  | "menu-draft"
  // A nutritionist's plan applied to a week: what its breakfasts, mid-mornings and snacks need, until
  // it is in the week's shopping list (as items added by hand).
  | "plan-extras"
  // The breakfasts, mid-mornings and snacks of a week, day by day (copy of week_daily_meals).
  | "daily-meals";

export const STORAGE_FORMAT_VERSION = 1;

export type StoredEnvelope<T> = {
  v: typeof STORAGE_FORMAT_VERSION;
  data: T;
  savedAt: string;
  // Remote updated_at the local copy is based on (null: never synced / guest).
  remoteVersion: string | null;
  // Local change not yet accepted by the server (authenticated scopes only).
  pending: boolean;
};

export function scopeForUser(userId: string | null | undefined): StorageScope {
  return userId ? `u_${userId}` : "guest";
}

export function userIdFromScope(scope: StorageScope): string | null {
  return scope === "guest" ? null : scope.slice(2);
}

export function scopedKey(scope: StorageScope, entity: ScopedEntity, week?: string) {
  return week ? `becook:${scope}:${entity}:${week}` : `becook:${scope}:${entity}`;
}

function storage(): Storage | null {
  try {
    return typeof window === "undefined" ? null : window.localStorage;
  } catch {
    return null;
  }
}

export function readEnvelope<T>(
  scope: StorageScope,
  entity: ScopedEntity,
  week?: string,
): StoredEnvelope<T> | null {
  const raw = storage()?.getItem(scopedKey(scope, entity, week));
  if (!raw) return null;
  try {
    const value = JSON.parse(raw) as Partial<StoredEnvelope<T>>;
    if (value?.v !== STORAGE_FORMAT_VERSION || !("data" in value)) return null;
    return {
      v: STORAGE_FORMAT_VERSION,
      data: value.data as T,
      savedAt: typeof value.savedAt === "string" ? value.savedAt : new Date(0).toISOString(),
      remoteVersion: typeof value.remoteVersion === "string" ? value.remoteVersion : null,
      pending: value.pending === true,
    };
  } catch {
    return null;
  }
}

export function readScoped<T>(scope: StorageScope, entity: ScopedEntity, week?: string): T | null {
  return readEnvelope<T>(scope, entity, week)?.data ?? null;
}

export function writeScoped<T>(
  scope: StorageScope,
  entity: ScopedEntity,
  data: T,
  {
    week,
    remoteVersion = null,
    pending = false,
  }: { week?: string; remoteVersion?: string | null; pending?: boolean } = {},
) {
  const envelope: StoredEnvelope<T> = {
    v: STORAGE_FORMAT_VERSION,
    data,
    savedAt: new Date().toISOString(),
    remoteVersion,
    // Guests have nothing to sync, so their data is never "pending".
    pending: scope === "guest" ? false : pending,
  };
  storage()?.setItem(scopedKey(scope, entity, week), JSON.stringify(envelope));
}

export function removeScoped(scope: StorageScope, entity: ScopedEntity, week?: string) {
  storage()?.removeItem(scopedKey(scope, entity, week));
}

function keysOfScope(scope: StorageScope) {
  const store = storage();
  if (!store) return [];
  const prefix = `becook:${scope}:`;
  const keys: string[] = [];
  for (let index = 0; index < store.length; index++) {
    const key = store.key(index);
    if (key?.startsWith(prefix)) keys.push(key);
  }
  return keys;
}

// Weeks stored for a scope, as YYYY-Www ids.
export function listScopedWeeks(
  scope: StorageScope,
  entity: "week" | "shopping" | "menu-proposal" | "menu-draft" = "week",
) {
  const prefix = `becook:${scope}:${entity}:`;
  return keysOfScope(scope)
    .filter((key) => key.startsWith(prefix))
    .map((key) => key.slice(prefix.length));
}

export function scopeHasPendingChanges(scope: StorageScope) {
  const store = storage();
  if (!store || scope === "guest") return false;
  return keysOfScope(scope).some((key) => {
    try {
      return (JSON.parse(store.getItem(key) ?? "null") as { pending?: boolean } | null)?.pending === true;
    } catch {
      return false;
    }
  });
}

// Explicit sign-out: the account is the source of truth, so its device cache is dropped.
export function clearScope(scope: StorageScope) {
  const store = storage();
  if (!store || scope === "guest") return;
  for (const key of keysOfScope(scope)) store.removeItem(key);
}
