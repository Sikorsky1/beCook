"use client";

import { useEffect, useMemo, useState } from "react";

import { AiLoginNotice } from "@/components/features/AiLoginNotice";
import { useIdentity } from "@/components/session/IdentityProvider";
import { SyncNotice, type SyncState } from "@/components/session/SyncNotice";
import { StickyPageHeader } from "@/components/layout/StickyPageHeader";
import { ShoppingTabs } from "@/components/layout/ShoppingTabs";
import { Card } from "@/components/ui/Card";
import { CategoryPill as BaseCategoryPill } from "@/components/ui/CategoryPill";
import { CheckboxItem } from "@/components/ui/CheckboxItem";
import { StateMessage } from "@/components/ui/StateMessage";
import { StatusPill } from "@/components/ui/StatusPill";
import type { WeekDay } from "@/data/mockWeek";
import { isAiLoginRequiredError } from "@/lib/ai-client";
import {
  getRemoteWeekId,
  loadPantry,
  loadRemoteShoppingList,
  loadWeek,
  readCachedPantry,
  readSelectedWeek,
  readShoppingCache,
  writeShoppingCache,
  type ShoppingCache,
} from "@/lib/data/repositories";
import { getCurrentIsoWeek, type IsoWeek } from "@/lib/isoWeek";
import { getAccessToken } from "@/lib/supabase/auth";
import { pageShellClass } from "@/lib/ui";
import {
  activePantryNames,
  pantryHasItem,
  pantryItemsOrDefault,
} from "@/lib/pantryStorage";
import {
  groupShoppingListItems,
  type ShoppingCategoryGroup,
  type ShoppingListItem,
  type SupermarketCategory,
} from "@/lib/shoppingList";
import {
  generateAndCacheShoppingListForWeek,
  ShoppingListApiError,
  getWeekSignature,
  matchesWeekSignature,
  syncShoppingListToSupabase,
} from "@/lib/shoppingListStorage";
import { withWeekDates } from "@/lib/weekStorage";

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
  const [needsLogin, setNeedsLogin] = useState(false);
  const [selectedCategory, setSelectedCategory] =
    useState<SupermarketCategory | null>(null);

  const identity = useIdentity();
  const [isoWeek, setIsoWeek] = useState<IsoWeek | null>(null);
  const [remoteWeekId, setRemoteWeekId] = useState<string | null>(null);
  const [syncState, setSyncState] = useState<SyncState>({});

  useEffect(() => {
    // Identity first: pantry, week and list all belong to the current identity.
    if (identity.status !== "ready") {
      return;
    }

    let isCancelled = false;
    const dataIdentity = { scope: identity.scope, userId: identity.userId };
    const weekToLoad = readSelectedWeek(dataIdentity) ?? getCurrentIsoWeek();
    const loadTimer = window.setTimeout(() => {
      setHasLoadedWeek(false);
      setGeneratedItems([]);
      setCheckedItems([]);
      setErrorMessage("");
      setNeedsLogin(false);
      setSyncState({});
      setRemoteWeekId(null);
      setIsoWeek(weekToLoad);
      setPantryItems(activePantryNames(pantryItemsOrDefault(readCachedPantry(dataIdentity))));

      void loadPantry(dataIdentity).then((result) => {
        if (!isCancelled) {
          setPantryItems(activePantryNames(pantryItemsOrDefault(result.data)));
        }
      });

      // The week is revalidated before deciding that there is nothing to shop for.
      void loadWeek(dataIdentity, weekToLoad).then((result) => {
        if (isCancelled) {
          return;
        }

        setWeekDays(result.data?.length ? withWeekDates(result.data, weekToLoad) : null);
        setSyncState({ offline: result.offline, pending: result.pending });
        setHasLoadedWeek(true);
      });
    }, 0);

    return () => {
      isCancelled = true;
      window.clearTimeout(loadTimer);
    };
  }, [identity.status, identity.scope, identity.userId, identity.epoch]);

  useEffect(() => {
    if (!hasLoadedWeek || !weekDays || weekDays.length === 0 || !isoWeek) {
      return;
    }

    const controller = new AbortController();
    const currentWeekDays = weekDays;
    const currentIsoWeek = isoWeek;
    const weekSignature = getWeekSignature(weekDays);
    const dataIdentity = { scope: identity.scope, userId: identity.userId };

    const showItems = (items: ShoppingCache["items"], checkedItemIds: string[]) => {
      const visibleItems = groupShoppingListItems(withVisibleCategories(items)).flatMap(
        (group) => group.items,
      );
      const visibleIds = new Set(visibleItems.map((item) => item.id));
      setGeneratedItems(visibleItems);
      setCheckedItems(checkedItemIds.filter((itemId) => visibleIds.has(itemId)));
      setErrorMessage("");
      setNeedsLogin(false);
    };

    async function resolveShoppingList() {
      if (dataIdentity.userId) {
        void getRemoteWeekId(dataIdentity, currentIsoWeek)
          .then((weekId) => {
            if (!controller.signal.aborted) setRemoteWeekId(weekId);
          })
          .catch(() => undefined);
      }

      // 1. This identity's cache for this exact week content.
      const cachedShoppingList = readShoppingCache(dataIdentity, currentIsoWeek);

      if (cachedShoppingList && matchesWeekSignature(cachedShoppingList.weekSignature, currentWeekDays)) {
        if (cachedShoppingList.weekSignature !== weekSignature) {
          writeShoppingCache(dataIdentity, currentIsoWeek, { ...cachedShoppingList, weekSignature });
        }
        showItems(cachedShoppingList.items, cachedShoppingList.checkedItemIds);
        return;
      }

      // 2. The account's list for this week (another device may have created it).
      if (dataIdentity.userId) {
        try {
          const remoteList = await loadRemoteShoppingList(dataIdentity, currentIsoWeek);

          if (controller.signal.aborted) {
            return;
          }

          if (remoteList) {
            writeShoppingCache(dataIdentity, currentIsoWeek, {
              weekSignature,
              items: remoteList.items,
              checkedItemIds: remoteList.checkedItemIds,
            });
            setRemoteWeekId(remoteList.weekId);
            showItems(remoteList.items, remoteList.checkedItemIds);
            return;
          }
        } catch {
          // Unreachable account: fall through; generating needs the network anyway.
        }
      }

      // Guests keep reading their local week; only the AI call needs a session.
      if (!(await getAccessToken())) {
        if (!controller.signal.aborted) {
          setGeneratedItems([]);
          setNeedsLogin(true);
        }
        return;
      }

      // 3. Generate with AI only when no list exists for this week.
      setNeedsLogin(false);
      setIsLoadingList(true);
      setErrorMessage("");

      try {
        const groupedItems = await generateAndCacheShoppingListForWeek(
          dataIdentity,
          currentIsoWeek,
          currentWeekDays,
          controller.signal,
        );
        const weekId = await getRemoteWeekId(dataIdentity, currentIsoWeek).catch(() => null);
        setRemoteWeekId(weekId);

        void syncShoppingListToSupabase(groupedItems, [], weekId).catch(
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

        if (isAiLoginRequiredError(error)) {
          setNeedsLogin(true);
          return;
        }

        setErrorMessage(
          error instanceof ShoppingListApiError
            ? error.message
            : "Ha fallado la conexión al generar la lista de la compra.",
        );
      } finally {
        setIsLoadingList(false);
      }
    }

    void resolveShoppingList();

    return () => controller.abort();
  }, [hasLoadedWeek, weekDays, isoWeek, identity.scope, identity.userId]);

  useEffect(() => {
    if (!weekDays || weekDays.length === 0 || generatedItems.length === 0 || !isoWeek) {
      return;
    }

    const dataIdentity = { scope: identity.scope, userId: identity.userId };
    const weekSignature = getWeekSignature(weekDays);
    const cachedShoppingList = readShoppingCache(dataIdentity, isoWeek);

    if (!cachedShoppingList || !matchesWeekSignature(cachedShoppingList.weekSignature, weekDays)) {
      return;
    }

    const availableItemIds = new Set(generatedItems.map((item) => item.id));
    const persistedCheckedItems = checkedItems.filter((itemId) =>
      availableItemIds.has(itemId),
    );

    writeShoppingCache(dataIdentity, isoWeek, {
      ...cachedShoppingList,
      weekSignature,
      checkedItemIds: persistedCheckedItems,
    });
  }, [checkedItems, generatedItems, weekDays, isoWeek, identity.scope, identity.userId]);

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

    if (!identity.userId) {
      return;
    }

    void syncShoppingListToSupabase(generatedItems, nextCheckedItems, remoteWeekId).catch(
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

        {identity.userId ? <SyncNotice state={syncState} /> : null}

        <section className="transition-opacity duration-200 ease-out motion-reduce:transition-none">
          {!hasLoadedWeek ? (
            <Card className="p-6 sm:p-7">
              <p className="t-eyebrow">Preparando</p>
              <h2 className="t-h2 mt-3 text-[color:var(--color-foreground)]">
                Cargando tu semana
              </h2>
              <p className="t-meta mt-3 max-w-xl">
                Estamos preparando la lista de la compra con tu menú guardado.
              </p>
            </Card>
          ) : !weekDays || weekDays.length === 0 ? (
            <StateMessage title="No hay una semana guardada." variant="empty">
              <p className="t-meta max-w-xl">
                Vuelve a la semana y guarda o importa un menú para generar tu
                lista de la compra.
              </p>
            </StateMessage>
          ) : isLoadingList ? (
            <Card className="p-6 sm:p-7">
              <p className="t-eyebrow">Generando</p>
              <h2 className="t-h2 mt-3 text-[color:var(--color-foreground)]">
                Generando tu lista
              </h2>
              <p className="t-meta mt-3 max-w-xl">
                Estamos calculando los ingredientes de tu semana actual.
              </p>
              <div className="mt-5 h-2 overflow-hidden rounded-full bg-[color:var(--color-surface-muted)]">
                <div className="h-full w-1/2 rounded-full bg-[color:var(--color-accent)] transition-all duration-700 ease-out motion-reduce:transition-none motion-safe:animate-pulse" />
              </div>
            </Card>
          ) : needsLogin ? (
            <AiLoginNotice
              className="p-6 sm:p-7"
              returnPath="/shopping/list"
              description="Tu semana sigue guardada en este dispositivo. Inicia sesión para calcular la lista de la compra con IA."
            />
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
              <p className="t-meta max-w-xl">
                Guarda una semana para generar los ingredientes que necesitas.
              </p>
            </StateMessage>
          )}
        </section>
      </div>
    </main>
  );
}
