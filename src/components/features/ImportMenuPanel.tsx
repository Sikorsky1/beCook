"use client";

import { Check, Eraser } from "lucide-react";
import { useState } from "react";

import { AiLoginNotice } from "@/components/features/AiLoginNotice";
import { MenuFileUpload } from "@/components/features/MenuFileUpload";
import { PrimaryButton } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { IconButton } from "@/components/ui/IconButton";
import { TextArea } from "@/components/ui/TextArea";

// C6 (roadmap step 22; Crear menú part of step 32): the menu the user already has, pasted as text.
// It is a secondary path under «Generar»: shown when the disclosure opens or with ?mode=import.
// Pasted menus in a clear format are ordered on this device, without the AI, for guests too; only
// what the device cannot read goes to the AI, and that needs a session. A PDF or a photo of the menu
// can fill the box too (MenuFileUpload); the user checks that text before processing it.
type ImportMenuPanelProps = {
  // Prefix of the ids inside (the page puts the disclosure's target id on its wrapper).
  idPrefix: string;
  hasMounted: boolean;
  value: string;
  onChange: (value: string) => void;
  onProcess: () => void;
  // The AI is ordering this menu (local parsing is instant).
  processing: boolean;
  // Another generation or import is running.
  disabled: boolean;
  // Set after the device could not read the text and there is no session.
  needsLogin: boolean;
  loginReturnPath: string;
  onBeforeLogin: () => void;
};

const placeholder = "Lunes\nComida: Salmón con calabacín\nCena: LIBRE\n\nMartes\tPollo con arroz\tTortilla francesa";
const textAreaClass = "min-h-[16rem] resize-y border-0 pr-16 shadow-none sm:min-h-[20rem]";

export function ImportMenuPanel({
  idPrefix,
  hasMounted,
  value,
  onChange,
  onProcess,
  processing,
  disabled,
  needsLogin,
  loginReturnPath,
  onBeforeLogin,
}: ImportMenuPanelProps) {
  const textId = `${idPrefix}-text`;
  const helpId = `${idPrefix}-help`;
  // A file is being read into the box: nothing else may change it meanwhile.
  const [fileBusy, setFileBusy] = useState(false);
  const locked = disabled || fileBusy;

  return (
    <Card className="space-y-3 p-3.5 sm:p-5">
      <div>
        <label htmlFor={textId} className="t-body-strong text-[color:var(--color-foreground)]">
          Pega tu menú de la semana
        </label>
        <p id={helpId} className="t-meta mt-1">
          Si cada día va en su línea con «Comida:» y «Cena:», o como filas de una tabla (día, comida, cena), lo
          ordenamos al momento en este dispositivo, sin IA. Si no, lo ordena la IA (necesita sesión iniciada).
        </p>
      </div>

      <MenuFileUpload
        idPrefix={idPrefix}
        disabled={disabled}
        loginReturnPath={loginReturnPath}
        onBeforeLogin={onBeforeLogin}
        onText={onChange}
        onBusyChange={setFileBusy}
      />

      <div className="relative rounded-[var(--radius-control)] border border-[color:var(--color-border)]">
        <IconButton
          onClick={() => onChange("")}
          disabled={!value || locked}
          aria-label="Limpiar texto"
          className="absolute right-3 top-3 z-10"
        >
          <Eraser aria-hidden="true" className="h-4 w-4" />
        </IconButton>

        {hasMounted ? (
          <TextArea
            id={textId}
            aria-describedby={helpId}
            value={value}
            disabled={locked}
            onChange={(event) => onChange(event.target.value)}
            placeholder={placeholder}
            className={textAreaClass}
          />
        ) : (
          <TextArea id={textId} aria-describedby={helpId} defaultValue="" placeholder={placeholder} className={textAreaClass} />
        )}
      </div>

      {needsLogin ? (
        <div role="status">
          <AiLoginNotice
            returnPath={loginReturnPath}
            description="No hemos podido ordenar este texto en el dispositivo, así que necesita la IA. Tu texto se conserva aquí: al volver podrás procesarlo, o cambia el formato y vuelve a intentarlo."
            onBeforeNavigate={onBeforeLogin}
          />
        </div>
      ) : null}

      <PrimaryButton onClick={onProcess} disabled={locked} size="lg" className="w-full disabled:cursor-wait">
        {processing ? (
          "Estamos organizando tu menú…"
        ) : (
          <>
            <Check aria-hidden="true" className="h-4 w-4" />
            Procesar menú
          </>
        )}
      </PrimaryButton>
    </Card>
  );
}
