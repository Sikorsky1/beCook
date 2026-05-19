"use client";

import { Check, Eraser } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";

import { AppHeader } from "@/components/AppHeader";
import {
  DaySelector,
  getInitialSelectedDayName,
  type DayName,
} from "@/components/features/DaySelector";
import { ImportedDayPreview } from "@/components/features/ImportedDayPreview";
import { PrimaryButton, TertiaryButton } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { IconButton } from "@/components/ui/IconButton";
import { StateMessage } from "@/components/ui/StateMessage";
import { TextArea } from "@/components/ui/TextArea";
import { pageContentClass, pageShellClass } from "@/lib/ui";
import {
  importedMenuToWeekDays,
  type ImportedMenuResponse,
} from "@/lib/importMenu";

export default function ImportPage() {
  const router = useRouter();
  const [hasMounted, setHasMounted] = useState(false);
  const [menuText, setMenuText] = useState("");
  const [importedMenu, setImportedMenu] = useState<ImportedMenuResponse | null>(
    null,
  );
  const [isLoading, setIsLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState("");
  const [selectedDayName, setSelectedDayName] = useState<DayName>("Lunes");
  const importedWeekDays = importedMenu
    ? importedMenuToWeekDays(importedMenu.days)
    : null;
  const availableDayNames = useMemo(
    () => new Set(importedWeekDays?.map((day) => day.day) ?? []),
    [importedWeekDays],
  );
  const selectedDay = useMemo(
    () =>
      importedWeekDays?.find((day) => day.day === selectedDayName) ?? null,
    [importedWeekDays, selectedDayName],
  );

  useEffect(() => {
    setHasMounted(true);
  }, []);

  const handleProcessMenu = async () => {
    setIsLoading(true);
    setErrorMessage("");

    try {
      const response = await fetch("/api/import-menu", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ text: menuText }),
      });

      const data = (await response.json()) as
        | ImportedMenuResponse
        | { error?: string };

      if (!response.ok) {
        setImportedMenu(null);
        const fallbackMessage = "No se pudo procesar el menú.";
        setErrorMessage(
          "error" in data ? data.error ?? fallbackMessage : fallbackMessage,
        );
        return;
      }

      const processedMenu = data as ImportedMenuResponse;
      const processedWeekDays = importedMenuToWeekDays(processedMenu.days);

      setImportedMenu(processedMenu);
      setSelectedDayName(getInitialSelectedDayName(processedWeekDays));
    } catch {
      setImportedMenu(null);
      setErrorMessage("Ha fallado la conexión al procesar el menú.");
    } finally {
      setIsLoading(false);
    }
  };

  const handleUseWeek = () => {
    if (!importedWeekDays) {
      return;
    }

    console.log("Guardando semana importada:", importedWeekDays.length);
    window.localStorage.setItem("becook-week", JSON.stringify(importedWeekDays));
    router.push("/");
  };

  return (
    <main className={`${pageShellClass} pb-[calc(1.25rem+env(safe-area-inset-bottom))]`}>
      <div className={`${pageContentClass} gap-5 sm:gap-6`}>
        <AppHeader />

        <Card className="p-3.5 sm:p-5">
          <div className="relative">
            <IconButton
              onClick={() => setMenuText("")}
              disabled={!menuText}
              aria-label="Limpiar texto"
              className="absolute right-3 top-3 z-10"
            >
              <Eraser aria-hidden="true" className="h-4 w-4" />
            </IconButton>

            {hasMounted ? (
              <TextArea
                value={menuText}
                onChange={(event) => setMenuText(event.target.value)}
                placeholder={`Lunes\nComida: Salmón con calabacín\nCena: LIBRE\n\nMartes\tPollo con arroz\tTortilla francesa`}
                className="min-h-[18rem] resize-y border-0 pr-16 shadow-none sm:min-h-[22rem] sm:text-lg"
              />
            ) : (
              <TextArea
                defaultValue=""
                placeholder={`Lunes\nComida: Salmón con calabacín\nCena: LIBRE\n\nMartes\tPollo con arroz\tTortilla francesa`}
                className="min-h-[18rem] resize-y border-0 pr-16 shadow-none sm:min-h-[22rem] sm:text-lg"
              />
            )}
          </div>

          <PrimaryButton
            onClick={handleProcessMenu}
            disabled={isLoading}
            className="mt-3 w-full disabled:cursor-wait sm:w-auto sm:px-7"
          >
            {isLoading ? (
              "Estamos organizando tu menú..."
            ) : (
              <>
                <Check aria-hidden="true" className="h-4 w-4" />
                Procesar menú
              </>
            )}
          </PrimaryButton>

          {isLoading ? (
            <StateMessage
              className="mt-4"
              title="Estamos preparando tu semana..."
              variant="loading"
            >
              <p>
                Leemos el menú con calma y lo ordenamos por días para que puedas
                revisarlo antes de usarlo.
              </p>
              <div className="mt-3 h-2 overflow-hidden rounded-full bg-white/65">
                <div className="h-full w-2/3 rounded-full bg-[color:var(--color-warning)] transition-all duration-700 ease-out motion-reduce:transition-none motion-safe:animate-pulse" />
              </div>
            </StateMessage>
          ) : null}

          {errorMessage ? (
            <StateMessage
              className="mt-4"
              title="No hemos podido ordenar este menú todavía."
              variant="error"
            >
              <p>{errorMessage}</p>
              <p className="mt-1">
                Revisa que el texto incluya días y platos, y vuelve a intentarlo.
              </p>
            </StateMessage>
          ) : null}
        </Card>

        {importedMenu && importedWeekDays && selectedDay ? (
          <section className="space-y-4 border-t border-[color:var(--color-border)] pt-5 transition-opacity duration-200 ease-out motion-reduce:transition-none sm:space-y-5">
            <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
              <DaySelector
                ariaLabel="Selecciona un día importado"
                availableDays={availableDayNames}
                selectedDayName={selectedDayName}
                onSelectDay={setSelectedDayName}
              />
              <TertiaryButton onClick={handleUseWeek} className="px-7">
                Usar esta semana
              </TertiaryButton>
            </div>

            <ImportedDayPreview day={selectedDay} />
          </section>
        ) : (
          <StateMessage title="Tu semana aparecerá aquí." variant="empty">
            <p>
              Pega el menú, procésalo y podrás revisar cada día antes de guardarlo.
            </p>
          </StateMessage>
        )}
      </div>
    </main>
  );
}
