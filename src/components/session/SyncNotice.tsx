import { StateMessage } from "@/components/ui/StateMessage";

export type SyncState = {
  offline?: boolean;
  discardedLocalChanges?: boolean;
  pending?: boolean;
  conflict?: boolean;
};

// Shown only to signed-in users; guests never see sync wording.
export function SyncNotice({ state, className = "mt-0" }: { state: SyncState; className?: string }) {
  const messages: string[] = [];
  if (state.conflict) {
    messages.push("Tu cuenta tenía cambios más recientes de otro dispositivo: se muestra esa versión. Revisa y vuelve a guardar.");
  }
  if (state.discardedLocalChanges) {
    messages.push("Había cambios en este dispositivo que no se guardaron porque tu cuenta tenía una versión más reciente.");
  }
  if (state.offline) {
    messages.push("No se ha podido comprobar tu cuenta: se muestra la copia de este dispositivo.");
  }
  if (state.pending && !state.offline) {
    messages.push("Hay cambios pendientes de guardar en tu cuenta; se reintentará al volver a cargar.");
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
