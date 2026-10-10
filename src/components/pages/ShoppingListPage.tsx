"use client";

import { useEffect, useMemo, useRef, useState } from "react";

import { AiLoginNotice } from "@/components/features/AiLoginNotice";
import { useIdentity } from "@/components/session/IdentityProvider";
import { SyncNotice, type SyncState } from "@/components/session/SyncNotice";
import { SyncStatus } from "@/components/session/SyncStatus";
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
  loadWeek,
  readSelectedWeek,
  readShoppingCache,
} from "@/lib/data/repositories";
import { loadPantry, readCachedPantry } from "@/lib/data/pantry";
import {
  generateShoppingList,
  loadShoppingList,
  setShoppingItemChecked,
  type ShoppingLoad,
} from "@/lib/data/shopping";
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
import { ShoppingListApiError } from "@/lib/shoppingListStorage";
import { withWeekDates } from "@/lib/weekStorage";

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
  const [accountUnreachable, setAccountUnreachable] = useState(false);
  const [selectedCategory, setSelectedCategory] =
    useState<SupermarketCategory | null>(null);

  const identity = useIdentity();
  const [isoWeek, setIsoWeek] = useState<IsoWeek | null>(null);
  const [weekSyncState, setWeekSyncState] = useState<SyncState>({});
  const [listSyncState, setListSyncState] = useState<SyncState>({});
  // Bumped to read the list again (retry, or the account replaced the list).
  const [listReload, setListReload] = useState(0);
  // B5: «Reintentar» reads the week and its list again, which resends what is pending on this
  // device (marks, a list saved only here) without calling the AI. Marks on their way.
  const [syncReload, setSyncReload] = useState(0);
  const [savingChecks, setSavingChecks] = useState(0);
  const [hasCheckedList, setHasCheckedList] = useState(false);
  // Identity of the last read: «Reintentar» keeps the known state until the account answers.
  const lastLoadRef = useRef<string | null>(null);

  useEffect(() => {
    // Identity first: pantry, week and list all belong to the current identity.
    if (identity.status !== "ready") {
      return;
    }

    let isCancelled = false;
    const dataIdentity = { scope: identity.scope, userId: identity.userId };
    const weekToLoad = readSelectedWeek(dataIdentity) ?? getCurrentIsoWeek();
    const loadKey = `${dataIdentity.scope}:${identity.epoch}`;
    const isSameLoad = lastLoadRef.current === loadKey;
    lastLoadRef.current = loadKey;
    const loadTimer = window.setTimeout(() => {
      if (isSameLoad) {
        // Retry: the list stays on screen and its state stays visible while the account answers.
        void loadWeek(dataIdentity, weekToLoad).then((result) => {
          if (isCancelled) return;
          setWeekDays(result.data?.length ? withWeekDates(result.data, weekToLoad) : null);
          setWeekSyncState({ offline: result.offline, pending: result.pending });
          setListReload((value) => value + 1);
        });
        return;
      }

      setHasLoadedWeek(false);
      setGeneratedItems([]);
      setCheckedItems([]);
      setErrorMessage("");
      setNeedsLogin(false);
      setAccountUnreachable(false);
      setWeekSyncState({});
      setListSyncState({});
      setHasCheckedList(false);
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
        setWeekSyncState({ offline: result.offline, pending: result.pending });
        setHasLoadedWeek(true);
      });
    }, 0);

    return () => {
      isCancelled = true;
      window.clearTimeout(loadTimer);
    };
  }, [identity.status, identity.scope, identity.userId, identity.epoch, syncReload]);

  useEffect(() => {
    if (!hasLoadedWeek || !weekDays || weekDays.length === 0 || !isoWeek) {
      return;
    }

    // Leaving the page never cancels a generation: coming back waits for the same request.
    let isCancelled = false;
    const currentWeekDays = weekDays;
    const currentIsoWeek = isoWeek;
    const dataIdentity = { scope: identity.scope, userId: identity.userId };

    const show = (loaded: ShoppingLoad) => {
      if (isCancelled) return false;
      if (loaded.status !== "ready") return false;
      setGeneratedItems(loaded.view.items);
      setCheckedItems(loaded.view.checkedItemIds);
      setListSyncState({
        offline: loaded.view.offline,
        pending: loaded.view.pending,
        discardedLocalChanges: loaded.view.discardedLocalChanges,
      });
      setErrorMessage("");
      setNeedsLogin(false);
      setAccountUnreachable(false);
      return true;
    };

    async function resolveShoppingList() {
      // 1. The account list of this week (this device's copy only if the account is unreachable).
      const loaded = await loadShoppingList(dataIdentity, currentIsoWeek, currentWeekDays);

      if (!isCancelled) {
        setHasCheckedList(true);
      }

      if (isCancelled || show(loaded)) {
        return;
      }

      if (loaded.status === "no_week") {
        setWeekDays(null);
        return;
      }

      // Without checking the account, generating could duplicate a list that already exists.
      if (loaded.status === "missing" && loaded.offline) {
        setGeneratedItems([]);
        setAccountUnreachable(true);
        return;
      }

      // Guests keep reading their local week; only the AI call needs a session.
      if (!(await getAccessToken())) {
        if (!isCancelled) {
          setGeneratedItems([]);
          setNeedsLogin(true);
        }
        return;
      }

      // 2. Generate with AI only when the account has no list for this week's dishes.
      setNeedsLogin(false);
      setIsLoadingList(true);
      setErrorMessage("");

      try {
        const generated = await generateShoppingList(dataIdentity, currentIsoWeek, currentWeekDays);

        if (!show(generated) && !isCancelled) {
          // The week changed while generating: read it again.
          setListReload((value) => value + 1);
        }
      } catch (error) {
        if (isCancelled) {
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
        if (!isCancelled) {
          setIsLoadingList(false);
        }
      }
    }

    void resolveShoppingList();

    return () => {
      isCancelled = true;
    };
  }, [hasLoadedWeek, weekDays, isoWeek, identity.scope, identity.userId, listReload]);

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
    if (!isoWeek) {
      return;
    }

    const checked = !checkedItems.includes(itemId);
    setCheckedItems((current) =>
      checked ? [...current, itemId] : current.filter((currentItemId) => currentItemId !== itemId),
    );

    // Only this item is written; the list and the other items stay as they are.
    const dataIdentity = { scope: identity.scope, userId: identity.userId };
    setSavingChecks((count) => count + 1);
    void setShoppingItemChecked(dataIdentity, isoWeek, itemId, checked).then((result) => {
      setSavingChecks((count) => count - 1);
      if (result.status === "stale") {
        setListSyncState({ conflict: true });
        setListReload((value) => value + 1);
      } else if (result.status === "pending") {
        setListSyncState((current) => ({ ...current, pending: true }));
      } else if (result.status === "synced") {
        // Still pending only if other marks of this list did not reach the account.
        const pendingChecks = readShoppingCache(dataIdentity, isoWeek)?.pendingChecks ?? {};
        setListSyncState((current) => ({ ...current, pending: Object.keys(pendingChecks).length > 0 }));
      }
    });
  };

  const syncState: SyncState = {
    offline: weekSyncState.offline || listSyncState.offline,
    pending: weekSyncState.pending || listSyncState.pending,
    conflict: listSyncState.conflict,
    discardedLocalChanges: listSyncState.discardedLocalChanges,
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

        {generatedItems.length > 0 || syncState.offline || syncState.pending ? (
          <SyncStatus
            signedIn={identity.userId !== null}
            saving={savingChecks > 0}
            checking={!hasCheckedList}
            offline={syncState.offline}
            pending={syncState.pending}
            onRetry={() => setSyncReload((count) => count + 1)}
          />
        ) : null}
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
          ) : accountUnreachable ? (
            <StateMessage
              className="p-6 sm:p-7"
              title="No se ha podido comprobar tu lista."
              variant="error"
            >
              <p className="max-w-xl text-base leading-7">
                Revisa la conexión. No generamos otra lista hasta comprobar la que ya tienes en tu
                cuenta.
              </p>
              <button
                type="button"
                onClick={() => setListReload((value) => value + 1)}
                className="mt-4 min-h-11 rounded-[var(--radius-control)] border border-[color:var(--color-border-strong)] bg-[color:var(--color-surface)] px-4 text-sm font-semibold text-[color:var(--color-foreground)]"
              >
                Reintentar
              </button>
            </StateMessage>
          ) : errorMessage ? (
            <StateMessage
              className="p-6 sm:p-7"
              title="No se pudo generar la lista."
              variant="error"
            >
              <p className="max-w-xl text-base leading-7">{errorMessage}</p>
              <button
                type="button"
                onClick={() => setListReload((value) => value + 1)}
                className="mt-4 min-h-11 rounded-[var(--radius-control)] border border-[color:var(--color-border-strong)] bg-[color:var(--color-surface)] px-4 text-sm font-semibold text-[color:var(--color-foreground)]"
              >
                Reintentar
              </button>
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
