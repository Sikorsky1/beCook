// A nutritionist's plan applied to a week (see @/lib/nutritionPlan): its breakfasts, mid-mornings,
// snacks and bedtime are not dishes of the week, so what they need goes into the week's shopping
// list as items added by hand (D5): they stay when the dishes change and can be edited or removed.
// They wait on this device until the week has a list (it is prepared after «Usar este menú», or
// when Compra opens).
import type { WeekDay } from "@/data/mockWeek";
import { addManualShoppingItem, readShoppingView, type ShoppingView } from "@/lib/data/shopping";
import { getIsoWeekStorageId, type IsoWeek } from "@/lib/isoWeek";
import type { PlanShoppingItem } from "@/lib/nutritionPlan";
import type { DataIdentity } from "@/lib/data/repositories";
import { readScoped, removeScoped, writeScoped } from "@/lib/storage/scoped-storage";

const validItem = (value: unknown): value is PlanShoppingItem => {
  const entry = value as Partial<PlanShoppingItem> | null;
  return (
    !!entry &&
    typeof entry.name === "string" &&
    typeof entry.quantity === "number" &&
    entry.quantity > 0 &&
    (entry.unit === "g" || entry.unit === "ml" || entry.unit === "ud") &&
    typeof entry.category === "string"
  );
};

export function readPendingPlanExtras(identity: DataIdentity, isoWeek: IsoWeek): PlanShoppingItem[] {
  const stored = readScoped<unknown>(identity.scope, "plan-extras", getIsoWeekStorageId(isoWeek));
  return Array.isArray(stored) ? stored.filter(validItem) : [];
}

// The week's menu was saved: its plan's items wait for the list (none: a menu that is not a plan).
export function writePendingPlanExtras(identity: DataIdentity, isoWeek: IsoWeek, items: PlanShoppingItem[] | null | undefined) {
  if (items?.length) writeScoped(identity.scope, "plan-extras", items, { week: getIsoWeekStorageId(isoWeek) });
  else removeScoped(identity.scope, "plan-extras", getIsoWeekStorageId(isoWeek));
}

const running = new Map<string, Promise<ShoppingView | null>>();

// Adds the waiting items to the week's list. An item already there by that name is left as it is.
// Without a list (or when the account replaced it meanwhile) they keep waiting. Answers the list as
// it is now, or null when nothing was waiting.
export function applyPendingPlanExtras(identity: DataIdentity, isoWeek: IsoWeek, days: WeekDay[]) {
  const key = `${identity.scope}|${getIsoWeekStorageId(isoWeek)}`;
  const current = running.get(key);
  if (current) return current;

  const task = (async () => {
    const items = readPendingPlanExtras(identity, isoWeek);
    if (!items.length) return null;
    const waiting: PlanShoppingItem[] = [];
    for (const [index, item] of items.entries()) {
      const result = await addManualShoppingItem(identity, isoWeek, item, days);
      if (result.status === "no_list" || result.status === "stale") {
        waiting.push(...items.slice(index));
        break;
      }
    }
    writePendingPlanExtras(identity, isoWeek, waiting);
    return readShoppingView(identity, isoWeek, days);
  })().finally(() => running.delete(key));

  running.set(key, task);
  return task;
}
