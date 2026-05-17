"use client";

import { Check, Eraser, Loader2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";

import { AppHeader } from "@/components/AppHeader";
import type { WeekDay } from "@/data/mockWeek";
import { pageContentClass, pageShellClass, textareaClass } from "@/lib/ui";
import {
  importedMenuToWeekDays,
  type ImportedMenuResponse,
} from "@/lib/importMenu";

const orderedDays = [
  { name: "Lunes", shortName: "L" },
  { name: "Martes", shortName: "M" },
  { name: "Miércoles", shortName: "X" },
  { name: "Jueves", shortName: "J" },
  { name: "Viernes", shortName: "V" },
  { name: "Sábado", shortName: "S" },
  { name: "Domingo", shortName: "D" },
] as const;

const mealLabels = [
  { key: "lunch", label: "Comida" },
  { key: "dinner", label: "Cena" },
] as const;

type DayName = (typeof orderedDays)[number]["name"];

type ImportDaySelectorProps = {
  availableDays: Set<string>;
  selectedDayName: DayName;
  onSelectDay: (dayName: DayName) => void;
};

function getInitialSelectedDayName(days: WeekDay[]): DayName {
  const monday = orderedDays[0];
  const firstAvailableDay =
    orderedDays.find((orderedDay) =>
      days.some((day) => day.day === orderedDay.name),
    ) ?? monday;

  return days.some((day) => day.day === monday.name)
    ? monday.name
    : firstAvailableDay.name;
}

function ImportDaySelector({
  availableDays,
  selectedDayName,
  onSelectDay,
}: ImportDaySelectorProps) {
  return (
    <div
      className="grid w-full max-w-[23rem] grid-cols-7 gap-1.5 sm:gap-2"
      role="tablist"
      aria-label="Selecciona un día importado"
    >
      {orderedDays.map((day) => {
        const isAvailable = availableDays.has(day.name);
        const isSelected = selectedDayName === day.name;

        return (
          <button
            key={day.name}
            type="button"
            role="tab"
            aria-selected={isSelected}
            aria-label={day.name}
            disabled={!isAvailable}
            onClick={() => onSelectDay(day.name)}
            className={[
              "flex aspect-square min-h-9 w-full items-center justify-center rounded-full border text-sm font-semibold transition-colors sm:min-h-11",
              isSelected
                ? "border-[color:var(--color-foreground)] bg-[color:var(--color-foreground)] text-white shadow-[0_10px_22px_rgba(32,28,23,0.16)]"
                : "border-[color:var(--color-border)] bg-[color:var(--color-surface)] text-[color:var(--color-foreground)] hover:border-[color:var(--color-border-strong)]",
              !isAvailable
                ? "cursor-not-allowed border-[color:var(--color-border)] bg-transparent text-[color:var(--color-border-strong)] opacity-45 hover:border-[color:var(--color-border)]"
                : "",
            ].join(" ")}
          >
            {day.shortName}
          </button>
        );
      })}
    </div>
  );
}

function ImportedDayPreview({ day }: { day: WeekDay }) {
  return (
    <article className="rounded-[1.5rem] border border-[color:var(--color-border)] bg-[color:var(--color-surface)] p-3.5 shadow-[0_18px_45px_rgba(32,28,23,0.07)] sm:p-5">
      <div className="border-b border-[color:var(--color-border)] pb-2.5">
        <h2 className="text-2xl font-semibold leading-none text-[color:var(--color-foreground)] sm:text-3xl">
          {day.day}
        </h2>
      </div>

      <div className="mt-3 grid gap-2 sm:grid-cols-2">
        {mealLabels.map((meal) => {
          const value = day[meal.key];
          const isFree = value === "LIBRE";

          return (
            <section
              key={meal.key}
              className="min-h-[126px] rounded-2xl border border-[color:var(--color-border)] bg-white p-3"
            >
              <div className="flex items-center justify-between gap-3">
                <h3 className="text-sm font-semibold text-[color:var(--color-muted-foreground)]">
                  {meal.label}
                </h3>
                {isFree ? (
                  <span className="rounded-full bg-[color:var(--color-success-soft)] px-2.5 py-1 text-xs font-semibold text-[color:var(--color-muted-foreground)]">
                    Libre
                  </span>
                ) : null}
              </div>

              <div className="mt-2.5 flex min-h-[64px] w-full items-start rounded-xl bg-[color:var(--color-surface-muted)] px-3 py-2.5">
                <p
                  className={
                    isFree
                      ? "text-base font-semibold text-[color:var(--color-muted-foreground)]"
                      : "text-base font-semibold leading-6 text-[color:var(--color-foreground)] sm:text-lg"
                  }
                >
                  {isFree ? "LIBRE" : value}
                </p>
              </div>
            </section>
          );
        })}
      </div>
    </article>
  );
}

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
    <main className={pageShellClass}>
      <div className={`${pageContentClass} gap-5 sm:gap-6`}>
        <AppHeader />

        <section className="rounded-[1.75rem] border border-[color:var(--color-border)] bg-[color:var(--color-surface)] p-3.5 shadow-[0_18px_45px_rgba(32,28,23,0.07)] sm:p-5">
          <div className="relative">
            <button
              type="button"
              onClick={() => setMenuText("")}
              disabled={!menuText}
              aria-label="Limpiar texto"
              className="absolute right-3 top-3 z-10 flex h-10 w-10 items-center justify-center rounded-full border border-[color:var(--color-border)] bg-white/90 text-[color:var(--color-muted-foreground)] shadow-[0_8px_22px_rgba(32,28,23,0.04)] transition-colors hover:bg-[color:var(--color-surface-muted)] disabled:cursor-not-allowed disabled:opacity-35"
            >
              <Eraser aria-hidden="true" className="h-4 w-4" />
            </button>

            {hasMounted ? (
              <textarea
                value={menuText}
                onChange={(event) => setMenuText(event.target.value)}
                placeholder={`Lunes\nComida: Salmón con calabacín\nCena: LIBRE\n\nMartes\tPollo con arroz\tTortilla francesa`}
                className={`${textareaClass} min-h-[18rem] resize-y border-0 bg-white pr-14 text-base leading-7 shadow-none placeholder:text-stone-400/70 placeholder:italic focus:border-transparent sm:min-h-[22rem] sm:text-lg`}
              />
            ) : (
              <textarea
                defaultValue=""
                placeholder={`Lunes\nComida: Salmón con calabacín\nCena: LIBRE\n\nMartes\tPollo con arroz\tTortilla francesa`}
                className={`${textareaClass} min-h-[18rem] resize-y border-0 bg-white pr-14 text-base leading-7 shadow-none placeholder:text-stone-400/70 placeholder:italic focus:border-transparent sm:min-h-[22rem] sm:text-lg`}
              />
            )}
          </div>

          <button
            type="button"
            onClick={handleProcessMenu}
            disabled={isLoading}
            className="mt-3 inline-flex min-h-12 w-full items-center justify-center gap-2 rounded-2xl border border-[#c9d8c7] bg-[#eef5ec] px-5 text-sm font-semibold text-[#047857] shadow-[0_8px_22px_rgba(32,28,23,0.035)] transition-colors hover:bg-[#e4efdf] disabled:cursor-wait disabled:opacity-75 sm:w-auto sm:px-7"
          >
            {isLoading ? (
              <>
                <Loader2
                  aria-hidden="true"
                  className="h-4 w-4 animate-spin"
                />
                Procesando menú...
              </>
            ) : (
              <>
                <Check aria-hidden="true" className="h-4 w-4" />
                Procesar menú
              </>
            )}
          </button>

          {isLoading ? (
            <div className="mt-4 rounded-2xl border border-[#c9d8c7] bg-[#eef5ec] px-4 py-3 text-sm leading-6 text-[#047857]">
              Leyendo el texto y convirtiéndolo en una semana ordenada.
            </div>
          ) : null}

          {errorMessage ? (
            <div className="mt-4 rounded-2xl border border-rose-200 bg-[color:var(--color-danger-soft)] px-4 py-3 text-sm leading-6 text-rose-700">
              <p className="font-semibold text-rose-800">
                No he podido interpretar el menú todavía.
              </p>
              <p className="mt-1">{errorMessage}</p>
            </div>
          ) : null}
        </section>

        {importedMenu && importedWeekDays && selectedDay ? (
          <section className="space-y-4 border-t border-[color:var(--color-border)] pt-5 sm:space-y-5">
            <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
              <ImportDaySelector
                availableDays={availableDayNames}
                selectedDayName={selectedDayName}
                onSelectDay={setSelectedDayName}
              />
              <button
                type="button"
                onClick={handleUseWeek}
                className="inline-flex min-h-12 items-center justify-center rounded-2xl border border-[#c9d9e8] bg-[#eff6ff] px-7 text-sm font-semibold text-[#2563eb] shadow-[0_8px_22px_rgba(32,28,23,0.035)] transition-all hover:-translate-y-0.5 hover:bg-[#e2eef7] hover:shadow-[0_12px_28px_rgba(37,99,235,0.10)]"
              >
                Usar esta semana
              </button>
            </div>

            <ImportedDayPreview day={selectedDay} />
          </section>
        ) : (
          <section className="rounded-[1.5rem] border border-dashed border-[color:var(--color-border-strong)] px-5 py-5 text-sm leading-6 text-[color:var(--color-muted-foreground)] sm:px-7">
            <p className="font-semibold text-[color:var(--color-foreground)]">
              Preview
            </p>
          </section>
        )}
      </div>
    </main>
  );
}
