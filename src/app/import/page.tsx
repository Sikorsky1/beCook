"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

import { DayCard } from "@/components/DayCard";
import {
  buttonPrimaryClass,
  buttonSecondaryClass,
  navButtonClass,
  pageContainerClass,
  pageShellClass,
  panelClass,
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
        setErrorMessage(data.error ?? "No se pudo procesar el menú.");
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
      <div className={pageContainerClass}>
        <section className={panelClass}>
          <div className="grid gap-0 lg:grid-cols-12">
            <div className="border-b border-[color:var(--color-border)] px-5 py-5 lg:col-span-7 lg:border-r lg:border-b-0 lg:px-7 lg:py-7">
              <div className="mb-6 flex items-start justify-between gap-4">
                <div className="ui-eyebrow">beCook</div>
                <div className="hidden h-14 w-14 rounded-full border-8 border-[#2563eb] lg:block" />
              </div>

              <div className="max-w-3xl">
                <h1 className="ui-title text-4xl sm:text-5xl lg:text-6xl">
                  ¿Qué menú quieres para esta semana?
                </h1>
              </div>
            </div>

            <div className="grid grid-cols-12 lg:col-span-5">
              <div className="col-span-8 border-b border-l-0 border-[color:var(--color-border)] bg-[#facc15] px-5 py-4 lg:border-b-0 lg:border-l" />
              <div className="col-span-4 border-b border-l border-[color:var(--color-border)] bg-[#dc2626] lg:border-b-0" />
              <div className="col-span-12 grid gap-0 sm:grid-cols-2">
                <Link href="/" className={`${navButtonClass} border-b border-[color:var(--color-border)] sm:border-r sm:border-b-0`}>
                  Volver a la semana
                </Link>
                <button
                  type="button"
                  onClick={() => setMenuText("")}
                  disabled={!menuText}
                  className={buttonPrimaryClass}
                >
                  Limpiar texto
                </button>
              </div>
            </div>
          </div>
        </section>

        <section className={panelClass}>
          <div className="grid gap-0 lg:grid-cols-12">
            <div className="border-b border-[color:var(--color-border)] px-5 py-5 lg:col-span-3 lg:border-r lg:border-b-0 lg:px-7">
              <div className="flex items-center gap-3 py-1">
                <div className="h-10 w-10 border-4 border-[#2563eb]" />
                <div className="flex flex-col gap-2">
                  <div className="h-1.5 w-16 bg-stone-950" />
                  <div className="h-1.5 w-10 bg-[#facc15]" />
                </div>
              </div>
            </div>

            <div className="border-b border-[color:var(--color-border)] p-5 lg:col-span-9 lg:border-b-0 lg:p-7">
              {hasMounted ? (
                <textarea
                  value={menuText}
                  onChange={(event) => setMenuText(event.target.value)}
                  placeholder="Pega aquí tu menú semanal"
                  className={textareaClass}
                />
              ) : (
                <textarea
                  defaultValue=""
                  placeholder="Pega aquí tu menú semanal"
                  className={textareaClass}
                />
              )}

              <div className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-center">
                <button
                  type="button"
                  onClick={handleProcessMenu}
                  disabled={isLoading}
                  className={`${buttonSecondaryClass} border-transparent bg-[#facc15] text-[color:var(--color-foreground)] hover:bg-[#eab308] disabled:cursor-wait disabled:bg-stone-300`}
                >
                  {isLoading ? "Procesando menú..." : "Procesar menú"}
                </button>
              </div>

              {errorMessage ? (
                <div className="mt-4 rounded-[calc(var(--radius-control)-0.125rem)] border border-rose-200 bg-[color:var(--color-danger-soft)] px-4 py-3 text-sm leading-6 text-rose-700">
                  {errorMessage}
                </div>
              ) : null}
            </div>
          </div>
        </section>

        {importedMenu ? (
          <section className={panelClass}>
            <div className="grid gap-0 lg:grid-cols-12">
              <div className="border-b border-[color:var(--color-border)] px-5 py-5 lg:col-span-3 lg:border-r lg:border-b-0 lg:px-7">
                <h2 className="text-3xl font-semibold leading-none text-[color:var(--color-foreground)]">
                  {importedMenu.week}
                </h2>
                <div className="mt-6 flex items-center gap-3">
                  <div className="h-4 w-16 bg-stone-950" />
                  <div className="h-4 w-4 rounded-full bg-[#2563eb]" />
                  <div className="h-4 w-8 bg-[#facc15]" />
                </div>
                <button
                  type="button"
                  onClick={handleUseWeek}
                  className={`mt-6 ${buttonPrimaryClass}`}
                >
                  Usar esta semana
                </button>
              </div>

              <div className="lg:col-span-9">
                <div className="grid gap-0 lg:grid-cols-2">
                  {importedWeekDays?.map((day) => (
                    <DayCard
                      key={day.day}
                      day={day}
                      isEditable={false}
                      appearance="home"
                    />
                  ))}
                </div>
              </div>
            </div>
          </section>
        ) : null}
      </div>
    </main>
  );
}
