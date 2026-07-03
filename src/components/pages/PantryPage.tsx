"use client";

import { Plus, Trash2 } from "lucide-react";
import type { FormEvent } from "react";
import { useEffect, useState } from "react";

import { StickyPageHeader } from "@/components/layout/StickyPageHeader";
import { ShoppingTabs } from "@/components/layout/ShoppingTabs";
import { PrimaryButton, TertiaryButton } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { CategoryPill as BaseCategoryPill } from "@/components/ui/CategoryPill";
import { CheckboxItem } from "@/components/ui/CheckboxItem";
import { IconButton } from "@/components/ui/IconButton";
import { StatusPill } from "@/components/ui/StatusPill";
import { TextInput } from "@/components/ui/TextInput";
import { pageShellClass } from "@/lib/ui";
import {
  capitalizePantryItemName,
  normalizePantryItemName,
  readPantryItems,
  savePantryItems,
  type PantryCategory,
  type PantryStorageItem,
} from "@/lib/pantryStorage";

const PROFILE_STORAGE_KEY = "becook-profile";

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

const pantryCategoryOrder: PantryCategory[] = [
  "básicos",
  "especias",
  "aceites y vinagres",
  "salsas",
  "conservas",
  "congelados",
  "otros",
];

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

function getProfileIdFromLocalStorage() {
  if (typeof window === "undefined") {
    return null;
  }

  const savedProfile = window.localStorage.getItem(PROFILE_STORAGE_KEY);

  if (!savedProfile) {
    return null;
  }

  try {
    const parsedProfile = JSON.parse(savedProfile) as { id?: unknown };

    return typeof parsedProfile.id === "string" && parsedProfile.id
      ? parsedProfile.id
      : null;
  } catch {
    return null;
  }
}

function syncPantryToSupabase(
  items: PantryStorageItem[],
  profileId: string | null,
) {
  try {
    const pantryItems = items.map((item) => ({
      name: item.name,
      category: item.category,
      active: item.active,
    }));

    void import("@/lib/supabase/pantry")
      .then(async ({ replacePantryItemsInSupabase }) => {
        const { getCurrentUser } = await import("@/lib/supabase/auth");
        const currentUser = await getCurrentUser();

        return replacePantryItemsInSupabase(
          pantryItems,
          profileId ?? undefined,
          currentUser?.id,
        );
      })
      .catch((error: unknown) => {
        console.warn(
          "No se pudo sincronizar la despensa con Supabase:",
          error instanceof Error ? error.message : error,
        );
      });
  } catch (error: unknown) {
    console.warn(
      "No se pudo sincronizar la despensa con Supabase:",
      error instanceof Error ? error.message : error,
    );
  }
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
      {activeItemsCount}/{totalItemsCount} activos
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
      meta={`${active}/${total} activos`}
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
      role="tablist"
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
  onToggleItem: (category: PantryCategory, itemName: string) => void;
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
  onToggleItem,
}: PantryItemsForCategoryProps) {
  return (
    <Card className="overflow-hidden">
      <div className="sticky top-0 z-10 border-b border-[color:var(--color-border)] bg-[color:var(--color-surface)] px-4 py-3 sm:px-5">
        <div className="flex items-center justify-between gap-3">
          <div>
            <h2 className="text-lg font-semibold capitalize leading-tight text-[color:var(--color-foreground)]">
              {group.category}
            </h2>
            <p className="mt-0.5 text-xs font-semibold uppercase tracking-[0.16em] text-[color:var(--color-muted-foreground)]">
              {group.items.filter((item) => item.active).length}/
              {group.items.length} activos
            </p>
          </div>

          {!isAddingItem ? (
            <TertiaryButton
              onClick={onShowAddItem}
              className="min-h-10 shrink-0 rounded-full px-3 text-xs sm:px-4"
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
              className="min-h-10 py-2.5 text-sm"
              autoFocus
            />
            <PrimaryButton
              type="submit"
              disabled={!draftItemName.trim()}
              className="min-h-10 rounded-full px-4 text-xs"
            >
              Guardar
            </PrimaryButton>
            <TertiaryButton
              onClick={onCancelAddItem}
              className="min-h-10 rounded-full px-4 text-xs"
            >
              Cancelar
            </TertiaryButton>
          </form>
        ) : null}
      </div>

      {group.items.length > 0 ? (
        <ul className="max-h-[min(56dvh,34rem)] overflow-y-auto divide-y divide-[color:var(--color-border)]">
          {group.items.map((item) => (
            <li key={`${item.category}:${item.name}`}>
              <CheckboxItem
                checked={item.active}
                label={item.name}
                onChange={() => onToggleItem(group.category, item.name)}
                status={item.active ? "Activo" : "Inactivo"}
              >
                <IconButton
                  aria-label={`Borrar ${item.name}`}
                  onClick={() => onDeleteItem(group.category, item.name)}
                  className="h-10 w-10 shrink-0"
                >
                  <Trash2 aria-hidden="true" className="h-4 w-4" />
                </IconButton>
              </CheckboxItem>
            </li>
          ))}
        </ul>
      ) : (
        <div className="px-4 py-5 text-sm font-medium text-[color:var(--color-muted-foreground)] sm:px-5">
          Aún no hay artículos en esta sección.
        </div>
      )}
    </Card>
  );
}

export default function PantryPage() {
  const [pantryItems, setPantryItems] = useState<PantryStorageItem[]>([]);
  const [profileId, setProfileId] = useState<string | null>(null);
  const [hasLoadedPantry, setHasLoadedPantry] = useState(false);
  const [draftItemName, setDraftItemName] = useState("");
  const [addingCategory, setAddingCategory] = useState<PantryCategory | null>(
    null,
  );
  const [selectedCategory, setSelectedCategory] =
    useState<PantryCategory | null>(pantryCategoryOrder[0]);
  const selectedCount = pantryItems.filter((item) => item.active).length;

  useEffect(() => {
    // Leemos localStorage solo al montar para evitar diferencias con el HTML inicial.
    const loadPantry = window.setTimeout(() => {
      const localProfileId = getProfileIdFromLocalStorage();

      setProfileId(localProfileId);
      setPantryItems(readPantryItems());
      setHasLoadedPantry(true);

      if (!localProfileId) {
        void import("@/lib/supabase/profiles")
          .then(({ getLatestProfileFromSupabase }) =>
            getLatestProfileFromSupabase(),
          )
          .then((latestProfile) => {
            if (latestProfile?.id) {
              setProfileId(latestProfile.id);
            }
          })
          .catch((error: unknown) => {
            console.warn(
              "No se pudo recuperar el perfil para la despensa:",
              error instanceof Error ? error.message : error,
            );
          });
      }
    }, 0);

    return () => window.clearTimeout(loadPantry);
  }, []);

  useEffect(() => {
    if (!hasLoadedPantry) {
      return;
    }

    savePantryItems(pantryItems);
  }, [hasLoadedPantry, pantryItems]);

  const persistPantryItems = (nextPantryItems: PantryStorageItem[]) => {
    setPantryItems(nextPantryItems);
    syncPantryToSupabase(nextPantryItems, profileId);
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

    persistPantryItems([
      ...pantryItems,
      {
        name: displayName,
        category,
        active: true,
      },
    ]);
    setSelectedCategory(category);
    setAddingCategory(null);
    setDraftItemName("");
  };

  const toggleItem = (category: PantryCategory, itemName: string) => {
    const normalizedItemName = normalizePantryItemName(itemName);
    const nextPantryItems = pantryItems.map((item) =>
      item.category === category &&
      normalizePantryItemName(item.name) === normalizedItemName
        ? { ...item, active: !item.active }
        : item,
    );

    persistPantryItems(nextPantryItems);
  };

  const deleteItem = (category: PantryCategory, itemName: string) => {
    const normalizedItemName = normalizePantryItemName(itemName);
    const nextPantryItems = pantryItems.filter(
      (item) =>
        item.category !== category ||
        normalizePantryItemName(item.name) !== normalizedItemName,
    );

    persistPantryItems(nextPantryItems);
  };

  const pantryGroups = groupPantryItems(pantryItems);
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
          title="DESPENSA"
          heading="Tu despensa"
          action={
            hasLoadedPantry ? (
              <PantryProgress
                activeItemsCount={selectedCount}
                totalItemsCount={pantryItems.length}
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

        <section className="transition-opacity duration-200 ease-out motion-reduce:transition-none">
          {!hasLoadedPantry ? (
            <Card className="p-6 sm:p-7">
              <p className="ui-eyebrow">Preparando</p>
              <h2 className="mt-3 text-2xl font-semibold text-[color:var(--color-foreground)] sm:text-3xl">
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
              onToggleItem={toggleItem}
            />
          ) : (
            <Card className="p-6 text-sm font-medium text-[color:var(--color-muted-foreground)]">
              No hay ingredientes de despensa disponibles.
            </Card>
          )}
        </section>
      </div>
    </main>
  );
}
