// Single source of identity for the client. Data is only loaded once the scope is known,
// and every scope change bumps `epoch` so screens drop in-memory state and in-flight loads.
import type { Session, SupabaseClient } from "@supabase/supabase-js";

import { migrateLegacyStorage } from "@/lib/storage/legacy";
import { clearScope, scopeForUser, type StorageScope } from "@/lib/storage/scoped-storage";

export type Identity = {
  status: "resolving" | "ready";
  scope: StorageScope;
  userId: string | null;
  email: string | null;
  // The previous session ended without an explicit sign-out (expired or revoked).
  sessionExpired: boolean;
  epoch: number;
};

type AuthClient = Pick<SupabaseClient, "auth">;

const initialIdentity: Identity = {
  status: "resolving",
  scope: "guest",
  userId: null,
  email: null,
  sessionExpired: false,
  epoch: 0,
};

export function createIdentityStore(client: AuthClient | null) {
  let identity = initialIdentity;
  let explicitSignOut = false;
  let started = false;
  let unsubscribe: (() => void) | null = null;
  const listeners = new Set<() => void>();

  const emit = () => listeners.forEach((listener) => listener());

  function apply(session: Session | null, { expired = false }: { expired?: boolean } = {}) {
    const userId = session?.user?.id ?? null;
    const email = session?.user?.email ?? null;
    const userChanged = identity.status !== "ready" || userId !== identity.userId;
    const sessionExpired = userId ? false : userChanged ? expired : identity.sessionExpired;
    if (!userChanged && email === identity.email && sessionExpired === identity.sessionExpired) {
      return;
    }
    identity = {
      status: "ready",
      scope: scopeForUser(userId),
      userId,
      email,
      sessionExpired,
      epoch: userChanged ? identity.epoch + 1 : identity.epoch,
    };
    emit();
  }

  return {
    getSnapshot: () => identity,
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    async start() {
      if (started) return;
      started = true;
      migrateLegacyStorage();
      if (!client) {
        apply(null);
        return;
      }
      const { data } = await client.auth.getSession().catch(() => ({ data: { session: null } }));
      apply(data.session);
      const { data: subscription } = client.auth.onAuthStateChange((event, session) => {
        if (event === "SIGNED_OUT") {
          const expired = !explicitSignOut && identity.userId !== null;
          explicitSignOut = false;
          apply(null, { expired });
          return;
        }
        apply(session);
      });
      unsubscribe = () => subscription.subscription.unsubscribe();
    },
    stop() {
      unsubscribe?.();
      unsubscribe = null;
      started = false;
    },
    // Explicit sign-out: the user's device cache is removed (the account keeps the data).
    // localOnly (P37, after deleting the account): only this device forgets the session; the
    // server already revoked it, so there is nothing to call and no "session expired" notice.
    async signOut({ localOnly = false }: { localOnly?: boolean } = {}) {
      if (!client) return;
      const scope = identity.scope;
      explicitSignOut = true;
      const { error } = await client.auth.signOut(localOnly ? { scope: "local" } : undefined);
      if (error) {
        explicitSignOut = false;
        throw new Error(error.message);
      }
      clearScope(scope);
      // supabase-js emits SIGNED_OUT; apply directly too in case the event is not delivered.
      if (identity.userId !== null) {
        explicitSignOut = false;
        apply(null);
      }
    },
    // Data changed outside a screen (e.g. legacy import): screens reload for the same identity.
    refresh() {
      if (identity.status !== "ready") return;
      identity = { ...identity, epoch: identity.epoch + 1 };
      emit();
    },
    dismissExpiredNotice() {
      if (!identity.sessionExpired) return;
      identity = { ...identity, sessionExpired: false };
      emit();
    },
  };
}

export type IdentityStore = ReturnType<typeof createIdentityStore>;
