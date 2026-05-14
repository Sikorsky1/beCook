"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

import { DayCard } from "@/components/DayCard";
import {
  buttonGhostClass,
  buttonPrimaryClass,
  cardClass,
  emptyStateClass,
  pageActionsClass,
  pageContentClass,
  pageHeroClass,
  pageHeroCopyClass,
  pageHeroInnerClass,
  pageShellClass,
  sectionBlockClass,
  sectionHeaderClass,
  textareaClass,
} from "@/lib/ui";
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
  const importedWeekDays = importedMenu
    ? importedMenuToWeekDays(importedMenu.days)
    : null;

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

      setImportedMenu(data as ImportedMenuResponse);
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
    <main className={pageShellClass}>
      <div className={pageContentClass}>
        <section className={pageHeroClass}>
          <div className={pageHeroInnerClass}>
            <div className={pageHeroCopyClass}>
              <p className="ui-eyebrow">Importar menú</p>
              <h1 className="ui-title mt-5 text-5xl sm:text-6xl lg:text-7xl">
                Pega tu semana y deja que beCook la ordene.
              </h1>
              <p className="ui-copy mt-5 max-w-2xl text-lg sm:text-xl">
                Acepta texto libre, listas por día y tablas copiadas desde
                Excel. Después podrás revisar el resultado antes de aplicarlo.
              </p>
            </div>

            <div className={pageActionsClass}>
              <Link href="/" className={buttonGhostClass}>
                Volver a la semana
              </Link>
              <button
                type="button"
                onClick={() => setMenuText("")}
                disabled={!menuText}
                className={buttonGhostClass}
              >
                Limpiar texto
              </button>
            </div>
          </div>
        </section>

        <section className={`${cardClass} space-y-5 p-5 sm:p-7 lg:p-8`}>
          <div className="flex flex-col gap-5 lg:flex-row lg:items-start lg:justify-between">
            <div className="max-w-2xl">
              <p className="ui-eyebrow">Paso 1</p>
              <h2 className="mt-3 text-3xl font-semibold leading-tight text-[color:var(--color-foreground)] sm:text-4xl">
                Pega el menú tal como lo tienes.
              </h2>
              <p className="ui-copy mt-3 max-w-xl text-base sm:text-lg">
                Puede venir con días y platos, o en columnas tipo Día, Comida y
                Cena. No hace falta que esté perfecto.
              </p>
            </div>

            <div className="rounded-[var(--radius-control)] bg-[color:var(--color-surface-muted)] px-4 py-3 text-sm leading-6 text-[color:var(--color-muted-foreground)] lg:max-w-sm">
              Ejemplo: Lunes · Comida: lentejas · Cena: tortilla. También vale
              copiar una tabla completa desde una hoja de cálculo.
            </div>
          </div>

          <div>
            {hasMounted ? (
              <textarea
                value={menuText}
                onChange={(event) => setMenuText(event.target.value)}
                placeholder={`Lunes\nComida: Salmón con calabacín\nCena: LIBRE\n\nMartes\tPollo con arroz\tTortilla francesa`}
                className={`${textareaClass} min-h-[22rem] resize-y bg-[color:var(--color-surface)] text-base leading-7 shadow-none focus:border-[color:var(--color-accent)] sm:text-lg`}
              />
            ) : (
              <textarea
                defaultValue=""
                placeholder={`Lunes\nComida: Salmón con calabacín\nCena: LIBRE\n\nMartes\tPollo con arroz\tTortilla francesa`}
                className={`${textareaClass} min-h-[22rem] resize-y bg-[color:var(--color-surface)] text-base leading-7 shadow-none focus:border-[color:var(--color-accent)] sm:text-lg`}
              />
            )}

            <div className="mt-5 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <p className="text-sm leading-6 text-[color:var(--color-muted-foreground)]">
                Revisa que estén los siete días antes de procesar si quieres un
                preview completo.
              </p>
              <button
                type="button"
                onClick={handleProcessMenu}
                disabled={isLoading}
                className={`${buttonPrimaryClass} min-h-14 px-7 disabled:cursor-wait`}
              >
                {isLoading ? (
                  <span className="inline-flex items-center gap-3">
                    <span className="h-2.5 w-2.5 rounded-full bg-white/80" />
                    Procesando menú...
                  </span>
                ) : (
                  "Procesar menú"
                )}
              </button>
            </div>

            {isLoading ? (
              <div className="mt-5 rounded-[var(--radius-control)] border border-[color:var(--color-border)] bg-[color:var(--color-accent-soft)] px-4 py-3 text-sm leading-6 text-[color:var(--color-muted-foreground)]">
                Leyendo el texto y convirtiéndolo en una semana ordenada.
              </div>
            ) : null}

            {errorMessage ? (
              <div className="mt-5 rounded-[var(--radius-control)] border border-rose-200 bg-[color:var(--color-danger-soft)] px-4 py-3 text-sm leading-6 text-rose-700">
                <p className="font-semibold text-rose-800">
                  No he podido interpretar el menú todavía.
                </p>
                <p className="mt-1">{errorMessage}</p>
              </div>
            ) : null}
          </div>
        </section>

        {importedMenu ? (
          <section className={sectionBlockClass}>
            <div className={sectionHeaderClass}>
              <div>
                <p className="ui-eyebrow">Paso 2</p>
                <h2 className="mt-3 text-3xl font-semibold leading-tight text-[color:var(--color-foreground)] sm:text-4xl">
                  {importedMenu.week}
                </h2>
                <p className="ui-copy mt-3 max-w-2xl text-base sm:text-lg">
                  Revisa la interpretación. Si encaja, aplícala como tu semana
                  actual.
                </p>
              </div>

              <button
                type="button"
                onClick={handleUseWeek}
                className={`${buttonPrimaryClass} min-h-14 px-7`}
              >
                Usar esta semana
              </button>
            </div>

            <div className="grid gap-4 sm:gap-5 lg:grid-cols-2">
              {importedWeekDays?.map((day) => (
                <DayCard
                  key={day.day}
                  day={day}
                  isEditable={false}
                  appearance="home"
                />
              ))}
            </div>
          </section>
        ) : (
          <section
            className={`${emptyStateClass} px-5 py-6 text-sm leading-6 text-[color:var(--color-muted-foreground)] sm:px-7`}
          >
            <div className="max-w-2xl">
              <p className="font-semibold text-[color:var(--color-foreground)]">
                El preview aparecerá aquí.
              </p>
              <p className="mt-1">
                Cuando proceses el texto, verás cada día separado en comida y
                cena para validar el resultado antes de guardarlo.
              </p>
            </div>
          </section>
        )}
      </div>
    </main>
  );
}
