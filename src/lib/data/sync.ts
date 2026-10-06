// Cache-then-revalidate for authenticated users; local-only for guests.
// Conflict policy (B1, approved): the remote copy is canonical.
// - A local change is written first as `pending`, tagged with the remote version it was based on.
// - On revalidation, pending data is pushed only if the remote version is still that base.
//   If the remote changed meanwhile (another device), the remote wins and the pending change is dropped.
// - A save is refused the same way when the remote changed since the cached version.
// - Nothing is declared empty until the remote confirms it; a remote failure keeps the cache.
import {
  readEnvelope,
  removeScoped,
  writeScoped,
  type ScopedEntity,
  type StorageScope,
} from "@/lib/storage/scoped-storage";

export type RemoteSnapshot<T> = { data: T | null; version: string | null };

export type EntityRemote<T> = {
  fetch: () => Promise<RemoteSnapshot<T>>;
  // Persists data and returns the new remote version.
  push: (data: T) => Promise<string | null>;
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
      try {
        const version = await remote.push(cached.data);
        writeScoped(target.scope, target.entity, cached.data, { week: target.week, remoteVersion: version });
        return { data: cached.data, source: "remote", offline: false, discardedLocalChanges: false, pending: false };
      } catch {
        return { data: cached.data, source: "cache", offline: true, discardedLocalChanges: false, pending: true };
      }
    }
    discardedLocalChanges = true;
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
  | { status: "synced" }
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
export async function saveEntity<T>(
  target: Target,
  data: T,
  remote: EntityRemote<T> | null,
  { overwrite = false }: { overwrite?: boolean } = {},
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
    remoteVersion: before?.remoteVersion ?? null,
    pending: true,
  });

  const run = async (): Promise<SaveResult<T>> => {
    if (latestSeq.get(key) !== seq) return { status: "synced" };
    const baseVersion = readEnvelope<T>(target.scope, target.entity, target.week)?.remoteVersion ?? null;
    try {
      const snapshot = overwrite ? null : await remote.fetch();
      if (snapshot && snapshot.version !== baseVersion && snapshot.data !== null) {
        writeScoped(target.scope, target.entity, snapshot.data, { week: target.week, remoteVersion: snapshot.version });
        return { status: "conflict", remoteData: snapshot.data };
      }
      const version = await remote.push(data);
      const isLatest = latestSeq.get(key) === seq;
      const current = readEnvelope<T>(target.scope, target.entity, target.week);
      writeScoped(target.scope, target.entity, isLatest ? data : (current?.data ?? data), {
        week: target.week,
        remoteVersion: version,
        pending: !isLatest,
      });
      return { status: "synced" };
    } catch {
      return { status: "pending" };
    }
  };

  const previous = queues.get(key) ?? Promise.resolve();
  const next = previous.then(run, run);
  queues.set(key, next);
  return next;
}
