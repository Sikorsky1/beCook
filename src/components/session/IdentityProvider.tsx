"use client";

import { createContext, useContext, useEffect, useMemo, useSyncExternalStore, type ReactNode } from "react";

import { forgetShoppingUpdateFailures } from "@/lib/data/shopping";
import { createIdentityStore, type Identity, type IdentityStore } from "@/lib/session/identity";
import { supabase } from "@/lib/supabase/client";

const IdentityContext = createContext<IdentityStore | null>(null);

// One store per browser tab; created lazily so the server render never touches auth.
let browserStore: IdentityStore | null = null;
function getBrowserStore() {
  browserStore ??= createIdentityStore(supabase);
  return browserStore;
}

const serverSnapshot: Identity = {
  status: "resolving",
  scope: "guest",
  userId: null,
  email: null,
  sessionExpired: false,
  epoch: 0,
};

export function IdentityProvider({ children }: { children: ReactNode }) {
  const store = useMemo(() => getBrowserStore(), []);

  useEffect(() => {
    void store.start();
  }, [store]);

  // Another identity (sign-in, sign-out, expired session): shopping AI failures remembered for the
  // previous one are forgotten, so the next opening of Compra may try again.
  useEffect(() => {
    let userId = store.getSnapshot().userId;
    const unsubscribe = store.subscribe(() => {
      const next = store.getSnapshot().userId;
      if (next !== userId) forgetShoppingUpdateFailures();
      userId = next;
    });
    return () => {
      unsubscribe();
    };
  }, [store]);

  return <IdentityContext.Provider value={store}>{children}</IdentityContext.Provider>;
}

function useIdentityStore() {
  const store = useContext(IdentityContext);
  if (!store) throw new Error("useIdentity must be used inside <IdentityProvider>.");
  return store;
}

// Screens must wait for status "ready" before reading any data.
export function useIdentity(): Identity {
  const store = useIdentityStore();
  return useSyncExternalStore(store.subscribe, store.getSnapshot, () => serverSnapshot);
}

export function useIdentityActions() {
  const store = useIdentityStore();
  return { signOut: store.signOut, dismissExpiredNotice: store.dismissExpiredNotice, refresh: store.refresh };
}
