// Cache-then-revalidate for authenticated users; local-only for guests.
// Conflict policy (B1, approved): the remote copy is canonical.
// - A local change is written first as `pending`, tagged with the remote version it was based on.
// - On revalidation, pending data is pushed only if the remote version is still that base.
//   If the remote changed meanwhile (another device), the remote wins and the pending change is dropped.
// - A save is refused the same way when the remote changed since the cached version.
// - Nothing is declared empty until the remote confirms it; a remote failure keeps the cache.
// - A remote with `checksVersion` (the week, B4) compares the base version itself, atomically with
//   the write, and throws RemoteConflictError instead of being checked by a separate read first.
import {
  readEnvelope,
  removeScoped,
  writeScoped,
  type ScopedEntity,
  type StorageScope,
} from "@/lib/storage/scoped-storage";

export type RemoteSnapshot<T> = { data: T | null; version: string | null };

// baseVersion: the remote version the data was based on · overwrite: the user chose to replace it.
export type PushContext = { baseVersion: string | null; overwrite: boolean };
// duplicate: the same request had already been applied; nothing was written this time.
export type PushResult = { version: string | null; duplicate?: boolean };

export class RemoteConflictError extends Error {
  constructor() {
    super("The account copy changed since this copy was loaded.");
    this.name = "RemoteConflictError";
  }
}

export type EntityRemote<T> = {
  fetch: () => Promise<RemoteSnapshot<T>>;
  // Persists data and returns the new remote version.
  push: (data: T, context: PushContext) => Promise<PushResult>;
  // The remote checks context.baseVersion in the same transaction as the write.
  checksVersion?: boolean;
};

export type LoadResult<T> = {
  data: T | null;
  // remote: confirmed by the server · cache: device copy (remote unreachable) · local: guest data.
  source: "remote" | "cache" | "local";
  offline: boolean;
  discardedLocalChanges: boolean;
  pending: boolean;
};

type Target = { scope: StorageScope; entity: ScopedEntity; week?: string };

export function readCached<T>({ scope, entity, week }: Target) {
  return readEnvelope<T>(scope, entity, week);
}

export async function loadEntity<T>(target: Target, remote: EntityRemote<T> | null): Promise<LoadResult<T>> {
  const cached = readEnvelope<T>(target.scope, target.entity, target.week);

  if (target.scope === "guest" || !remote) {
    return { data: cached?.data ?? null, source: "local", offline: false, discardedLocalChanges: false, pending: false };
  }

  let snapshot: RemoteSnapshot<T>;
  try {
    snapshot = await remote.fetch();
  } catch {
    return {
      data: cached?.data ?? null,
      source: "cache",
      offline: true,
      discardedLocalChanges: false,
      pending: cached?.pending ?? false,
    };
  }

  let discardedLocalChanges = false;
  if (cached?.pending) {
    if (snapshot.version === cached.remoteVersion) {
      const offlineResult = { data: cached.data, source: "cache", offline: true, discardedLocalChanges: false, pending: true } as const;
      try {
        const pushed = await remote.push(cached.data, { baseVersion: cached.remoteVersion, overwrite: false });
        if (!pushed.duplicate) {
          writeScoped(target.scope, target.entity, cached.data, { week: target.week, remoteVersion: pushed.version });
          return { data: cached.data, source: "remote", offline: false, discardedLocalChanges: false, pending: false };
        }
      } catch (error) {
        if (!(error instanceof RemoteConflictError)) return offlineResult;
        // Changed elsewhere between the read and the write: the remote wins.
        discardedLocalChanges = true;
      }
      // Already applied, or overtaken: show what the account has now.
      try {
        snapshot = await remote.fetch();
      } catch {
        return offlineResult;
      }
    } else {
      discardedLocalChanges = true;
    }
  }

  if (snapshot.data === null) {
    removeScoped(target.scope, target.entity, target.week);
    return { data: null, source: "remote", offline: false, discardedLocalChanges, pending: false };
  }

  writeScoped(target.scope, target.entity, snapshot.data, { week: target.week, remoteVersion: snapshot.version });
  return { data: snapshot.data, source: "remote", offline: false, discardedLocalChanges, pending: false };
}

export type SaveResult<T> =
  | { status: "local" }
  // duplicate: this same request had already been applied (double click, retried request).
  | { status: "synced"; duplicate?: boolean }
  | { status: "pending" }
  // The account changed elsewhere since this copy was loaded: the remote copy is now cached.
  | { status: "conflict"; remoteData: T | null };

// Saves of the same entity run one at a time so a device never conflicts with itself.
// A save overtaken by a newer one is skipped: the newer save carries the latest data.
const queues = new Map<string, Promise<unknown>>();
const latestSeq = new Map<string, number>();

function queueKey({ scope, entity, week }: Target) {
  return `${scope}|${entity}|${week ?? ""}`;
}

// `overwrite`: the user explicitly chose to replace the account copy (e.g. "replace this week?").
// `baseVersion`: the remote version the user saw, when read just before saving (else the cache's).
export async function saveEntity<T>(
  target: Target,
  data: T,
  remote: EntityRemote<T> | null,
  { overwrite = false, baseVersion: explicitBase }: { overwrite?: boolean; baseVersion?: string | null } = {},
): Promise<SaveResult<T>> {
  if (target.scope === "guest" || !remote) {
    writeScoped(target.scope, target.entity, data, { week: target.week });
    return { status: "local" };
  }

  const key = queueKey(target);
  const seq = (latestSeq.get(key) ?? 0) + 1;
  latestSeq.set(key, seq);
  // The device copy reflects the change immediately, marked pending on its current base version.
  const before = readEnvelope<T>(target.scope, target.entity, target.week);
  writeScoped(target.scope, target.entity, data, {
    week: target.week,
    remoteVersion: explicitBase !== undefined ? explicitBase : (before?.remoteVersion ?? null),
    pending: true,
  });

  const adoptRemote = (snapshot: RemoteSnapshot<T>): SaveResult<T> => {
    if (snapshot.data === null) removeScoped(target.scope, target.entity, target.week);
    else writeScoped(target.scope, target.entity, snapshot.data, { week: target.week, remoteVersion: snapshot.version });
    return { status: "conflict", remoteData: snapshot.data };
  };

  const run = async (): Promise<SaveResult<T>> => {
    if (latestSeq.get(key) !== seq) return { status: "synced" };
    const baseVersion = readEnvelope<T>(target.scope, target.entity, target.week)?.remoteVersion ?? null;
    try {
      if (!remote.checksVersion && !overwrite) {
        const snapshot = await remote.fetch();
        if (snapshot.version !== baseVersion && snapshot.data !== null) return adoptRemote(snapshot);
      }
      let pushed: PushResult;
      try {
        pushed = await remote.push(data, { baseVersion, overwrite });
      } catch (error) {
        if (!(error instanceof RemoteConflictError)) throw error;
        try {
          return adoptRemote(await remote.fetch());
        } catch {
          // The conflict is certain; the stale pending copy is discarded on the next load.
          return { status: "conflict", remoteData: null };
        }
      }
      const isLatest = latestSeq.get(key) === seq;
      if (pushed.duplicate && isLatest) {
        // Applied by an earlier identical request: cache what the account has now.
        const snapshot = await remote.fetch().catch(() => null);
        if (snapshot) {
          if (snapshot.data === null) removeScoped(target.scope, target.entity, target.week);
          else writeScoped(target.scope, target.entity, snapshot.data, { week: target.week, remoteVersion: snapshot.version });
          return { status: "synced", duplicate: true };
        }
      }
      const current = readEnvelope<T>(target.scope, target.entity, target.week);
      writeScoped(target.scope, target.entity, isLatest ? data : (current?.data ?? data), {
        week: target.week,
        remoteVersion: pushed.version,
        pending: !isLatest,
      });
      return pushed.duplicate ? { status: "synced", duplicate: true } : { status: "synced" };
    } catch (error: unknown) {
      console.warn(`No se pudo guardar ${target.entity} en la cuenta; queda pendiente:`, error instanceof Error ? error.message : error);
      return { status: "pending" };
    }
  };

  const previous = queues.get(key) ?? Promise.resolve();
  const next = previous.then(run, run);
  queues.set(key, next);
  return next;
}
