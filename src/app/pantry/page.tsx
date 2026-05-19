"use client";

import { useEffect, useState } from "react";

import { StickyPageHeader } from "@/components/layout/StickyPageHeader";
import { Card } from "@/components/ui/Card";
import { CategoryPill as BaseCategoryPill } from "@/components/ui/CategoryPill";
import { CheckboxItem } from "@/components/ui/CheckboxItem";
import { StateMessage } from "@/components/ui/StateMessage";
import { StatusPill } from "@/components/ui/StatusPill";
import { pantryBaseItems } from "@/data/mockPantry";
import { pageShellClass } from "@/lib/ui";
import {
  normalizePantryItemName,
  pantryHasItem,
  readPantryBase,
  savePantryBase,
} from "@/lib/pantryStorage";

type PantryCategory = "básicos" | "especias" | "salsas" | "aceites y vinagres" | "otros";

type PantryItem = {
  name: string;
  category: PantryCategory;
};

type PantryCategoryGroup = {
  category: PantryCategory;
  items: PantryItem[];
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
  "salsas",
  "aceites y vinagres",
  "otros",
];

const pantryCategoryByItem = new Map<string, PantryCategory>([
  [normalizePantryItemName("Sal"), "básicos"],
  [normalizePantryItemName("Pimienta"), "especias"],
  [normalizePantryItemName("Ajo en polvo"), "especias"],
  [normalizePantryItemName("Mostaza"), "salsas"],
  [normalizePantryItemName("Aceite de oliva"), "aceites y vinagres"],
  [normalizePantryItemName("Vinagre"), "aceites y vinagres"],
]);

function getPantryItemCategory(itemName: string): PantryCategory {
  return pantryCategoryByItem.get(normalizePantryItemName(itemName)) ?? "otros";
}

function groupPantryItems(items: readonly string[]): PantryCategoryGroup[] {
  return pantryCategoryOrder
    .map((category) => ({
      category,
      items: items
        .filter((item) => getPantryItemCategory(item) === category)
        .map((item) => ({
          name: item,
          category,
        })),
    }))
    .filter((group) => group.items.length > 0);
}

const pantryGroups = groupPantryItems(pantryBaseItems);

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
  group: PantryCategoryGroup;
  selectedItems: string[];
  onToggleItem: (itemName: string) => void;
};

function PantryItemsForCategory({
  group,
  selectedItems,
  onToggleItem,
}: PantryItemsForCategoryProps) {
  return (
    <Card className="overflow-hidden">
      <ul className="divide-y divide-[color:var(--color-border)]">
        {group.items.map((item) => {
          const isSelected = pantryHasItem(selectedItems, item.name);

          return (
            <li key={item.name}>
              <CheckboxItem
                checked={isSelected}
                label={item.name}
                onChange={() => onToggleItem(item.name)}
                status={isSelected ? "Activo" : "Inactivo"}
              />
            </li>
          );
        })}
      </ul>
    </Card>
  );
}

export default function PantryPage() {
  const [selectedItems, setSelectedItems] = useState<string[]>([]);
  const [hasLoadedPantry, setHasLoadedPantry] = useState(false);
  const [selectedCategory, setSelectedCategory] =
    useState<PantryCategory | null>(pantryGroups[0]?.category ?? null);
  const selectedCount = pantryBaseItems.filter((item) =>
    pantryHasItem(selectedItems, item),
  ).length;

  useEffect(() => {
    // Leemos localStorage solo al montar para evitar diferencias con el HTML inicial.
    const loadPantry = window.setTimeout(() => {
      setSelectedItems(readPantryBase());
      setHasLoadedPantry(true);
    }, 0);

    return () => window.clearTimeout(loadPantry);
  }, []);

  useEffect(() => {
    if (!hasLoadedPantry) {
      return;
    }

    savePantryBase(selectedItems);
  }, [hasLoadedPantry, selectedItems]);

  const toggleItem = (itemName: string) => {
    const normalizedItemName = normalizePantryItemName(itemName);

    setSelectedItems((currentItems) =>
      currentItems.includes(normalizedItemName)
        ? currentItems.filter((item) => item !== normalizedItemName)
        : [...currentItems, normalizedItemName],
    );
  };
  const categoryProgress = pantryGroups.map((group) => {
    const activeItemsInCategory = group.items.filter((item) =>
      pantryHasItem(selectedItems, item.name),
    ).length;

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
    <main className={`${pageShellClass} px-3 py-3 sm:px-6 sm:py-6`}>
      <div className="mx-auto flex w-full max-w-3xl flex-col gap-4 sm:gap-5">
        <StickyPageHeader
          title="DESPENSA"
          action={
            hasLoadedPantry ? (
              <PantryProgress
                activeItemsCount={selectedCount}
                totalItemsCount={pantryBaseItems.length}
              />
            ) : null
          }
        >
          {hasLoadedPantry && categoryProgress.length > 0 ? (
            <PantryCategorySelector
              categories={categoryProgress}
              selectedCategory={selectedCategory}
              onSelectCategory={setSelectedCategory}
            />
          ) : null}
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
              group={selectedGroup}
              selectedItems={selectedItems}
              onToggleItem={toggleItem}
            />
          ) : (
            <StateMessage title="No hay ingredientes disponibles." variant="empty">
              No hay ingredientes de despensa disponibles.
            </StateMessage>
          )}
        </section>
      </div>
    </main>
  );
}
