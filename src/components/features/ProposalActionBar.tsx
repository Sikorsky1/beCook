"use client";

import { Check, LoaderCircle, Undo2 } from "lucide-react";

import { PrimaryButton, TertiaryButton } from "@/components/ui/Button";
import type { MenuSaveState } from "@/lib/applyWeek";

// D3, step 26: «Usar este menú» is always in reach while a proposal is on screen, fixed above the
// bottom navigation, with what will be saved and where. After a replacement it offers «Deshacer»
// for a short time.
export type ProposalBarStatus = "idle" | "applying" | "success" | "error";

type ProposalActionBarProps = {
  summary: string;
  weekLabel: string;
  status: ProposalBarStatus;
  menu: MenuSaveState | null;
  message: string;
  onUse: () => void;
  undo: { busy: boolean; onUndo: () => void } | null;
  onOpenWeek: (() => void) | null;
};

export function ProposalActionBar({ summary, weekLabel, status, menu, message, onUse, undo, onOpenWeek }: ProposalActionBarProps) {
  const isError = status === "error";

  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-[calc(6.5rem+env(safe-area-inset-bottom))] z-40 flex justify-center pl-[max(1rem,env(safe-area-inset-left))] pr-[max(1rem,env(safe-area-inset-right))]">
      <div
        role="region"
        aria-label="Usar la propuesta"
        className="pointer-events-auto w-full max-w-[25rem] rounded-[var(--radius-card)] border border-[color:var(--color-border)] bg-[color:var(--color-surface)]/95 p-3 shadow-[0_18px_48px_rgba(46,42,38,0.18)] backdrop-blur-xl"
      >
        {/* The live region is always in the DOM so a new message is announced when it appears. */}
        <div role="status" aria-live="polite" aria-atomic="true">
          {message ? (
            <p
              className={`mb-2 text-sm font-semibold leading-5 ${
                isError ? "text-[color:var(--color-danger)]" : "text-[color:var(--color-success-hover)]"
              }`}
            >
              {message}
            </p>
          ) : null}
        </div>
        {message ? null : (
          <p className="t-meta mb-2">
            {summary} · se guarda en {weekLabel}
          </p>
        )}

        {status === "success" ? (
          <div className="flex gap-2">
            {undo ? (
              <TertiaryButton onClick={undo.onUndo} disabled={undo.busy} className="flex-1">
                {undo.busy ? (
                  <LoaderCircle aria-hidden="true" className="h-4 w-4 animate-spin motion-reduce:animate-none" />
                ) : (
                  <Undo2 aria-hidden="true" className="h-4 w-4" />
                )}
                Deshacer
              </TertiaryButton>
            ) : null}
            <PrimaryButton onClick={onOpenWeek ?? undefined} disabled={!onOpenWeek || undo?.busy} className="flex-1">
              <Check aria-hidden="true" className="h-4 w-4" />
              Ver mi semana
            </PrimaryButton>
          </div>
        ) : (
          <PrimaryButton
            onClick={onUse}
            disabled={status === "applying"}
            size="lg"
            className={`w-full ${status === "applying" ? "cursor-wait" : ""}`}
          >
            {status === "applying" ? (
              <>
                <LoaderCircle aria-hidden="true" className="h-4 w-4 animate-spin motion-reduce:animate-none" />
                Guardando menú…
              </>
            ) : isError && menu === "pending" ? (
              "Reintentar guardado"
            ) : (
              "Usar este menú"
            )}
          </PrimaryButton>
        )}
      </div>
    </div>
  );
}
