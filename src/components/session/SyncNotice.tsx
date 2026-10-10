import { StateMessage } from "@/components/ui/StateMessage";

export type SyncState = {
  offline?: boolean;
  discardedLocalChanges?: boolean;
  pending?: boolean;
  conflict?: boolean;
};

// What happened to changes made on this device (conflicts). The save state itself (saved,
// pending, account unreachable) is shown by SyncStatus. Signed-in users only.
export function SyncNotice({ state, className = "mt-0" }: { state: SyncState; className?: string }) {
  const messages: string[] = [];
  if (state.conflict) {
    messages.push("Tu cuenta tenía cambios más recientes de otro dispositivo: se muestra esa versión. Revisa y vuelve a guardar.");
  }
  if (state.discardedLocalChanges) {
    messages.push("Había cambios en este dispositivo que no se guardaron porque tu cuenta tenía una versión más reciente.");
  }
  if (messages.length === 0) return null;

  return (
    <StateMessage className={className} title="Sincronización" variant="loading">
      {messages.map((message) => (
        <p key={message}>{message}</p>
      ))}
    </StateMessage>
  );
}
