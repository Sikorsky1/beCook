"use client";

import { FileUp } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { AiLoginNotice } from "@/components/features/AiLoginNotice";
import { TertiaryButton } from "@/components/ui/Button";
import { StateMessage } from "@/components/ui/StateMessage";
import { isAiLoginRequiredError, postAi } from "@/lib/ai-client";
import { menuFileAccept, menuFileErrorMessage, menuFileLimits } from "@/lib/menuFile";
import { readMenuFile } from "@/lib/menuFileReader";
import { getAccessToken } from "@/lib/supabase/auth";

// «Ya tengo un menú» from a file (see @/lib/menuFile): the text read from a PDF or a photo goes into
// the paste box, never straight to «Procesar menú», so the user checks it first.
type MenuFileUploadProps = {
  idPrefix: string;
  disabled: boolean;
  loginReturnPath: string;
  onBeforeLogin: () => void;
  // «processed»: the text was a nutritionist's plan and its week is already on screen.
  onText: (text: string) => "filled" | "processed";
  onBusyChange: (busy: boolean) => void;
};

type UploadState =
  | { status: "idle" }
  | { status: "reading"; fileName: string; withAi: boolean }
  | { status: "done"; fileName: string; withAi: boolean; plan: boolean }
  | { status: "error"; message: string }
  | { status: "login" };

export function MenuFileUpload({
  idPrefix,
  disabled,
  loginReturnPath,
  onBeforeLogin,
  onText,
  onBusyChange,
}: MenuFileUploadProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const controllerRef = useRef<AbortController | null>(null);
  const [state, setState] = useState<UploadState>({ status: "idle" });
  const busy = state.status === "reading";
  const helpId = `${idPrefix}-file-help`;

  useEffect(() => () => controllerRef.current?.abort(), []);

  const setBusy = (next: UploadState) => {
    setState(next);
    onBusyChange(next.status === "reading");
  };

  const handleFile = async (file: File) => {
    controllerRef.current?.abort();
    const controller = new AbortController();
    controllerRef.current = controller;
    setBusy({ status: "reading", fileName: file.name, withAi: false });

    const read = await readMenuFile(file);
    if (controller.signal.aborted) return;

    if (read.kind === "error") {
      setBusy({ status: "error", message: menuFileErrorMessage(read.reason) });
      return;
    }

    if (read.kind === "text") {
      const plan = onText(read.text) === "processed";
      setBusy({ status: "done", fileName: file.name, withAi: false, plan });
      return;
    }

    // A photo or a scanned PDF: only the AI can read it, and the AI needs a session.
    if (!(await getAccessToken())) {
      setBusy({ status: "login" });
      return;
    }

    setBusy({ status: "reading", fileName: file.name, withAi: true });

    try {
      const response = await postAi("/api/menu-file-text", { images: read.images }, controller.signal);
      const data = (await response.json().catch(() => ({}))) as { text?: string; error?: string; reason?: string };
      if (controller.signal.aborted) return;

      if (!response.ok || typeof data.text !== "string") {
        setBusy({ status: "error", message: data.error ?? menuFileErrorMessage(data.reason) });
        return;
      }

      const plan = onText(data.text) === "processed";
      setBusy({ status: "done", fileName: file.name, withAi: true, plan });
    } catch (error: unknown) {
      if (controller.signal.aborted) return;
      if (isAiLoginRequiredError(error)) {
        setBusy({ status: "login" });
        return;
      }
      setBusy({ status: "error", message: "Ha fallado la conexión al leer el archivo." });
    }
  };

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <TertiaryButton
          onClick={() => inputRef.current?.click()}
          disabled={disabled || busy}
          aria-describedby={helpId}
          className="disabled:cursor-wait"
        >
          <FileUp aria-hidden="true" className="h-4 w-4" />
          {state.status === "reading" ? (state.withAi ? "Leyendo con IA…" : "Leyendo el archivo…") : "Subir PDF o foto"}
        </TertiaryButton>
        <p id={helpId} className="t-meta">
          PDF (con texto, hasta {menuFileLimits.maxTextPdfPages} páginas; escaneado, hasta {menuFileLimits.maxPages}) o
          una foto. Un PDF con texto se lee aquí, sin IA, también el plan de tu nutricionista; una foto o un escaneo
          los lee la IA (necesita sesión). No guardamos el archivo.
        </p>
        <input
          ref={inputRef}
          type="file"
          accept={menuFileAccept}
          className="sr-only"
          tabIndex={-1}
          aria-hidden="true"
          onChange={(event) => {
            const file = event.target.files?.[0];
            event.target.value = "";
            if (file) void handleFile(file);
          }}
        />
      </div>

      <div role="status" aria-live="polite">
        {state.status === "done" ? (
          <StateMessage
            variant="success"
            title={state.plan ? `«${state.fileName}» es un plan nutricional` : `Hemos pasado «${state.fileName}» a texto`}
          >
            {state.plan ? (
              <p>
                Hemos preparado una semana con sus reglas y sus desayunos, medias mañanas y meriendas. Revísala abajo y
                pulsa «Usar este menú».
              </p>
            ) : (
              <p>
                {state.withAi ? "Lo ha leído la IA: revisa" : "Revisa"} el texto de abajo, corrige lo que haga falta y
                pulsa «Procesar menú».
              </p>
            )}
          </StateMessage>
        ) : state.status === "error" ? (
          <StateMessage variant="error" title="No hemos podido usar el archivo">
            <p>{state.message}</p>
          </StateMessage>
        ) : state.status === "login" ? (
          <AiLoginNotice
            returnPath={loginReturnPath}
            description="Las fotos y los PDF escaneados los lee la IA. Inicia sesión y vuelve a subir el archivo, o pega el texto del menú."
            onBeforeNavigate={onBeforeLogin}
          />
        ) : null}
      </div>
    </div>
  );
}
