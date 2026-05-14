"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";

import type { WeekDay } from "@/data/mockWeek";
import {
  navButtonClass,
  pageContainerClass,
  pageShellClass,
  panelClass,
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

    return {
      weekSignature: parsedCache.weekSignature,
      items: parsedCache.items,
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
          setErrorMessage(
            data.error ?? "No se pudo generar la lista de la compra.",
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
                <p className="ui-eyebrow">
                  Lista de la compra
                </p>
                <h1 className="ui-title mt-3 text-4xl sm:text-5xl lg:text-6xl">
                  {weekLabel}
                </h1>
              </div>
            </div>

            <div className="grid grid-cols-12 lg:col-span-5">
              <div className="col-span-8 border-b border-l-0 border-[color:var(--color-border)] bg-[#facc15] px-5 py-4 lg:border-b-0 lg:border-l">
                <div className="ui-eyebrow text-stone-900">
                  Compra
                </div>
              </div>
              <div className="col-span-4 border-b border-l border-[color:var(--color-border)] bg-[#dc2626] lg:border-b-0" />
              <div className="col-span-12 grid gap-0 sm:grid-cols-2">
                <Link href="/" className={`${navButtonClass} border-b border-[color:var(--color-border)] sm:border-r sm:border-b-0`}>
                  Volver a la semana
                </Link>
                <Link
                  href="/pantry"
                  className="flex min-h-14 items-center justify-center bg-[color:var(--color-accent)] px-4 text-center text-sm font-semibold tracking-[-0.02em] text-white transition-colors hover:bg-[color:var(--color-accent-hover)]"
                >
                  Despensa base
                </Link>
              </div>
            </div>
          </div>
        </section>

        <section className={panelClass}>
          <div className="grid gap-0 lg:grid-cols-12">
            <div className="border-b border-[color:var(--color-border)] px-5 py-5 lg:col-span-3 lg:border-r lg:border-b-0 lg:px-7">
              <h2 className="text-3xl font-semibold leading-none text-[color:var(--color-foreground)]">
                {weekLabel}
              </h2>
              <div className="mt-6 flex items-center gap-3">
                <div className="h-4 w-16 bg-stone-950" />
                <div className="h-4 w-4 rounded-full bg-[#2563eb]" />
                <div className="h-4 w-8 bg-[#facc15]" />
              </div>
            </div>

            <div className="lg:col-span-9">
              <div className="grid gap-0 lg:grid-cols-2">
          {!hasLoadedWeek ? (
            <article className="border-b border-[color:var(--color-border)] bg-[color:var(--color-surface)] p-6 lg:col-span-2 lg:border-b-0">
              <h2 className="text-2xl font-semibold text-[color:var(--color-foreground)]">
                Cargando tu semana
              </h2>
              <p className="ui-copy mt-3 max-w-md text-sm">
                Estamos preparando la lista de la compra con tu menú guardado.
              </p>
            </article>
          ) : !weekDays || weekDays.length === 0 ? (
            <article className="border-b border-[color:var(--color-border)] bg-[color:var(--color-surface)] p-6 lg:col-span-2 lg:border-b-0">
              <h2 className="text-2xl font-semibold text-[color:var(--color-foreground)]">
                No hay una semana guardada
              </h2>
              <p className="ui-copy mt-3 max-w-md text-sm">
                Vuelve a la semana y guarda o importa un menú para generar tu
                lista de la compra.
              </p>
            </article>
          ) : isLoadingList ? (
            <article className="border-b border-[color:var(--color-border)] bg-[color:var(--color-surface)] p-6 lg:col-span-2 lg:border-b-0">
              <h2 className="text-2xl font-semibold text-[color:var(--color-foreground)]">
                Generando tu lista
              </h2>
              <p className="ui-copy mt-3 max-w-md text-sm">
                Estamos calculando los ingredientes de tu semana actual.
              </p>
            </article>
          ) : errorMessage ? (
            <article className="border-b border-rose-200 bg-[color:var(--color-danger-soft)] p-6 lg:col-span-2 lg:border-b-0">
              <h2 className="text-2xl font-semibold text-rose-800">
                No se pudo generar la lista
              </h2>
              <p className="mt-3 max-w-md text-sm leading-6 text-rose-700">
                {errorMessage}
              </p>
            </article>
          ) : shoppingList.length > 0 ? (
            shoppingList.map((group) => (
              <article
                key={group.category}
                className="border-b border-[color:var(--color-border)] bg-[color:var(--color-surface)] p-5 sm:p-6 lg:last:border-b-0 [&:nth-child(2n)]:lg:border-l"
              >
                <h2 className="text-2xl font-semibold capitalize text-[color:var(--color-foreground)]">
                  {group.category}
                </h2>

                <ul className="mt-4 space-y-3">
                  {group.items.map((item) => (
                    <li key={item.id}>
                      <label
                        className={`flex cursor-pointer items-center justify-between gap-4 rounded-[calc(var(--radius-card)-0.375rem)] border px-4 py-3.5 transition-colors ${
                          checkedItems.includes(item.id)
                            ? "border-[color:var(--color-border)] bg-[color:var(--color-surface-muted)] text-stone-500 opacity-60"
                            : "border-[color:var(--color-border)] bg-white text-[color:var(--color-foreground)]"
                        }`}
                      >
                        <span className="flex min-w-0 items-center gap-3">
                          <input
                            type="checkbox"
                            checked={checkedItems.includes(item.id)}
                            onChange={() => toggleCheckedItem(item.id)}
                            className="h-5 w-5 rounded-none border-stone-900 text-stone-900 accent-stone-900"
                          />
                          <span
                            className={`text-sm font-medium sm:text-[15px] ${
                              checkedItems.includes(item.id)
                                ? "line-through"
                                : ""
                            }`}
                          >
                            {capitalizeIngredientName(item.name)}
                          </span>
                        </span>
                        <span
                          className={`shrink-0 rounded-full border px-3 py-1 text-sm font-semibold ${
                            checkedItems.includes(item.id)
                              ? "border-[color:var(--color-border)] bg-stone-300 text-stone-500"
                              : "border-transparent bg-[#facc15] text-[color:var(--color-foreground)]"
                          }`}
                        >
                          {item.quantity} {item.unit}
                        </span>
                      </label>
                    </li>
                  ))}
                </ul>
              </article>
            ))
          ) : (
            <article className="border-b border-[color:var(--color-border)] bg-[color:var(--color-surface)] p-6 lg:col-span-2 lg:border-b-0">
              <h2 className="text-2xl font-semibold text-[color:var(--color-foreground)]">
                No hace falta comprar nada
              </h2>
              <p className="ui-copy mt-3 max-w-md text-sm">
                Todos los ingredientes de esta semana ya están cubiertos con tu
                despensa base.
              </p>
            </article>
          )}
              </div>
            </div>
          </div>
        </section>
      </div>
    </main>
  );
}
