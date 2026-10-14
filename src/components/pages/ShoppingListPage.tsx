"use client";

import { useEffect, useMemo, useRef, useState } from "react";

import { AiLoginNotice } from "@/components/features/AiLoginNotice";
import { ManualItemForm, type ManualItemDraft } from "@/components/features/ManualItemForm";
import {
  capitalize,
  ShoppingSection,
  shoppingSectionId,
  type ShoppingRowActions,
  type ShoppingRowData,
} from "@/components/features/ShoppingSection";
import { useIdentity } from "@/components/session/IdentityProvider";
import { SyncNotice, type SyncState } from "@/components/session/SyncNotice";
import { SyncStatus } from "@/components/session/SyncStatus";
import { StickyPageHeader } from "@/components/layout/StickyPageHeader";
import { ShoppingTabs } from "@/components/layout/ShoppingTabs";
import { Card } from "@/components/ui/Card";
import { StateMessage } from "@/components/ui/StateMessage";
import { StatusPill } from "@/components/ui/StatusPill";
import type { WeekDay } from "@/data/mockWeek";
import { isAiLoginRequiredError } from "@/lib/ai-client";
import {
  loadWeek,
  readSelectedWeek,
  readShoppingCache,
} from "@/lib/data/repositories";
import {
  ensurePantryItemInStock,
  loadPantry,
  markPantryItemUsedUp,
  readCachedPantry,
  readPantryView,
} from "@/lib/data/pantry";
import {
  addManualShoppingItem,
  generateShoppingList,
  loadShoppingList,
  readShoppingView,
  reconcileShoppingList,
  removeManualShoppingItem,
  setShoppingItemChecked,
  setShoppingItemQuantity,
  type EditResult,
  type PendingDish,
  type ShoppingLoad,
  type ShoppingView,
} from "@/lib/data/shopping";
import { formatIsoWeekTitle, getCurrentIsoWeek, type IsoWeek } from "@/lib/isoWeek";
import { getAccessToken } from "@/lib/supabase/auth";
import { pageShellStickyClass, pageStickyColumnClass } from "@/lib/ui";
import {
  activePantryNames,
  pantryItemsOrDefault,
} from "@/lib/pantryStorage";
import {
  classifyShoppingView,
  describeOrigins,
  pantryNameKeys,
  plannedDishes,
  type PlannedDish,
} from "@/lib/shopping/build";
import { describeReconcileSummary, type ReconcileSummary } from "@/lib/shopping/reconcile";
import { formatShoppingAmount, shoppingNameKey } from "@/lib/shopping/units";
import {
  supermarketCategoryLabels,
  type ShoppingViewItem,
  type SupermarketCategory,
} from "@/lib/shoppingList";
import { ShoppingListApiError } from "@/lib/shoppingListStorage";
import { createActionNotices, noticeText, type ActionNotice } from "@/lib/actionNotices";
import { withWeekDates } from "@/lib/weekStorage";

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

// What the user hears after an edit of the list, by what the account did with it.
// Step 34: what the account did not accept is a failure, always shown (see actionNotices).
const editFailed = (status: EditResult["status"] | "existing") => !["synced", "local", "pending", "existing"].includes(status);

function editMessage(status: EditResult["status"], done: string) {
  switch (status) {
    case "synced":
      return done;
    case "local":
      return `${done} Solo en este dispositivo.`;
    case "pending":
      return `${done} Se guardará en tu cuenta al recuperar la conexión.`;
    case "stale":
      return "La lista ha cambiado en otro dispositivo; la volvemos a cargar. Inténtalo de nuevo.";
    case "discarded":
      return "Tu cuenta no ha aceptado el cambio. Se muestra la lista guardada.";
    case "no_list":
      return "Primero necesitas una lista para esta semana.";
    default:
      return "No se ha podido hacer el cambio.";
  }
}

type SectionView = { category: SupermarketCategory; rows: ShoppingRowData[]; done: number; total: number };

// D5 (roadmap step 30): the whole list at once. Each section: what is still to buy (to review
// first), then what is bought; items usually at home are kept apart (folded) and not counted.
function buildSections(items: ShoppingViewItem[], checkedItems: string[], pantryItems: string[], dishes: PlannedDish[]) {
  const groups = classifyShoppingView(items, checkedItems, pantryItems);
  const checked = new Set(checkedItems);
  const pantry = pantryNameKeys(pantryItems);
  const row = (item: ShoppingViewItem, status: ShoppingRowData["status"]): ShoppingRowData => ({
    item,
    status,
    checked: checked.has(item.id),
    // A bought item no dish needs any more is not «for» anything now.
    forDishes: item.removed ? [] : describeOrigins(item.origins, dishes),
    canAddToPantry: checked.has(item.id) && !pantry.has(shoppingNameKey(item.name)),
  });
  const ordered = [
    ...groups.review.map((item) => row(item, "review")),
    ...groups.to_buy.map((item) => row(item, "to_buy")),
    ...groups.bought.map((item) => row(item, "bought")),
    ...groups.bought_unneeded.map((item) => row(item, "bought_unneeded")),
  ];
  const sections: SectionView[] = supermarketCategoryLabels
    .map((category) => {
      const rows = ordered.filter((entry) => entry.item.category === category);
      const needed = rows.filter((entry) => entry.status !== "bought_unneeded");
      return { category, rows, done: needed.filter((entry) => entry.status === "bought").length, total: needed.length };
    })
    .filter((section) => section.rows.length > 0);
  return { sections, atHome: groups.pantry };
}

const mealLabel = (dish: PendingDish) => `${["Lunes", "Martes", "Miércoles", "Jueves", "Viernes", "Sábado", "Domingo"][dish.day]}, ${dish.meal === "lunch" ? "comida" : "cena"}`;

type ListNoticesProps = {
  change: ReconcileSummary | null;
  pendingDishes: PendingDish[];
  aiError: string | null;
  fromCards: boolean;
  notUpdated: boolean;
  // D5: items whose adjusted quantity the last update recomputed (their dishes changed).
  discardedAdjustments: string[];
  calculating: boolean;
  onCalculate: () => void;
};

const emptyNotes = { change: null, pendingDishes: [], aiError: null, fromCards: false, notUpdated: false, discardedAdjustments: [] };

const notesOf = (view: ShoppingView, current: Omit<ListNoticesProps, "calculating" | "onCalculate">) => ({
  // A change summary stays visible until another update replaces it.
  change: view.change ?? current.change,
  pendingDishes: view.pendingDishes,
  aiError: view.aiError,
  fromCards: view.fromCards,
  notUpdated: view.notUpdated,
  discardedAdjustments: view.change ? view.discardedAdjustments : current.discardedAdjustments,
});

// C4: what the last update changed, a list that could not be updated, dishes still without
// ingredients and where items come from. Always rendered (empty or not) inside a polite live
// region, so screen readers hear a new summary or a new pending dish.
function ListNotices({ change, pendingDishes, aiError, fromCards, notUpdated, discardedAdjustments, calculating, onCalculate }: ListNoticesProps) {
  const calculateButton = (label: string) => (
    <button
      type="button"
      onClick={onCalculate}
      disabled={calculating}
      className="mt-4 min-h-11 rounded-[var(--radius-control)] bg-[color:var(--color-accent-strong)] bg-[image:var(--accent-gradient)] px-4 text-sm font-semibold text-white hover:bg-[color:var(--color-accent-strong-hover)] hover:bg-[image:var(--accent-gradient-hover)] disabled:opacity-60"
    >
      {calculating ? "Calculando…" : label}
    </button>
  );

  return (
    <div className="space-y-3 empty:hidden" aria-live="polite">
      {change ? (
        <StateMessage title="Lista actualizada con tu menú" variant="success">
          <p className="t-meta max-w-xl text-[color:var(--color-success-hover)]">
            {describeReconcileSummary(change)}. Lo que ya habías comprado sigue marcado.
          </p>
        </StateMessage>
      ) : null}
      {discardedAdjustments.length > 0 ? (
        <StateMessage title="Hemos recalculado cantidades que habías cambiado" variant="loading">
          <p className="t-meta max-w-xl text-[color:var(--color-foreground)]">
            Cambiaron los platos que usan {discardedAdjustments.map((name) => `«${capitalize(name)}»`).join(", ")}: ahora
            se muestra la cantidad que necesitan. Puedes volver a cambiarla.
          </p>
        </StateMessage>
      ) : null}
      {notUpdated ? (
        <Card className="border-[color:var(--color-warning)] p-5">
          <h2 className="t-h3 text-[color:var(--color-foreground)]">Esta lista es de tu menú anterior</h2>
          <p className="mt-2 max-w-xl text-base leading-7 text-[color:var(--color-foreground)]">
            No se ha podido actualizar con los platos de ahora. Lo que ya has comprado sigue marcado.
          </p>
          {aiError ? <p className="t-meta mt-2 max-w-xl">{aiError}</p> : null}
          {calculateButton("Actualizar lista (IA)")}
        </Card>
      ) : pendingDishes.length > 0 ? (
        <Card className="border-[color:var(--color-warning)] p-5">
          <h2 className="t-h3 text-[color:var(--color-foreground)]">Faltan ingredientes de algunos platos</h2>
          <ul className="mt-2 max-w-xl space-y-1 text-base leading-7 text-[color:var(--color-foreground)]">
            {pendingDishes.map((dish) => (
              <li key={`${dish.day}-${dish.meal}`}>
                Faltan ingredientes de «{dish.title}» ({mealLabel(dish)})
              </li>
            ))}
          </ul>
          {aiError ? <p className="t-meta mt-2 max-w-xl">{aiError}</p> : null}
          {calculateButton("Calcular (IA)")}
        </Card>
      ) : null}
      {fromCards ? (
        <p className="t-meta px-1">
          Parte de la lista sale de las fichas de los platos, para las raciones de la semana. Los
          ingredientes opcionales de las fichas no se incluyen.
        </p>
      ) : null}
    </div>
  );
}

export default function ShoppingListPage() {
  const [checkedItems, setCheckedItems] = useState<string[]>([]);
  const [pantryItems, setPantryItems] = useState<string[]>([]);
  const [weekDays, setWeekDays] = useState<WeekDay[] | null>(null);
  const [hasLoadedWeek, setHasLoadedWeek] = useState(false);
  const [generatedItems, setGeneratedItems] = useState<ShoppingViewItem[]>([]);
  const [isLoadingList, setIsLoadingList] = useState(false);
  // C4: updating an existing list in place (not generating a new one).
  const [isUpdatingList, setIsUpdatingList] = useState(false);
  const [listNotes, setListNotes] = useState<Omit<ListNoticesProps, "calculating" | "onCalculate">>(emptyNotes);
  // Which step failed: generating a new list or updating the existing one.
  const [errorTitle, setErrorTitle] = useState("No se pudo generar la lista.");
  const [calculating, setCalculating] = useState(false);
  const [errorMessage, setErrorMessage] = useState("");
  const [needsLogin, setNeedsLogin] = useState(false);
  const [accountUnreachable, setAccountUnreachable] = useState(false);
  // D5: the week's servings (when the account told) and the result of the last action of the user
  // on an item (added by hand, quantity, pantry), announced politely.
  const [servings, setServings] = useState<number | null>(null);
  // Step 34: one notice at a time (a new action clears it; closing the add form clears its own).
  const [notice, setNotice] = useState<ActionNotice>(null);
  const [notices] = useState(() => createActionNotices(setNotice));

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
    const loadTimer = window.setTimeout(() => {
      // Decided when the load really starts: an effect run cancelled before its timer (React's
      // double run in development, after a client-side navigation) never counts as a first load,
      // or the page would wait forever for a week it never asked for.
      const isSameLoad = lastLoadRef.current === loadKey;
      lastLoadRef.current = loadKey;
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
      setListNotes(emptyNotes);
      setCheckedItems([]);
      setErrorMessage("");
      setNeedsLogin(false);
      setAccountUnreachable(false);
      setWeekSyncState({});
      setListSyncState({});
      setHasCheckedList(false);
      setServings(null);
      notices.reset();
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
    // `notices` never changes (created once with the state setter).
  }, [identity.status, identity.scope, identity.userId, identity.epoch, syncReload, notices]);

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
      setListNotes((current) => notesOf(loaded.view, current));
      if (loaded.view.servings !== null) setServings(loaded.view.servings);
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

      // C4: the week has a list for other dishes: it is updated in place (marks are kept).
      if (loaded.status === "outdated") {
        setIsUpdatingList(true);
        setErrorMessage("");
        try {
          const updated = await reconcileShoppingList(dataIdentity, currentIsoWeek, currentWeekDays);
          // Never read again on its own: an update that cannot finish shows the list as it is.
          if (!show(updated) && !isCancelled) {
            if (updated.status === "no_week") setWeekDays(null);
            else if (updated.status === "missing" && updated.offline) setAccountUnreachable(true);
            else {
              setErrorTitle("No se pudo actualizar la lista.");
              setErrorMessage("Ha fallado la actualización de la lista de la compra.");
            }
          }
        } catch (error) {
          if (isCancelled) return;
          if (isAiLoginRequiredError(error)) {
            setNeedsLogin(true);
            return;
          }
          setErrorTitle("No se pudo actualizar la lista.");
          setErrorMessage(
            error instanceof ShoppingListApiError
              ? error.message
              : "Ha fallado la conexión al actualizar la lista de la compra.",
          );
        } finally {
          if (!isCancelled) setIsUpdatingList(false);
        }
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
      setErrorTitle("No se pudo generar la lista.");
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

  const dishes = useMemo(() => plannedDishes(weekDays ?? []), [weekDays]);
  const { sections, atHome } = useMemo(
    () => buildSections(generatedItems, checkedItems, pantryItems, dishes),
    [generatedItems, checkedItems, pantryItems, dishes],
  );

  // C4: «Calcular (IA)» for the dishes still without ingredients (one call, marks kept).
  const calculatePendingDishes = () => {
    if (!isoWeek || !weekDays || calculating) return;
    const dataIdentity = { scope: identity.scope, userId: identity.userId };
    setCalculating(true);
    void reconcileShoppingList(dataIdentity, isoWeek, weekDays, { retryPending: true })
      .then((loaded) => {
        if (loaded.status !== "ready") {
          if (loaded.status === "no_week") setWeekDays(null);
          else setListNotes((current) => ({ ...current, aiError: "No se ha podido comprobar tu lista. Revisa la conexión." }));
          return;
        }
        setGeneratedItems(loaded.view.items);
        setCheckedItems(loaded.view.checkedItemIds);
        setListNotes({
          change: loaded.view.change,
          pendingDishes: loaded.view.pendingDishes,
          aiError: loaded.view.aiError,
          fromCards: loaded.view.fromCards,
          notUpdated: loaded.view.notUpdated,
          discardedAdjustments: loaded.view.discardedAdjustments,
        });
      })
      .catch((error: unknown) => {
        setListNotes((current) => ({
          ...current,
          aiError: isAiLoginRequiredError(error)
            ? "Inicia sesión para calcular los ingredientes con IA."
            : error instanceof ShoppingListApiError
              ? error.message
              : "No se pudieron calcular los ingredientes con IA.",
        }));
      })
      .finally(() => setCalculating(false));
  };

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
        // Still pending only if other marks or edits of this list did not reach the account.
        const cache = readShoppingCache(dataIdentity, isoWeek);
        const pending = Object.keys(cache?.pendingChecks ?? {}).length > 0 || (cache?.pendingEdits?.length ?? 0) > 0;
        setListSyncState((current) => ({ ...current, pending }));
      }
    });
  };

  const syncState: SyncState = {
    offline: weekSyncState.offline || listSyncState.offline,
    pending: weekSyncState.pending || listSyncState.pending,
    conflict: listSyncState.conflict,
    discardedLocalChanges: listSyncState.discardedLocalChanges,
  };

  // D5: an edit of the user (item added by hand, quantity, removal) shows the device copy at once;
  // the account answers later (pending without connection, stale if the list was replaced).
  const showEdit = (result: EditResult) => {
    if (result.view) {
      setGeneratedItems(result.view.items);
      setCheckedItems(result.view.checkedItemIds);
    }
    if (result.status === "stale") {
      setListSyncState({ conflict: true });
      setListReload((value) => value + 1);
    } else if (result.status === "discarded") {
      setListSyncState((current) => ({ ...current, discardedLocalChanges: true }));
    } else if (result.status === "pending") {
      setListSyncState((current) => ({ ...current, pending: true }));
    } else if (result.status === "synced" && result.view) {
      setListSyncState((current) => ({ ...current, pending: result.view!.pending }));
    }
  };

  const runEdit = async (edit: () => Promise<EditResult>) => {
    setSavingChecks((count) => count + 1);
    try {
      const sent = edit();
      // The device copy already has the edit: shown at once, before the account answers.
      const now = isoWeek && weekDays ? readShoppingView(dataIdentityOf(), isoWeek, weekDays) : null;
      if (now) {
        setGeneratedItems(now.items);
        setCheckedItems(now.checkedItemIds);
      }
      const result = await sent;
      showEdit(result);
      return result;
    } finally {
      setSavingChecks((count) => count - 1);
    }
  };

  const addManualItem = async (draft: ManualItemDraft): Promise<{ text: string; failed: boolean }> => {
    if (!isoWeek || !weekDays) return { text: "Primero necesitas una lista para esta semana.", failed: true };
    const result = await runEdit(() => addManualShoppingItem(dataIdentityOf(), isoWeek, draft, weekDays));
    const name = `«${capitalize(draft.name)}»`;
    // Frozen food is shown under «Otros».
    const section = capitalize(draft.category === "congelados" ? "otros" : draft.category);
    const failed = editFailed(result.status);
    if (result.status === "existing") return { text: `${name} ya está en la lista.`, failed };
    if (result.status === "refused") return { text: "Revisa el nombre y la cantidad.", failed };
    return { text: editMessage(result.status, `${name} añadido a ${section}.`), failed };
  };

  const dataIdentityOf = () => ({ scope: identity.scope, userId: identity.userId });

  const refreshPantry = () => setPantryItems(activePantryNames(readPantryView(dataIdentityOf())));

  const rowActions: ShoppingRowActions = {
    onToggle: (item) => {
      notices.clear();
      toggleCheckedItem(item.id);
    },
    onSaveQuantity: (item, quantity, unit) => {
      if (!isoWeek || !weekDays) return;
      const show = notices.begin();
      void runEdit(() => setShoppingItemQuantity(dataIdentityOf(), isoWeek, item.id, quantity, weekDays, unit)).then((result) =>
        show(
          result.status === "refused"
            ? `No se puede cambiar la cantidad de «${capitalize(item.name)}».`
            : editMessage(result.status, `Cantidad de «${capitalize(item.name)}»: ${formatShoppingAmount(quantity, unit ?? item.unit)}.`),
          { failed: editFailed(result.status) },
        ),
      );
    },
    onRemove: (item) => {
      if (!isoWeek || !weekDays) return;
      const show = notices.begin();
      void runEdit(() => removeManualShoppingItem(dataIdentityOf(), isoWeek, item.id, weekDays)).then((result) =>
        show(
          result.status === "refused"
            ? `No se puede quitar «${capitalize(item.name)}».`
            : editMessage(result.status, `«${capitalize(item.name)}» quitado de la lista.`),
          { failed: editFailed(result.status) },
        ),
      );
    },
    onAddToPantry: (item) => {
      const show = notices.begin();
      void ensurePantryItemInStock(dataIdentityOf(), item.name, item.category).then((result) => {
        refreshPantry();
        show(
          result.status === "conflict"
            ? "Tu despensa ha cambiado en otro dispositivo. Revisa la despensa."
            : `«${capitalize(item.name)}» está ahora en tu despensa${result.status === "pending" ? " (se guardará al recuperar la conexión)" : ""}.`,
          { failed: result.status === "conflict" },
        );
      });
    },
  };

  // «Se me acabó» on an item left out because it is usually at home: the pantry marks it as used
  // up, so it goes back to what is still to buy.
  const markUsedUp = (item: ShoppingViewItem) => {
    const show = notices.begin();
    void markPantryItemUsedUp(dataIdentityOf(), item.name).then((result) => {
      refreshPantry();
      show(
        result.status === "missing"
          ? `«${capitalize(item.name)}» no está en tu despensa.`
          : result.status === "conflict"
            ? "Tu despensa ha cambiado en otro dispositivo. Revisa la despensa."
            : `«${capitalize(item.name)}» pasa a la lista: lo hemos marcado como agotado en tu despensa${result.status === "pending" ? " (se guardará al recuperar la conexión)" : ""}.`,
        { failed: result.status === "missing" || result.status === "conflict" },
      );
    });
  };

  // Lines to buy and bought (items usually at home and those no longer needed are not counted).
  const totalVisibleItems = sections.reduce((total, section) => total + section.total, 0);
  const checkedVisibleItems = sections.reduce((total, section) => total + section.done, 0);
  const hasList = generatedItems.length > 0 && !isUpdatingList && !isLoadingList && !errorMessage && !needsLogin && !accountUnreachable;
  const weekLine = isoWeek
    ? `Semana ${isoWeek.isoWeek} · ${formatIsoWeekTitle(isoWeek, { compact: true })}${servings ? ` · ${servings} ${servings === 1 ? "ración" : "raciones"} por comida` : ""}`
    : "";

  return (
    <main className={`${pageShellStickyClass} min-h-dvh`}>
      <div className={pageStickyColumnClass}>
        {/* Step 34: the bar (progress) and the section links stay; title, tabs and week line scroll. */}
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
          pinned={
            hasList && (sections.length > 0 || atHome.length > 0) ? (
              <nav aria-label="Secciones de la lista" className="-mx-1.5 -my-1.5 flex gap-2 overflow-x-auto px-1.5 py-1.5">
                {sections.map((section) => (
                  <a
                    key={section.category}
                    href={`#${shoppingSectionId(section.category)}`}
                    aria-label={`${capitalize(section.category)}: ${section.done} de ${section.total} comprados`}
                    className={`inline-flex min-h-11 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-[var(--radius-control)] border px-3 text-sm font-semibold ${
                      section.total > 0 && section.done === section.total
                        ? "border-[color:var(--color-success)] bg-[color:var(--color-success-soft)] text-[color:var(--color-success-hover)]"
                        : "border-[color:var(--color-border)] bg-[color:var(--color-surface)] text-[color:var(--color-foreground)]"
                    }`}
                  >
                    {capitalize(section.category)}
                    <span aria-hidden="true" className="text-[color:var(--color-muted-foreground)]">{section.done}/{section.total}</span>
                  </a>
                ))}
                {atHome.length > 0 ? (
                  <a
                    href={`#${shoppingSectionId("en-casa")}`}
                    className="inline-flex min-h-11 shrink-0 items-center whitespace-nowrap rounded-[var(--radius-control)] border border-[color:var(--color-border)] bg-[color:var(--color-surface)] px-3 text-sm font-semibold text-[color:var(--color-foreground)]"
                  >
                    En casa ({atHome.length})
                  </a>
                ) : null}
              </nav>
            ) : null
          }
        >
          <div className="space-y-2.5">
            <ShoppingTabs />
            {weekLine && hasLoadedWeek && weekDays && weekDays.length > 0 ? <p className="t-meta px-1">{weekLine}</p> : null}
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

        {/* Persistent live region: the list's notices appear and change inside it. */}
        <ListNotices
          {...(generatedItems.length > 0 && !isUpdatingList && !errorMessage ? listNotes : emptyNotes)}
          calculating={calculating}
          onCalculate={calculatePendingDishes}
        />
        {/* Persistent live region for the result of the user's last action on an item. */}
        <p role="status" className="t-meta px-1 empty:hidden">
          {hasList ? noticeText(notice, "list") : ""}
        </p>

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
          ) : isUpdatingList ? (
            <Card className="p-6 sm:p-7" aria-live="polite">
              <p className="t-eyebrow">Actualizando</p>
              <h2 className="t-h2 mt-3 text-[color:var(--color-foreground)]">
                Actualizando tu lista con el menú
              </h2>
              <p className="t-meta mt-3 max-w-xl">
                Recalculamos los ingredientes de tu menú. Lo que ya has comprado sigue marcado.
              </p>
            </Card>
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
              title={errorTitle}
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
          ) : hasList ? (
            <div className="space-y-5">
              {checkedVisibleItems > 0 && checkedVisibleItems === totalVisibleItems ? (
                <StateMessage title="Ya lo tienes todo" variant="success">
                  <p className="t-meta text-[color:var(--color-success-hover)]">Has comprado todo lo que falta de esta semana.</p>
                </StateMessage>
              ) : null}
              {sections.map((section) => (
                <ShoppingSection
                  key={section.category}
                  category={section.category}
                  rows={section.rows}
                  done={section.done}
                  total={section.total}
                  actions={rowActions}
                />
              ))}
              {atHome.length > 0 ? (
                <details id={shoppingSectionId("en-casa")} className="rounded-[var(--radius-card)] border border-[color:var(--color-border)] bg-[color:var(--color-surface)]">
                  <summary className="flex min-h-11 cursor-pointer items-center justify-between gap-3 px-4 py-3">
                    <span className="t-body-strong text-[color:var(--color-foreground)]">
                      Ya lo tienes habitualmente ({atHome.length})
                    </span>
                    <span className="t-meta">No se cuenta para comprar</span>
                  </summary>
                  <p className="t-meta px-4">
                    Lo dejamos fuera porque está en tu despensa. Si se te ha acabado, pásalo a la lista.
                  </p>
                  <ul className="mt-2 divide-y divide-[color:var(--color-border)] border-t border-[color:var(--color-border)]">
                    {atHome.map((item) => (
                      <li key={item.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-2">
                        <span className="t-body-strong min-w-0 flex-1 text-[color:var(--color-foreground)]">{capitalize(item.name)}</span>
                        <span className="text-sm font-semibold text-[color:var(--color-muted-foreground)]">{formatShoppingAmount(item.quantity, item.unit)}</span>
                        <button
                          type="button"
                          onClick={(event) => {
                            // The line leaves this group: the focus goes to the next one. When it was
                            // the last one the whole group goes away, so the focus follows the item to
                            // its line in the list (its checkbox), once the pantry has been updated.
                            const line = event.currentTarget.closest("li");
                            const sibling = (line?.nextElementSibling ?? line?.previousElementSibling)?.querySelector<HTMLElement>("button");
                            const summary = line?.closest("details")?.querySelector<HTMLElement>("summary") ?? null;
                            const label = `${capitalize(item.name)},`;
                            markUsedUp(item);
                            if (sibling) {
                              requestAnimationFrame(() => sibling.focus());
                              return;
                            }
                            const followItem = (attempt: number) => {
                              const moved = Array.from(document.querySelectorAll<HTMLElement>('input[type="checkbox"][aria-label]'))
                                .find((box) => box.getAttribute("aria-label")?.startsWith(label));
                              if (moved) moved.focus();
                              else if (attempt < 40) window.setTimeout(() => followItem(attempt + 1), 50);
                              else if (summary?.isConnected) summary.focus();
                            };
                            window.setTimeout(() => followItem(0), 50);
                          }}
                          aria-label={`Se me acabó: ${capitalize(item.name)}. Pasarlo a la lista`}
                          className="min-h-11 rounded-[var(--radius-control)] border border-[color:var(--color-border-strong)] bg-[color:var(--color-surface)] px-3 text-sm font-semibold text-[color:var(--color-foreground)]"
                        >
                          Se me acabó
                        </button>
                      </li>
                    ))}
                  </ul>
                </details>
              ) : null}
              <ManualItemForm
                onAdd={async (draft) => {
                  const show = notices.begin("form");
                  const added = await addManualItem(draft);
                  show(added.text, { failed: added.failed });
                }}
                message={noticeText(notice, "form")}
                onClose={() => notices.close("form")}
              />
            </div>
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
