"use client";

import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";

import { SecondaryButton } from "@/components/ui/Button";
import { StateMessage } from "@/components/ui/StateMessage";
import { consumeAccountDeletedNotice } from "@/lib/account/client";

// P37: shown once on the screen reached after deleting the account (left by «Tus datos»).
// Checked on every navigation: the layout keeps this component mounted.
export function AccountDeletedNotice() {
  const pathname = usePathname();
  const [visible, setVisible] = useState(false);
  const messageRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      if (consumeAccountDeletedNotice()) setVisible(true);
    }, 0);
    return () => window.clearTimeout(timer);
  }, [pathname]);

  useEffect(() => {
    if (visible) messageRef.current?.focus();
  }, [visible]);

  if (!visible) return null;

  return (
    <div ref={messageRef} tabIndex={-1} role="status" className="outline-none">
      <StateMessage
        className="mt-0"
        variant="success"
        title="Tu cuenta se ha eliminado."
        action={
          <SecondaryButton size="md" onClick={() => setVisible(false)}>
            Entendido
          </SecondaryButton>
        }
      >
        <p>
          Hemos borrado tu perfil, tus menús, tu compra, tu despensa y tus fichas. Puedes seguir usando beCook sin
          cuenta en este dispositivo.
        </p>
      </StateMessage>
    </div>
  );
}
