"use client";

import { useEffect, useMemo, useState } from "react";

import { AppHeader } from "@/components/AppHeader";
import type { WeekDay } from "@/data/mockWeek";
import {
  cardClass,
  emptyStateClass,
  pageContentClass,
  pageHeroClass,
  pageHeroCopyClass,
  pageHeroInnerClass,
  pageShellClass,
  sectionBlockClass,
  sectionHeaderClass,
  statusPillClass,
} from "@/lib/ui";
import { pantryHasItem, readPantryBase } from "@/lib/pantryStorage";
import {
  groupShoppingListItems,
  isGeneratedShoppingListResponse,
  type GeneratedShoppingListResponse,
  type ShoppingListItem,
} from "@/lib/shoppingList";
import { readSavedWeek } from "@/lib/weekStorage";

const SHOPPING_LIST_CACHE_KEY = "becook-shopping-list-cache";
const monthLabels: Record<string, string> = {
  ene: "enero",
  feb: "febrero",
  mar: "marzo",
  abr: "abril",
  may: "mayo",
  jun: "junio",
  jul: "julio",
  ago: "agosto",
  sep: "septiembre",
  oct: "octubre",
  nov: "noviembre",
  dic: "diciembre",
};

type ShoppingListCache = {
  weekSignature: string;
  items: GeneratedShoppingListResponse["items"];
  checkedItemIds: string[];
};

function getWeekSignature(week: WeekDay[]) {
  return JSON.stringify(week);
}

function readShoppingListCache(): ShoppingListCache | null {
  if (typeof window === "undefined") {
    return null;
  }

  const savedCache = window.localStorage.getItem(SHOPPING_LIST_CACHE_KEY);

  if (!savedCache) {
    return null;
  }

  try {
    const parsedCache = JSON.parse(savedCache) as Partial<ShoppingListCache>;

    if (
      typeof parsedCache.weekSignature !== "string" ||
      !Array.isArray(parsedCache.checkedItemIds) ||
      !parsedCache.checkedItemIds.every((itemId) => typeof itemId === "string") ||
      !isGeneratedShoppingListResponse({ items: parsedCache.items })
    ) {
      return null;
    }

    const parsedItems =
      parsedCache.items as GeneratedShoppingListResponse["items"];

    return {
      weekSignature: parsedCache.weekSignature,
      items: parsedItems,
      checkedItemIds: parsedCache.checkedItemIds,
    };
  } catch {
    return null;
  }
}

function saveShoppingListCache(cache: ShoppingListCache) {
  if (typeof window === "undefined") {
    return;
  }

  window.localStorage.setItem(
    SHOPPING_LIST_CACHE_KEY,
    JSON.stringify(cache),
  );
}

function capitalizeIngredientName(name: string) {
  if (!name) {
    return name;
  }

  return name.charAt(0).toUpperCase() + name.slice(1);
}

function formatWeekBoundaryDate(dateLabel: string) {
  const normalizedDate = dateLabel.trim().toLowerCase();
  const [day, month] = normalizedDate.split(/\s+/);

  if (!day || !month) {
    return dateLabel;
  }

  return `${day} ${monthLabels[month] ?? month}`;
}

function getWeekLabelFromDays(days: WeekDay[] | null) {
  if (!days || days.length === 0) {
    return "Semana actual";
  }

  const firstDay = days[0];
  const lastDay = days[days.length - 1];

  return `Semana ${formatWeekBoundaryDate(firstDay.date)} - ${formatWeekBoundaryDate(lastDay.date)}`;
}

export default function ShoppingListPage() {
  const [checkedItems, setCheckedItems] = useState<string[]>([]);
  const [pantryItems, setPantryItems] = useState<string[]>([]);
  const [weekDays, setWeekDays] = useState<WeekDay[] | null>(null);
  const [hasLoadedWeek, setHasLoadedWeek] = useState(false);
  const [generatedItems, setGeneratedItems] = useState<ShoppingListItem[]>([]);
  const [isLoadingList, setIsLoadingList] = useState(false);
  const [errorMessage, setErrorMessage] = useState("");
  const weekLabel = getWeekLabelFromDays(weekDays);

  useEffect(() => {
    // La lista lee la despensa al montar, sin depender de localStorage en el primer render.
    const loadPantry = window.setTimeout(() => {
      setPantryItems(readPantryBase());
    }, 0);

    return () => window.clearTimeout(loadPantry);
  }, []);

  useEffect(() => {
    const loadWeek = window.setTimeout(() => {
      const savedWeek = readSavedWeek();

      setWeekDays(savedWeek);
      setHasLoadedWeek(true);
    }, 0);

    return () => window.clearTimeout(loadWeek);
  }, []);

  useEffect(() => {
    if (!hasLoadedWeek || !weekDays || weekDays.length === 0) {
      return;
    }

    const controller = new AbortController();
    const weekSignature = getWeekSignature(weekDays);

    async function generateShoppingList() {
      const cachedShoppingList = readShoppingListCache();

      if (cachedShoppingList?.weekSignature === weekSignature) {
        console.log("Lista de la compra: usando caché local");
        const cachedItems = groupShoppingListItems(
          cachedShoppingList.items,
        ).flatMap((group) => group.items);
        const cachedItemIds = new Set(cachedItems.map((item) => item.id));

        setGeneratedItems(cachedItems);
        setCheckedItems(
          cachedShoppingList.checkedItemIds.filter((itemId) =>
            cachedItemIds.has(itemId),
          ),
        );
        setErrorMessage("");
        return;
      }

      console.log("Lista de la compra: generando con OpenAI");
      setIsLoadingList(true);
      setErrorMessage("");

      try {
        const response = await fetch("/api/generate-shopping-list", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ week: weekDays }),
          signal: controller.signal,
        });

        const data = (await response.json()) as
          | GeneratedShoppingListResponse
          | { error?: string };

        if (!response.ok) {
          setGeneratedItems([]);
          const fallbackMessage = "No se pudo generar la lista de la compra.";
          setErrorMessage(
            "error" in data ? data.error ?? fallbackMessage : fallbackMessage,
          );
          return;
        }

        const generatedResponse = data as GeneratedShoppingListResponse;
        const groupedItems = groupShoppingListItems(generatedResponse.items).flatMap(
          (group) => group.items,
        );

        saveShoppingListCache({
          weekSignature,
          items: generatedResponse.items,
          checkedItemIds: [],
        });

        setGeneratedItems(groupedItems);
        setCheckedItems([]);
      } catch (error) {
        if (error instanceof DOMException && error.name === "AbortError") {
          return;
        }

        setGeneratedItems([]);
        setErrorMessage("Ha fallado la conexión al generar la lista de la compra.");
      } finally {
        setIsLoadingList(false);
      }
    }

    generateShoppingList();

    return () => controller.abort();
  }, [hasLoadedWeek, weekDays]);

  useEffect(() => {
    if (!weekDays || weekDays.length === 0 || generatedItems.length === 0) {
      return;
    }

    const weekSignature = getWeekSignature(weekDays);
    const cachedShoppingList = readShoppingListCache();

    if (!cachedShoppingList || cachedShoppingList.weekSignature !== weekSignature) {
      return;
    }

    const availableItemIds = new Set(generatedItems.map((item) => item.id));
    const persistedCheckedItems = checkedItems.filter((itemId) =>
      availableItemIds.has(itemId),
    );

    saveShoppingListCache({
      ...cachedShoppingList,
      checkedItemIds: persistedCheckedItems,
    });
  }, [checkedItems, generatedItems, weekDays]);

  const shoppingList = useMemo(() => {
    const visibleItems = generatedItems.filter(
      (item) => !pantryHasItem(pantryItems, item.name),
    );

    return groupShoppingListItems(visibleItems);
  }, [generatedItems, pantryItems]);

  const toggleCheckedItem = (itemId: string) => {
    setCheckedItems((currentItems) =>
      currentItems.includes(itemId)
        ? currentItems.filter((currentItemId) => currentItemId !== itemId)
        : [...currentItems, itemId],
    );
  };

  const totalVisibleItems = shoppingList.reduce(
    (totalItems, group) => totalItems + group.items.length,
    0,
  );
  const checkedVisibleItems = shoppingList.reduce(
    (totalItems, group) =>
      totalItems +
      group.items.filter((item) => checkedItems.includes(item.id)).length,
    0,
  );

  return (
    <main className={pageShellClass}>
      <div className={pageContentClass}>
        <AppHeader />

        <section className={pageHeroClass}>
          <div className={pageHeroInnerClass}>
            <div className={pageHeroCopyClass}>
              <p className="ui-eyebrow">Lista de la compra</p>
              <h1 className="ui-title mt-5 text-5xl sm:text-6xl lg:text-7xl">
                {weekLabel}
              </h1>
              <p className="ui-copy mt-5 max-w-2xl text-lg sm:text-xl">
                Ingredientes agrupados para comprar sin ruido, respetando tu
                despensa base y lo que ya has marcado.
              </p>
            </div>
          </div>
        </section>

        <section className={sectionBlockClass}>
          <div className={sectionHeaderClass}>
            <div>
              <p className="ui-eyebrow">Compra</p>
              <h2 className="mt-3 max-w-2xl text-3xl font-semibold leading-tight text-[color:var(--color-foreground)] sm:text-4xl">
                Lo que necesitas, listo para ir tachando.
              </h2>
            </div>

            {hasLoadedWeek && weekDays && weekDays.length > 0 ? (
              <div className={statusPillClass}>
                {checkedVisibleItems} de {totalVisibleItems} marcados
              </div>
            ) : null}
          </div>

          {!hasLoadedWeek ? (
            <article className={`${cardClass} p-6 sm:p-7`}>
              <p className="ui-eyebrow">Preparando</p>
              <h2 className="mt-3 text-2xl font-semibold text-[color:var(--color-foreground)] sm:text-3xl">
                Cargando tu semana
              </h2>
              <p className="ui-copy mt-3 max-w-xl text-base">
                Estamos preparando la lista de la compra con tu menú guardado.
              </p>
            </article>
          ) : !weekDays || weekDays.length === 0 ? (
            <article className={emptyStateClass}>
              <p className="ui-eyebrow">Sin semana</p>
              <h2 className="mt-3 text-2xl font-semibold text-[color:var(--color-foreground)] sm:text-3xl">
                No hay una semana guardada
              </h2>
              <p className="ui-copy mt-3 max-w-xl text-base">
                Vuelve a la semana y guarda o importa un menú para generar tu
                lista de la compra.
              </p>
            </article>
          ) : isLoadingList ? (
            <article className={`${cardClass} p-6 sm:p-7`}>
              <p className="ui-eyebrow">Generando</p>
              <h2 className="mt-3 text-2xl font-semibold text-[color:var(--color-foreground)] sm:text-3xl">
                Generando tu lista
              </h2>
              <p className="ui-copy mt-3 max-w-xl text-base">
                Estamos calculando los ingredientes de tu semana actual.
              </p>
              <div className="mt-5 h-2 overflow-hidden rounded-full bg-[color:var(--color-surface-muted)]">
                <div className="h-full w-1/2 rounded-full bg-[color:var(--color-accent)]" />
              </div>
            </article>
          ) : errorMessage ? (
            <article className="rounded-[var(--radius-card)] border border-rose-200 bg-[color:var(--color-danger-soft)] p-6 sm:p-7">
              <p className="ui-eyebrow text-rose-700">Error</p>
              <h2 className="mt-3 text-2xl font-semibold text-rose-800 sm:text-3xl">
                No se pudo generar la lista
              </h2>
              <p className="mt-3 max-w-xl text-base leading-7 text-rose-700">
                {errorMessage}
              </p>
            </article>
          ) : shoppingList.length > 0 ? (
            <div className="grid gap-5 lg:grid-cols-2">
              {shoppingList.map((group) => (
                <article key={group.category} className={`${cardClass} p-5 sm:p-6`}>
                  <div className="flex items-baseline justify-between gap-4 border-b border-[color:var(--color-border)] pb-4">
                    <h2 className="text-2xl font-semibold capitalize text-[color:var(--color-foreground)]">
                      {group.category}
                    </h2>
                    <span className="shrink-0 text-sm font-medium text-[color:var(--color-muted-foreground)]">
                      {group.items.length}{" "}
                      {group.items.length === 1 ? "item" : "items"}
                    </span>
                  </div>

                  <ul className="mt-3 divide-y divide-[color:var(--color-border)]">
                    {group.items.map((item) => {
                      const isChecked = checkedItems.includes(item.id);

                      return (
                        <li key={item.id}>
                          <label
                            className={`flex min-h-16 cursor-pointer items-center gap-4 py-3 transition-colors ${
                              isChecked
                                ? "text-[color:var(--color-muted-foreground)]"
                                : "text-[color:var(--color-foreground)]"
                            }`}
                          >
                            <input
                              type="checkbox"
                              checked={isChecked}
                              onChange={() => toggleCheckedItem(item.id)}
                              className="h-6 w-6 shrink-0 rounded-md border-[color:var(--color-border-strong)] accent-[color:var(--color-accent)]"
                            />
                            <span className="min-w-0 flex-1">
                              <span
                                className={`block text-base font-medium leading-6 sm:text-lg ${
                                  isChecked ? "line-through opacity-60" : ""
                                }`}
                              >
                                {capitalizeIngredientName(item.name)}
                              </span>
                              {isChecked ? (
                                <span className="mt-0.5 block text-xs font-semibold uppercase tracking-[0.18em] text-[color:var(--color-muted-foreground)]">
                                  Comprado
                                </span>
                              ) : null}
                            </span>
                            <span
                              className={`shrink-0 rounded-full px-3 py-1 text-sm font-semibold ${
                                isChecked
                                  ? "bg-[color:var(--color-surface-muted)] text-[color:var(--color-muted-foreground)]"
                                  : "bg-[color:var(--color-accent-soft)] text-[color:var(--color-foreground)]"
                              }`}
                            >
                              {item.quantity} {item.unit}
                            </span>
                          </label>
                        </li>
                      );
                    })}
                  </ul>
                </article>
              ))}
            </div>
          ) : (
            <article className={emptyStateClass}>
              <p className="ui-eyebrow">Despensa cubierta</p>
              <h2 className="mt-3 text-2xl font-semibold text-[color:var(--color-foreground)] sm:text-3xl">
                No hace falta comprar nada
              </h2>
              <p className="ui-copy mt-3 max-w-xl text-base">
                Todos los ingredientes de esta semana ya están cubiertos con tu
                despensa base.
              </p>
            </article>
          )}
        </section>
      </div>
    </main>
  );
}
