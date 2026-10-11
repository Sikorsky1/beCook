"use client";

import { Plus, Trash2 } from "lucide-react";
import type { FormEvent } from "react";
import { useEffect, useRef, useState } from "react";

import { PantryBasicsPicker } from "@/components/features/PantryBasicsPicker";
import { PantryStockToggle } from "@/components/features/PantryStockToggle";
import { StickyPageHeader } from "@/components/layout/StickyPageHeader";
import { ShoppingTabs } from "@/components/layout/ShoppingTabs";
import { PrimaryButton, TertiaryButton } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { CategoryPill as BaseCategoryPill } from "@/components/ui/CategoryPill";
import { IconButton } from "@/components/ui/IconButton";
import { StatusPill } from "@/components/ui/StatusPill";
import { TextInput } from "@/components/ui/TextInput";
import { useIdentity } from "@/components/session/IdentityProvider";
import { SyncNotice, type SyncState } from "@/components/session/SyncNotice";
import { SyncStatus } from "@/components/session/SyncStatus";
import {
  addPantryItem,
  addPantryItems,
  createDeferredDeletes,
  deletePantryItem,
  loadPantry,
  readPantryView,
  setPantryItemActive,
  type PantryChangeResult,
} from "@/lib/data/pantry";
import type { DataIdentity } from "@/lib/data/repositories";
import { pageShellClass } from "@/lib/ui";
import {
  capitalizePantryItemName,
  normalizePantryItemName,
  pantryBasicsToOffer,
  pantryCategoryOrder,
  pantryItemKey,
  type PantryCategory,
  type PantryStorageItem,
} from "@/lib/pantryStorage";

// D5: a delete waits this long so it can be undone.
const DELETE_DELAY_MS = 6000;

type PantryCategoryGroup = {
  category: PantryCategory;
  items: PantryStorageItem[];
};

type PantryCategoryProgress = {
  category: PantryCategory;
  active: number;
  total: number;
  isCompleted: boolean;
};

function groupPantryItems(items: PantryStorageItem[]): PantryCategoryGroup[] {
  return pantryCategoryOrder.map((category) => ({
    category,
    items: items
      .filter((item) => item.category === category)
      .sort((firstItem, secondItem) =>
        firstItem.name.localeCompare(secondItem.name, "es"),
      ),
  }));
}

type PantryProgressProps = {
  activeItemsCount: number;
  totalItemsCount: number;
};

function PantryProgress({
  activeItemsCount,
  totalItemsCount,
}: PantryProgressProps) {
  return (
    <StatusPill>
      {activeItemsCount}/{totalItemsCount} en casa
    </StatusPill>
  );
}

type PantryCategoryPillProps = PantryCategoryProgress & {
  isSelected: boolean;
  onSelect: () => void;
};

function PantryCategoryPill({
  category,
  active,
  total,
  isCompleted,
  isSelected,
  onSelect,
}: PantryCategoryPillProps) {
  return (
    <BaseCategoryPill
      isCompleted={isCompleted}
      isSelected={isSelected}
      label={category}
      meta={`${active}/${total}`}
      aria-label={`${category}: ${active} de ${total} disponibles`}
      onClick={onSelect}
    />
  );
}

type PantryCategorySelectorProps = {
  categories: PantryCategoryProgress[];
  selectedCategory: PantryCategory | null;
  onSelectCategory: (category: PantryCategory) => void;
};

function PantryCategorySelector({
  categories,
  selectedCategory,
  onSelectCategory,
}: PantryCategorySelectorProps) {
  const gridColumnsClass =
    categories.length === 1
      ? "grid-cols-1"
      : categories.length === 2 || categories.length === 4
        ? "grid-cols-2"
        : "grid-cols-3";

  return (
    <div
      className={`grid ${gridColumnsClass} gap-2`}
      role="group"
      aria-label="Categorías de despensa"
    >
      {categories.map((categoryProgress) => (
        <PantryCategoryPill
          key={categoryProgress.category}
          {...categoryProgress}
          isSelected={selectedCategory === categoryProgress.category}
          onSelect={() => onSelectCategory(categoryProgress.category)}
        />
      ))}
    </div>
  );
}

type PantryItemsForCategoryProps = {
  draftItemName: string;
  isAddingItem: boolean;
  group: PantryCategoryGroup;
  onCancelAddItem: () => void;
  onDeleteItem: (category: PantryCategory, itemName: string) => void;
  onDraftItemNameChange: (itemName: string) => void;
  onShowAddItem: () => void;
  onSubmitAddItem: (event: FormEvent<HTMLFormElement>) => void;
  onSetItemActive: (category: PantryCategory, itemName: string, active: boolean) => void;
};

function PantryItemsForCategory({
  draftItemName,
  group,
  isAddingItem,
  onCancelAddItem,
  onDeleteItem,
  onDraftItemNameChange,
  onShowAddItem,
  onSubmitAddItem,
  onSetItemActive,
}: PantryItemsForCategoryProps) {
  return (
    <Card className="overflow-hidden">
      <div className="sticky top-0 z-10 border-b border-[color:var(--color-border)] bg-[color:var(--color-surface)] px-4 py-3 sm:px-5">
        <div className="flex items-center justify-between gap-3">
          <div>
            <h2 className="t-h3 capitalize text-[color:var(--color-foreground)]">
              {group.category}
            </h2>
            <p className="t-meta mt-1">
              {group.items.filter((item) => item.active).length} de {group.items.length} en casa
            </p>
          </div>

          {!isAddingItem ? (
            <TertiaryButton
              onClick={onShowAddItem}
              className="shrink-0 rounded-full"
            >
              <Plus aria-hidden="true" className="h-4 w-4" />
              Añadir
            </TertiaryButton>
          ) : null}
        </div>

        {isAddingItem ? (
          <form
            onSubmit={onSubmitAddItem}
            className="mt-3 grid gap-2 sm:grid-cols-[minmax(0,1fr)_auto_auto]"
          >
            <TextInput
              value={draftItemName}
              onChange={(event) => onDraftItemNameChange(event.target.value)}
              placeholder={`Añadir en ${group.category}`}
              aria-label={`Añadir artículo en ${group.category}`}
              autoFocus
            />
            <PrimaryButton
              type="submit"
              disabled={!draftItemName.trim()}
              className="rounded-full"
            >
              Guardar
            </PrimaryButton>
            <TertiaryButton
              onClick={onCancelAddItem}
              className="rounded-full"
            >
              Cancelar
            </TertiaryButton>
          </form>
        ) : null}
      </div>

      {group.items.length > 0 ? (
        <ul className="max-h-[min(56dvh,34rem)] overflow-y-auto divide-y divide-[color:var(--color-border)]">
          {group.items.map((item) => (
            <li key={`${item.category}:${item.name}`} className="flex flex-wrap items-center gap-x-3 gap-y-2 px-4 py-3 sm:px-5">
              <div className="min-w-0 flex-1">
                <p className="t-body-strong text-[color:var(--color-foreground)]">{item.name}</p>
                <p className="t-meta mt-0.5">{item.active ? "En casa" : "Se ha acabado: sale en la compra"}</p>
              </div>
              <PantryStockToggle
                name={item.name}
                active={item.active}
                onChange={(active) => onSetItemActive(group.category, item.name, active)}
              />
              <IconButton
                aria-label={`Borrar ${item.name}`}
                onClick={() => onDeleteItem(group.category, item.name)}
                className="shrink-0"
              >
                <Trash2 aria-hidden="true" className="h-4 w-4" />
              </IconButton>
            </li>
          ))}
        </ul>
      ) : (
        <div className="t-meta px-4 py-5 sm:px-5">
          Aún no hay artículos en esta sección.
        </div>
      )}
    </Card>
  );
}

export default function PantryPage() {
  const [pantryItems, setPantryItems] = useState<PantryStorageItem[]>([]);
  const [syncState, setSyncState] = useState<SyncState>({});
  const [hasLoadedPantry, setHasLoadedPantry] = useState(false);
  // B5: the account has not answered the first read yet · changes on their way · «Reintentar»
  // (reads the pantry again, which first sends the changes pending on this device).
  const [isCheckingAccount, setIsCheckingAccount] = useState(true);
  const [savingChanges, setSavingChanges] = useState(0);
  const [reloadCount, setReloadCount] = useState(0);
  // Identity of the last read: reading again keeps the known state until the account answers.
  const lastLoadRef = useRef<string | null>(null);
  const identity = useIdentity();
  const [draftItemName, setDraftItemName] = useState("");
  const [addingCategory, setAddingCategory] = useState<PantryCategory | null>(
    null,
  );
  const [selectedCategory, setSelectedCategory] =
    useState<PantryCategory | null>(pantryCategoryOrder[0]);
  // D5: deletes waiting ~6 s so they can be undone (hidden meanwhile), with the names shown.
  const [pendingDeletes, setPendingDeletes] = useState<string[]>([]);
  const [deletedNames, setDeletedNames] = useState<Record<string, string>>({});
  const [basicsMessage, setBasicsMessage] = useState("");
  const deletesRef = useRef<ReturnType<typeof createDeferredDeletes> | null>(null);
  const deleteTargets = useRef(new Map<string, { identity: DataIdentity; category: PantryCategory; name: string }>());
  const currentScopeRef = useRef<string | null>(null);
  const visibleItems = pantryItems.filter((item) => !pendingDeletes.includes(pantryItemKey(item)));
  const selectedCount = visibleItems.filter((item) => item.active).length;

  useEffect(() => {
    currentScopeRef.current = identity.status === "ready" ? identity.scope : null;
  }, [identity.status, identity.scope]);

  // The deferred deletes live as long as the page; leaving it (or another identity) commits them.
  useEffect(() => {
    const deletes = createDeferredDeletes({
      delayMs: DELETE_DELAY_MS,
      onChange: setPendingDeletes,
      commit: (key) => {
        const target = deleteTargets.current.get(key);
        deleteTargets.current.delete(key);
        if (!target) return;
        setSavingChanges((count) => count + 1);
        void deletePantryItem(target.identity, target.category, target.name).then((result) => {
          setSavingChanges((count) => count - 1);
          if (currentScopeRef.current !== target.identity.scope) return;
          setPantryItems(readPantryView(target.identity));
          if (result.status === "conflict") setSyncState({ discardedLocalChanges: true });
          else setSyncState(result.status === "pending" ? { pending: true } : {});
        });
      },
    });
    deletesRef.current = deletes;
    return () => deletes.flush();
  }, []);

  useEffect(() => {
    const deletes = deletesRef.current;
    return () => deletes?.flush();
  }, [identity.scope, identity.epoch]);

  useEffect(() => {
    // Identity first; the pantry shown always belongs to the current identity.
    if (identity.status !== "ready") {
      return;
    }

    let isCancelled = false;
    const dataIdentity = { scope: identity.scope, userId: identity.userId };
    const loadKey = `${dataIdentity.scope}:${identity.epoch}`;
    const loadTimer = window.setTimeout(() => {
      const isSameLoad = lastLoadRef.current === loadKey;
      lastLoadRef.current = loadKey;
      setSyncState((current) => (isSameLoad ? { pending: current.pending, offline: current.offline } : {}));
      setPantryItems(readPantryView(dataIdentity));
      setHasLoadedPantry(true);
      setIsCheckingAccount(true);

      void loadPantry(dataIdentity).then((result) => {
        if (isCancelled) {
          return;
        }

        setIsCheckingAccount(false);
        // The device copy now holds the account pantry plus any change made meanwhile.
        setPantryItems(readPantryView(dataIdentity));
        setSyncState({
          offline: result.offline,
          discardedLocalChanges: result.discardedLocalChanges,
          pending: result.pending,
        });
      });
    }, 0);

    return () => {
      isCancelled = true;
      window.clearTimeout(loadTimer);
    };
  }, [identity.status, identity.scope, identity.userId, identity.epoch, reloadCount]);

  // B7: each change writes only that item. The device copy changes at once and is shown; the
  // list shown after the account answers is the device copy at that moment (later changes kept).
  const dataIdentity = { scope: identity.scope, userId: identity.userId };
  const showChange = (change: Promise<PantryChangeResult>) => {
    setPantryItems(readPantryView(dataIdentity));
    setSavingChanges((count) => count + 1);
    void change.then((result) => {
      setSavingChanges((count) => count - 1);
      setPantryItems(readPantryView(dataIdentity));
      if (result.status === "conflict") {
        setSyncState({ discardedLocalChanges: true });
      } else {
        setSyncState(result.status === "pending" ? { pending: true } : {});
      }
    });
  };

  const showAddItem = (category: PantryCategory) => {
    setSelectedCategory(category);
    setAddingCategory(category);
    setDraftItemName("");
  };

  const selectCategory = (category: PantryCategory) => {
    setSelectedCategory(category);
    setAddingCategory(null);
    setDraftItemName("");
  };

  const cancelAddItem = () => {
    setAddingCategory(null);
    setDraftItemName("");
  };

  const addItem = (category: PantryCategory, event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    const displayName = capitalizePantryItemName(draftItemName);

    if (!displayName) {
      return;
    }

    const normalizedItemName = normalizePantryItemName(displayName);

    // Deleted a moment ago and not yet in the account: adding it again undoes the delete.
    const key = pantryItemKey({ category, name: displayName });
    if (pendingDeletes.includes(key)) {
      undoDelete(key);
      setAddingCategory(null);
      setDraftItemName("");
      return;
    }

    if (
      pantryItems.some(
        (item) =>
          item.category === category &&
          normalizePantryItemName(item.name) === normalizedItemName,
      )
    ) {
      setDraftItemName("");
      return;
    }

    showChange(addPantryItem(dataIdentity, category, displayName));
    setSelectedCategory(category);
    setAddingCategory(null);
    setDraftItemName("");
  };

  // «Tengo / Se acabó» sets the value (never toggles).
  const setItemActive = (category: PantryCategory, itemName: string, active: boolean) => {
    const normalizedItemName = normalizePantryItemName(itemName);
    const item = pantryItems.find(
      (pantryItem) =>
        pantryItem.category === category &&
        normalizePantryItemName(pantryItem.name) === normalizedItemName,
    );

    if (item && item.active !== active) {
      showChange(setPantryItemActive(dataIdentity, category, item.name, active));
    }
  };

  // The item disappears at once; it is deleted in the account after ~6 s unless «Deshacer».
  const deleteItem = (category: PantryCategory, itemName: string) => {
    const key = pantryItemKey({ category, name: itemName });
    deleteTargets.current.set(key, { identity: dataIdentity, category, name: itemName });
    setDeletedNames((current) => ({ ...current, [key]: itemName }));
    deletesRef.current?.schedule(key);
  };

  const undoDelete = (key: string) => {
    deletesRef.current?.undo(key);
    deleteTargets.current.delete(key);
  };

  const addBasics = (basics: { name: string; category: PantryCategory }[]) => {
    // A basic deleted a moment ago comes back by undoing that delete.
    const toAdd = basics.filter((basic) => {
      const key = pantryItemKey(basic);
      if (!pendingDeletes.includes(key)) return true;
      undoDelete(key);
      return false;
    });
    if (toAdd.length) showChange(addPantryItems(dataIdentity, toAdd));
    setBasicsMessage(
      basics.length === 1
        ? `«${basics[0].name}» añadido a tu despensa.`
        : `${basics.length} básicos añadidos a tu despensa.`,
    );
  };

  const pantryGroups = groupPantryItems(visibleItems);
  const categoryProgress = pantryGroups.map((group) => {
    const activeItemsInCategory = group.items.filter((item) => item.active).length;

    return {
      category: group.category,
      active: activeItemsInCategory,
      total: group.items.length,
      isCompleted:
        group.items.length > 0 && activeItemsInCategory === group.items.length,
    };
  });
  const selectedGroup =
    pantryGroups.find((group) => group.category === selectedCategory) ??
    pantryGroups[0] ??
    null;

  return (
    <main
      className={`${pageShellClass} px-3 pb-[calc(7.5rem+env(safe-area-inset-bottom))] pt-3 sm:px-6 sm:pt-6`}
    >
      <div className="mx-auto flex w-full max-w-3xl flex-col gap-4 sm:gap-5">
        <StickyPageHeader
          title="Despensa"
          heading="Tu despensa"
          action={
            hasLoadedPantry ? (
              <PantryProgress
                activeItemsCount={selectedCount}
                totalItemsCount={visibleItems.length}
              />
            ) : null
          }
        >
          <div className="space-y-2.5">
            <ShoppingTabs />

            {hasLoadedPantry && categoryProgress.length > 0 ? (
              <PantryCategorySelector
                categories={categoryProgress}
                selectedCategory={selectedCategory}
                onSelectCategory={selectCategory}
              />
            ) : null}
          </div>
        </StickyPageHeader>

        {hasLoadedPantry ? (
          <SyncStatus
            signedIn={identity.userId !== null}
            saving={savingChanges > 0}
            checking={isCheckingAccount}
            offline={syncState.offline}
            pending={syncState.pending}
            onRetry={() => setReloadCount((count) => count + 1)}
          />
        ) : null}
        {identity.userId ? <SyncNotice state={syncState} /> : null}

        {/* Persistent live region: deletes that can still be undone, and basics just added. */}
        <div role="status" className="space-y-2 empty:hidden">
          {pendingDeletes.map((key) => (
            <div
              key={key}
              className="flex flex-wrap items-center justify-between gap-2 rounded-[var(--radius-control)] border border-[color:var(--color-border-strong)] bg-[color:var(--color-surface)] px-4 py-2"
            >
              <p className="text-sm font-semibold text-[color:var(--color-foreground)]">«{deletedNames[key]}» borrado de la despensa.</p>
              <button
                type="button"
                onClick={() => undoDelete(key)}
                className="min-h-11 rounded-[var(--radius-control)] px-3 text-sm font-semibold text-[color:var(--color-accent-hover)] underline underline-offset-4"
              >
                Deshacer
              </button>
            </div>
          ))}
          {basicsMessage ? <p className="t-meta px-1">{basicsMessage}</p> : null}
        </div>

        {hasLoadedPantry ? <PantryBasicsPicker offered={pantryBasicsToOffer(visibleItems)} onAdd={addBasics} /> : null}

        <section className="transition-opacity duration-200 ease-out motion-reduce:transition-none">
          {!hasLoadedPantry ? (
            <Card className="p-6 sm:p-7">
              <p className="t-eyebrow">Preparando</p>
              <h2 className="t-h2 mt-3 text-[color:var(--color-foreground)]">
                Cargando tu despensa
              </h2>
            </Card>
          ) : selectedGroup ? (
            <PantryItemsForCategory
              draftItemName={
                addingCategory === selectedGroup.category ? draftItemName : ""
              }
              group={selectedGroup}
              isAddingItem={addingCategory === selectedGroup.category}
              onCancelAddItem={cancelAddItem}
              onDeleteItem={deleteItem}
              onDraftItemNameChange={setDraftItemName}
              onShowAddItem={() => showAddItem(selectedGroup.category)}
              onSubmitAddItem={(event) => addItem(selectedGroup.category, event)}
              onSetItemActive={setItemActive}
            />
          ) : (
            <Card className="t-meta p-6">
              No hay ingredientes de despensa disponibles.
            </Card>
          )}
        </section>
      </div>
    </main>
  );
}
