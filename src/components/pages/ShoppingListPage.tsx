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
  type ShoppingCategoryGroup,
  type ShoppingListItem,
  type SupermarketCategory,
} from "@/lib/shoppingList";
import {
  generateAndCacheShoppingListForWeek,
  getWeekSignature,
  readShoppingListCache,
  saveShoppingListCache,
  syncShoppingListToSupabase,
} from "@/lib/shoppingListStorage";
import { readSavedWeek } from "@/lib/weekStorage";

function capitalizeIngredientName(name: string) {
  if (!name) {
    return name;
  }

  return name.charAt(0).toUpperCase() + name.slice(1);
}

// Las categorías visibles son 6: los congelados se agrupan bajo "otros".
function withVisibleCategories<T extends { category: SupermarketCategory }>(
  items: T[],
): T[] {
  return items.map((item) =>
    item.category === "congelados" ? { ...item, category: "otros" } : item,
  );
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
  pantryItems: string[];
};

function ShoppingItemsForCategory({
  group,
  checkedItems,
  onToggleCheckedItem,
  pantryItems,
}: ShoppingItemsForCategoryProps) {
  return (
    <Card className="overflow-visible">
      <ul className="divide-y divide-[color:var(--color-border)]">
        {group.items.map((item) => {
          const isChecked = checkedItems.includes(item.id);
          const isAvailableInPantry = pantryHasItem(pantryItems, item.name);

          return (
            <li key={item.id}>
              <CheckboxItem
                checked={isChecked}
                label={capitalizeIngredientName(item.name)}
                meta={
                  isAvailableInPantry ? (
                    <span className="mt-1.5 inline-flex w-fit rounded-full bg-[color:var(--color-success-soft)] px-2.5 py-1 text-xs font-semibold text-[color:var(--color-muted-foreground)]">
                      En despensa
                    </span>
                  ) : null
                }
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
    const currentWeekDays = weekDays;
    const weekSignature = getWeekSignature(weekDays);

    async function generateShoppingList() {
      const cachedShoppingList = readShoppingListCache();

      if (cachedShoppingList?.weekSignature === weekSignature) {
        console.log("Lista de la compra: usando caché local");
        const cachedItems = groupShoppingListItems(
          withVisibleCategories(cachedShoppingList.items),
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
        const groupedItems = await generateAndCacheShoppingListForWeek(
          currentWeekDays,
          controller.signal,
        );

        void syncShoppingListToSupabase(groupedItems, []).catch(
          (error: unknown) => {
            console.warn(
              "No se pudo sincronizar la lista de la compra con Supabase:",
              error instanceof Error ? error.message : error,
            );
          },
        );

        setGeneratedItems(
          groupShoppingListItems(withVisibleCategories(groupedItems)).flatMap(
            (group) => group.items,
          ),
        );
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
    return groupShoppingListItems(generatedItems);
  }, [generatedItems]);

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
    void syncShoppingListToSupabase(generatedItems, nextCheckedItems).catch(
      (error: unknown) => {
        console.warn(
          "No se pudo sincronizar la lista de la compra con Supabase:",
          error instanceof Error ? error.message : error,
        );
      },
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
          title="Lista de la compra"
          heading="Tu compra"
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
              pantryItems={pantryItems}
            />
          ) : (
            <StateMessage title="No hay lista de la compra." variant="empty">
              <p className="ui-copy mt-3 max-w-xl text-base">
                Guarda una semana para generar los ingredientes que necesitas.
              </p>
            </StateMessage>
          )}
        </section>
      </div>
    </main>
  );
}
