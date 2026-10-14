"use client";

import { LoaderCircle } from "lucide-react";
import { useEffect, useState } from "react";

import { BorderTrail } from "@/components/motion-primitives/border-trail";
import { TextShimmer } from "@/components/motion-primitives/text-shimmer";
import { TertiaryButton } from "@/components/ui/Button";

// D3, step 27: the server does not report stages, so the wait is shown as what it is: an
// indeterminate indicator, the real elapsed time and the longest it can take (the route's limit).
type GenerationProgressProps = {
  mode: "import" | "generate";
  startedAt: number;
  maxSeconds: number;
  onCancel: () => void;
};

export function GenerationProgress({ mode, startedAt, maxSeconds, onCancel }: GenerationProgressProps) {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, []);

  const elapsed = Math.max(0, Math.floor((now - startedAt) / 1000));

  return (
    <article
      aria-busy="true"
      className="relative overflow-hidden rounded-[var(--radius-card)] border border-[color:var(--color-warning)] bg-[color:var(--color-warning-soft)] px-4 py-4 text-sm leading-6 text-[color:var(--color-warning-foreground)] shadow-[var(--shadow-card)]"
    >
      {/* Motion Primitives: a light runs around the card while the AI works. */}
      <BorderTrail
        size={72}
        className="bg-gradient-to-l from-[color:var(--color-accent)] via-[color:var(--color-accent-strong)] to-transparent"
      />
      <div className="flex items-start gap-3">
        <LoaderCircle
          aria-hidden="true"
          className="mt-0.5 h-5 w-5 shrink-0 animate-spin text-[color:var(--color-accent)] motion-reduce:animate-none"
        />
        <div className="min-w-0 flex-1">
          <p className="font-semibold text-[color:var(--color-foreground)]" role="status">
            <TextShimmer as="span" duration={1.6} spread={2.5}>
              {mode === "generate" ? "Creando tu propuesta…" : "Ordenando tu menú…"}
            </TextShimmer>
          </p>
          <p>
            Llevamos {elapsed} s. Puede tardar hasta {maxSeconds} s; si no hay respuesta antes, paramos y te lo
            decimos.
          </p>
          <p className="mt-1">
            Puedes ir a otra pantalla: la propuesta te esperará aquí. Si recargas o cierras la página, se pierde.
          </p>
        </div>
      </div>
      <div className="mt-3 flex flex-col gap-2 sm:flex-row sm:items-center">
        <TertiaryButton onClick={onCancel} className="w-full sm:w-auto">
          Cancelar
        </TertiaryButton>
        <p className="t-meta">
          Al cancelar, el servidor deja de esperar a la IA. No cuenta como uno de tus{" "}
          {mode === "generate" ? "menús" : "usos"} de hoy, salvo que la respuesta ya estuviera lista.
        </p>
      </div>
    </article>
  );
}
