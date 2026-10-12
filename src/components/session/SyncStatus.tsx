"use client";

import { Check, CloudOff, LoaderCircle, RefreshCw, Smartphone } from "lucide-react";
import { useEffect, useRef } from "react";

import { syncStatus, type SyncStatusInput, type SyncStatusKind } from "@/lib/syncStatus";

const tones: Record<SyncStatusKind, string> = {
  device: "border-[color:var(--color-border)] bg-[color:var(--color-surface)] text-[color:var(--color-muted-foreground)]",
  saving: "border-[color:var(--color-border)] bg-[color:var(--color-surface)] text-[color:var(--color-muted-foreground)]",
  checking: "border-[color:var(--color-border)] bg-[color:var(--color-surface)] text-[color:var(--color-muted-foreground)]",
  saved: "border-[color:var(--color-secondary)] bg-[color:var(--color-secondary-soft)] text-[color:var(--color-secondary-hover)]",
  pending: "border-[color:var(--color-warning)] bg-[color:var(--color-warning-soft)] text-[color:var(--color-warning-foreground)]",
  error: "border-[color:var(--color-border)] bg-[color:var(--color-danger-soft)] text-[color:var(--color-danger)]",
};

function StatusIcon({ kind }: { kind: SyncStatusKind }) {
  const className = "h-4 w-4 shrink-0";
  if (kind === "saved") return <Check aria-hidden="true" className={className} />;
  if (kind === "device") return <Smartphone aria-hidden="true" className={className} />;
  if (kind === "pending" || kind === "error") return <CloudOff aria-hidden="true" className={className} />;
  return <LoaderCircle aria-hidden="true" className={`${className} animate-spin motion-reduce:animate-none`} />;
}

// Save state of what the page shows (see @/lib/syncStatus). «Reintentar» only resends what is
// pending on this device; it is also triggered when the browser reports the connection is back.
export function SyncStatus({
  className = "",
  onRetry,
  ...input
}: SyncStatusInput & { className?: string; onRetry?: () => void }) {
  const view = syncStatus(input);
  const canRetry = view.canRetry && Boolean(onRetry);
  const retryRef = useRef(onRetry);

  useEffect(() => {
    retryRef.current = onRetry;
  });

  useEffect(() => {
    if (!canRetry) return;
    const retry = () => retryRef.current?.();
    window.addEventListener("online", retry);
    return () => window.removeEventListener("online", retry);
  }, [canRetry]);

  return (
    <div className={`flex flex-col gap-1.5 ${className}`}>
      <div className="flex flex-wrap items-center gap-2">
        <p
          role="status"
          aria-live="polite"
          className={`inline-flex w-fit items-center gap-1.5 rounded-full border px-3 py-1.5 text-sm font-semibold ${tones[view.kind]}`}
        >
          <StatusIcon kind={view.kind} />
          {view.label}
        </p>
        {canRetry ? (
          <button
            type="button"
            onClick={() => onRetry?.()}
            className="inline-flex min-h-11 items-center gap-1.5 rounded-full border border-[color:var(--color-border-strong)] bg-[color:var(--color-surface)] px-4 text-sm font-semibold text-[color:var(--color-foreground)] transition-colors hover:bg-[color:var(--color-surface-muted)]"
          >
            <RefreshCw aria-hidden="true" className="h-4 w-4" />
            Reintentar
          </button>
        ) : null}
      </div>
      {view.detail ? <p className="t-meta">{view.detail}</p> : null}
    </div>
  );
}
