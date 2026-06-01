"use client";

import { useEffect, useMemo, useState } from "react";

import { StickyPageHeader } from "@/components/layout/StickyPageHeader";
import { ShoppingTabs } from "@/components/layout/ShoppingTabs";
import { Card } from "@/components/ui/Card";
import { CategoryPill as BaseCategoryPill } from "@/components/ui/CategoryPill";
import { CheckboxItem } from "@/components/ui/CheckboxItem";
import { StateMessage } from "@/components/ui/StateMessage";
import { StatusPill } from "@/components/ui/StatusPill";
import type { WeekDay } from "@/data/mockWeek";
import { pageShellClass } from "@/lib/ui";
import { pantryHasItem, readPantryBase } from "@/lib/pantryStorage";
import {
  groupShoppingListItems,
  isGeneratedShoppingListResponse,
  type GeneratedShoppingListResponse,
  type ShoppingCategoryGroup,
  type ShoppingListItem,
  type SupermarketCategory,
} from "@/lib/shoppingList";
import { readSavedWeek } from "@/lib/weekStorage";

const SHOPPING_LIST_CACHE_KEY = "becook-shopping-list-cache";

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

function getShoppingItemsForSupabase(
  items: ShoppingListItem[],
  checkedItemIds: string[],
) {
  const checkedItemsSet = new Set(checkedItemIds);

  return items.map((item) => ({
    name: item.name,
    quantity: item.quantity,
    unit: item.unit,
    category: item.category,
    checked: checkedItemsSet.has(item.id),
  }));
}

async function getLatestWeekIdFromSupabase() {
  const { supabase } = await import("@/lib/supabase/client");

  if (!supabase) {
    throw new Error(
      "Supabase client is not configured. Check NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY in .env.local.",
    );
  }

  const { data: latestWeek, error: latestWeekError } = await supabase
    .from("weeks")
    .select("id")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle<{ id: string }>();

  if (latestWeekError) {
    throw new Error(`Could not read latest week id: ${latestWeekError.message}`);
  }

  return latestWeek?.id ?? null;
}

function syncShoppingListToSupabase(
  items: ShoppingListItem[],
  checkedItemIds: string[],
) {
  if (items.length === 0) {
    return;
  }

  try {
    const shoppingItems = getShoppingItemsForSupabase(items, checkedItemIds);

    void (async () => {
      const weekId = await getLatestWeekIdFromSupabase();

      if (!weekId) {
        console.warn(
          "No se pudo sincronizar la lista de la compra con Supabase: no hay semana remota.",
        );
        return;
      }

      const { saveShoppingListToSupabase } = await import(
        "@/lib/supabase/shopping-lists"
      );

      await saveShoppingListToSupabase(weekId, shoppingItems);
    })().catch((error: unknown) => {
      console.warn(
        "No se pudo sincronizar la lista de la compra con Supabase:",
        error instanceof Error ? error.message : error,
      );
    });
  } catch (error: unknown) {
    console.warn(
      "No se pudo sincronizar la lista de la compra con Supabase:",
      error instanceof Error ? error.message : error,
    );
  }
}

function capitalizeIngredientName(name: string) {
  if (!name) {
    return name;
  }

  return name.charAt(0).toUpperCase() + name.slice(1);
}

type CategoryProgress = {
  category: SupermarketCategory;
  checked: number;
  total: number;
  isCompleted: boolean;
};

type ShoppingProgressProps = {
  checkedItemsCount: number;
  totalItemsCount: number;
};

function ShoppingProgress({
  checkedItemsCount,
  totalItemsCount,
}: ShoppingProgressProps) {
  return (
    <StatusPill>
      {checkedItemsCount}/{totalItemsCount} comprados
    </StatusPill>
  );
}

type CategoryPillProps = CategoryProgress & {
  isSelected: boolean;
  onSelect: () => void;
};

function CategoryPill({
  category,
  checked,
  total,
  isCompleted,
  isSelected,
  onSelect,
}: CategoryPillProps) {
  return (
    <BaseCategoryPill
      isCompleted={isCompleted}
      isSelected={isSelected}
      label={category}
      meta={`${checked}/${total}`}
      onClick={onSelect}
    />
  );
}

type CategorySelectorProps = {
  categories: CategoryProgress[];
  selectedCategory: SupermarketCategory | null;
  onSelectCategory: (category: SupermarketCategory) => void;
};

function CategorySelector({
  categories,
  selectedCategory,
  onSelectCategory,
}: CategorySelectorProps) {
  const gridColumnsClass =
    categories.length === 1
      ? "grid-cols-1"
      : categories.length === 2 || categories.length === 4
        ? "grid-cols-2"
        : "grid-cols-3";

  return (
    <div
      className={`grid ${gridColumnsClass} gap-2`}
      role="tablist"
      aria-label="Categorías de compra"
    >
      {categories.map((categoryProgress) => (
        <CategoryPill
          key={categoryProgress.category}
          {...categoryProgress}
          isSelected={selectedCategory === categoryProgress.category}
          onSelect={() => onSelectCategory(categoryProgress.category)}
        />
      ))}
    </div>
  );
}

type ShoppingItemsForCategoryProps = {
  group: ShoppingCategoryGroup;
  checkedItems: string[];
  onToggleCheckedItem: (itemId: string) => void;
};

function ShoppingItemsForCategory({
  group,
  checkedItems,
  onToggleCheckedItem,
}: ShoppingItemsForCategoryProps) {
  return (
    <Card className="overflow-visible">
      <ul className="divide-y divide-[color:var(--color-border)]">
        {group.items.map((item) => {
          const isChecked = checkedItems.includes(item.id);

          return (
            <li key={item.id}>
              <CheckboxItem
                checked={isChecked}
                label={capitalizeIngredientName(item.name)}
                onChange={() => onToggleCheckedItem(item.id)}
                status={isChecked ? "Comprado" : undefined}
                strikeWhenChecked
                valueBadge={`${item.quantity} ${item.unit}`}
              />
            </li>
          );
        })}
      </ul>
    </Card>
  );
}

export default function ShoppingListPage() {
  const [checkedItems, setCheckedItems] = useState<string[]>([]);
  const [pantryItems, setPantryItems] = useState<string[]>([]);
  const [weekDays, setWeekDays] = useState<WeekDay[] | null>(null);
  const [hasLoadedWeek, setHasLoadedWeek] = useState(false);
  const [generatedItems, setGeneratedItems] = useState<ShoppingListItem[]>([]);
  const [isLoadingList, setIsLoadingList] = useState(false);
  const [errorMessage, setErrorMessage] = useState("");
  const [selectedCategory, setSelectedCategory] =
    useState<SupermarketCategory | null>(null);

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
        syncShoppingListToSupabase(groupedItems, []);

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

  useEffect(() => {
    const firstCategory = shoppingList[0]?.category ?? null;

    if (shoppingList.length === 0) {
      setSelectedCategory(null);
      return;
    }

    if (
      !selectedCategory ||
      !shoppingList.some((group) => group.category === selectedCategory)
    ) {
      setSelectedCategory(firstCategory);
    }
  }, [selectedCategory, shoppingList]);

  const toggleCheckedItem = (itemId: string) => {
    const nextCheckedItems = checkedItems.includes(itemId)
      ? checkedItems.filter((currentItemId) => currentItemId !== itemId)
      : [...checkedItems, itemId];

    setCheckedItems(nextCheckedItems);
    syncShoppingListToSupabase(generatedItems, nextCheckedItems);
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
  const categoryProgress = shoppingList.map((group) => {
    const checkedItemsInCategory = group.items.filter((item) =>
      checkedItems.includes(item.id),
    ).length;

    return {
      category: group.category,
      checked: checkedItemsInCategory,
      total: group.items.length,
      isCompleted:
        group.items.length > 0 && checkedItemsInCategory === group.items.length,
    };
  });
  const selectedGroup =
    shoppingList.find((group) => group.category === selectedCategory) ?? null;

  return (
    <main
      className={`${pageShellClass} min-h-dvh px-3 pb-[calc(7.5rem+env(safe-area-inset-bottom))] pt-3 sm:px-6 sm:pt-6`}
    >
      <div className="mx-auto flex w-full max-w-3xl flex-col gap-4 sm:gap-5">
        <StickyPageHeader
          title="LISTA DE LA COMPRA"
          action={
            hasLoadedWeek && weekDays && weekDays.length > 0 ? (
              <ShoppingProgress
                checkedItemsCount={checkedVisibleItems}
                totalItemsCount={totalVisibleItems}
              />
            ) : null
          }
        >
          <div className="space-y-2.5">
            <ShoppingTabs />

            {categoryProgress.length > 0 ? (
              <CategorySelector
                categories={categoryProgress}
                selectedCategory={selectedCategory}
                onSelectCategory={setSelectedCategory}
              />
            ) : null}
          </div>
        </StickyPageHeader>

        <section className="transition-opacity duration-200 ease-out motion-reduce:transition-none">
          {!hasLoadedWeek ? (
            <Card className="p-6 sm:p-7">
              <p className="ui-eyebrow">Preparando</p>
              <h2 className="mt-3 text-2xl font-semibold text-[color:var(--color-foreground)] sm:text-3xl">
                Cargando tu semana
              </h2>
              <p className="ui-copy mt-3 max-w-xl text-base">
                Estamos preparando la lista de la compra con tu menú guardado.
              </p>
            </Card>
          ) : !weekDays || weekDays.length === 0 ? (
            <StateMessage title="No hay una semana guardada." variant="empty">
              <p className="ui-eyebrow">Sin semana</p>
              <p className="ui-copy mt-3 max-w-xl text-base">
                Vuelve a la semana y guarda o importa un menú para generar tu
                lista de la compra.
              </p>
            </StateMessage>
          ) : isLoadingList ? (
            <Card className="p-6 sm:p-7">
              <p className="ui-eyebrow">Generando</p>
              <h2 className="mt-3 text-2xl font-semibold text-[color:var(--color-foreground)] sm:text-3xl">
                Generando tu lista
              </h2>
              <p className="ui-copy mt-3 max-w-xl text-base">
                Estamos calculando los ingredientes de tu semana actual.
              </p>
              <div className="mt-5 h-2 overflow-hidden rounded-full bg-[color:var(--color-surface-muted)]">
                <div className="h-full w-1/2 rounded-full bg-[color:var(--color-accent)] transition-all duration-700 ease-out motion-reduce:transition-none motion-safe:animate-pulse" />
              </div>
            </Card>
          ) : errorMessage ? (
            <StateMessage
              className="p-6 sm:p-7"
              title="No se pudo generar la lista."
              variant="error"
            >
              <p className="max-w-xl text-base leading-7">{errorMessage}</p>
            </StateMessage>
          ) : selectedGroup ? (
            <ShoppingItemsForCategory
              group={selectedGroup}
              checkedItems={checkedItems}
              onToggleCheckedItem={toggleCheckedItem}
            />
          ) : (
            <StateMessage title="No hace falta comprar nada." variant="empty">
              <p className="ui-copy mt-3 max-w-xl text-base">
                Todos los ingredientes de esta semana ya están cubiertos con tu
                despensa base.
              </p>
            </StateMessage>
          )}
        </section>
      </div>
    </main>
  );
}
