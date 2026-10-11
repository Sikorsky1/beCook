// Identity-aware data access for profile, week, pantry, selected week and shopping cache.
// Pages call these instead of touching localStorage or Supabase directly.
import type { WeekDay } from "@/data/mockWeek";
import { getIsoWeekStorageId, parseIsoWeek, type IsoWeek } from "@/lib/isoWeek";
import type { WeekFoodContextStatus } from "@/lib/menu-generation/food-context";
import type { ShoppingFoodContext } from "@/lib/shoppingListStorage";
import type { GeneratedShoppingListItem } from "@/lib/shoppingList";
import {
  loadEntity,
  readCached,
  RemoteConflictError,
  saveEntity,
  type EntityRemote,
  type LoadResult,
  type PushResult,
  type SaveResult,
} from "@/lib/data/sync";
import {
  readScoped,
  removeScoped,
  writeScoped,
  type StorageScope,
} from "@/lib/storage/scoped-storage";
import type {
  AddPantryItemResult,
  PantryCategory,
  PantryRowRef,
  PantryRowState,
  PantryRowsWriteResult,
} from "@/lib/supabase/pantry";
import type { UserProfile } from "@/lib/supabase/profiles";
import type { SaveShoppingListResult, SetShoppingItemsCheckedResult, ShoppingList } from "@/lib/supabase/shopping-lists";
import type { MealKind, WeekWriteResult } from "@/lib/supabase/weeks";
import { mealSlotToSupabase, supabaseWeekToWeekDays, weekDaysToSupabaseWeek } from "@/lib/weekStorage";

export type DataIdentity = { scope: StorageScope; userId: string | null };

export type WeekSlot = { day: string; meal: MealKind };

// requestKey: one per user attempt (e.g. one click on «Usar este menú»), reused if that attempt is
// sent again, so the database applies it once. slot: only that meal changed (dish edit).
export type WeekPushOptions = { generationRequestId?: string | null; requestKey?: string; slot?: WeekSlot };

export function newRequestKey() {
  return crypto.randomUUID();
}

// Week versions are weeks.version as a string. A cache written before B4 holds an updated_at
// timestamp instead: it can never match, so the database answers with a conflict (remote wins).
export function toWeekVersion(version: string | null): number | null {
  if (version === null) return null;
  return /^\d+$/.test(version) ? Number(version) : -1;
}

// Same dishes on the same days (dates are presentation, never stored). Used to recognise a week
// write that reached the account although its answer was lost.
export function sameWeekDays(local: WeekDay[], remote: WeekDay[]) {
  const canonical = (days: WeekDay[]) =>
    JSON.stringify(
      days
        .map((day) => [day.day, day.lunch.trim(), day.dinner.trim()])
        .sort((first, second) => first[0].localeCompare(second[0])),
    );
  return canonical(local) === canonical(remote);
}

export function weekWriteToPush(result: WeekWriteResult): PushResult {
  if (result.status === "conflict") throw new RemoteConflictError();
  return { version: String(result.version), duplicate: result.status === "duplicate" };
}

// The account side of one calendar week's shopping (B6): the week as it is now and its current list.
export type RemoteShoppingState = {
  // null: the account has no such week. foodContext (C1): its frozen servings and restrictions
  // version; null (or absent) for weeks applied before C1.
  week: { days: WeekDay[]; version: number | null; updatedAt: string | null; foodContext?: ShoppingFoodContext | null } | null;
  list: ShoppingList | null;
};

export type ShoppingRemote = {
  fetch: () => Promise<RemoteShoppingState>;
  save: (input: {
    signature: string;
    items: GeneratedShoppingListItem[];
    expectedWeekVersion: number | null;
  }) => Promise<SaveShoppingListResult>;
  setChecked: (itemIds: string[], checked: boolean) => Promise<SetShoppingItemsCheckedResult>;
};

// The account side of the pantry (B7): its rows, and writes of one item at a time.
export type PantryRemote = {
  // version: latest updated_at (only to recognise device copies saved before B7).
  fetch: () => Promise<{ rows: PantryRowState[]; version: string | null }>;
  add: (items: { id: string; name: string; category: PantryCategory; active: boolean }[]) => Promise<AddPantryItemResult[]>;
  setActive: (rows: PantryRowRef[], active: boolean) => Promise<PantryRowsWriteResult>;
  remove: (rows: PantryRowRef[]) => Promise<PantryRowsWriteResult>;
};

export type Remotes = {
  profile: (userId: string) => EntityRemote<UserProfile>;
  week: (userId: string, isoWeek: IsoWeek, options?: WeekPushOptions) => EntityRemote<WeekDay[]>;
  pantry: (userId: string) => PantryRemote;
  shopping: (userId: string, isoWeek: IsoWeek) => ShoppingRemote;
  // C1: the week's frozen food context next to the current profile.
  foodContext?: (userId: string, isoWeek: IsoWeek) => Promise<WeekFoodContextStatus>;
};

// C1: right after a whole-week write, the week keeps the food context it was planned with (saved
// profile and the generation's servings), read by the database, never sent from here. Best effort:
// the menu is already saved; without a context the week behaves as one applied before C1.
async function freezeFoodContext(isoWeek: IsoWeek, requestKey: string, generationRequestId: string | null | undefined) {
  try {
    const { freezeWeekFoodContextInSupabase } = await import("@/lib/supabase/weeks");
    await freezeWeekFoodContextInSupabase({ isoYear: isoWeek.isoYear, isoWeek: isoWeek.isoWeek, requestKey, generationRequestId });
  } catch (error: unknown) {
    console.warn("No se pudo registrar el contexto alimentario de la semana:", error instanceof Error ? error.message : error);
  }
}

const supabaseRemotes: Remotes = {
  profile(userId) {
    const fetch = async () => {
      const { getProfileForUserFromSupabase } = await import("@/lib/supabase/profiles");
      const remote = await getProfileForUserFromSupabase(userId);
      return { data: remote?.profile ?? null, version: remote?.updatedAt ?? null };
    };
    return {
      fetch,
      async push(profile) {
        const { saveProfileToSupabase } = await import("@/lib/supabase/profiles");
        await saveProfileToSupabase(profile, { userId });
        return { version: (await fetch()).version };
      },
    };
  },
  week(userId, isoWeek, options = {}) {
    const read = async () => {
      const { getWeekFromSupabaseByIsoWeek } = await import("@/lib/supabase/weeks");
      return getWeekFromSupabaseByIsoWeek({ isoYear: isoWeek.isoYear, isoWeek: isoWeek.isoWeek, userId });
    };
    const fetch = async () => {
      const remote = await read();
      const days = remote ? supabaseWeekToWeekDays(remote, isoWeek) : [];
      const version = remote?.version ?? null;
      return { data: days.length ? days : null, version: version === null ? null : String(version) };
    };
    return {
      fetch,
      // apply_week / update_week_slot compare the version in the same transaction as the write.
      checksVersion: true,
      sameData: sameWeekDays,
      async push(weekDays, { baseVersion, overwrite }) {
        const { applyWeekInSupabase, updateWeekSlotInSupabase } = await import("@/lib/supabase/weeks");
        const expectedVersion = toWeekVersion(baseVersion);
        const requestKey = options.requestKey ?? newRequestKey();
        const slotDay = options.slot ? weekDays.find((day) => day.day === options.slot?.day) : undefined;
        // A dish edit touches only its slot; without a known remote week it is a whole-week write.
        if (options.slot && slotDay && expectedVersion !== null && !overwrite) {
          return weekWriteToPush(await updateWeekSlotInSupabase({
            isoYear: isoWeek.isoYear,
            isoWeek: isoWeek.isoWeek,
            dayName: slotDay.day,
            meal: options.slot.meal,
            slot: mealSlotToSupabase(slotDay[options.slot.meal]),
            expectedVersion,
            requestKey,
          }));
        }
        const result = await applyWeekInSupabase({
          isoYear: isoWeek.isoYear,
          isoWeek: isoWeek.isoWeek,
          week: weekDaysToSupabaseWeek(weekDays),
          requestKey,
          expectedVersion,
          overwrite,
          generationRequestId: options.generationRequestId,
        });
        // duplicate too: the first answer (and its freeze) may have been lost; freezing is idempotent.
        if (result.status !== "conflict") await freezeFoodContext(isoWeek, requestKey, options.generationRequestId);
        return weekWriteToPush(result);
      },
    };
  },
  pantry(userId) {
    return {
      async fetch() {
        const { getPantryRowsForUserFromSupabase } = await import("@/lib/supabase/pantry");
        return getPantryRowsForUserFromSupabase(userId);
      },
      async add(items) {
        const { addPantryItemsInSupabase } = await import("@/lib/supabase/pantry");
        return addPantryItemsInSupabase(items);
      },
      async setActive(rows, active) {
        const { setPantryItemsActiveInSupabase } = await import("@/lib/supabase/pantry");
        return setPantryItemsActiveInSupabase(rows, active);
      },
      async remove(rows) {
        const { deletePantryItemsInSupabase } = await import("@/lib/supabase/pantry");
        return deletePantryItemsInSupabase(rows);
      },
    };
  },
  shopping(userId, isoWeek) {
    return {
      async fetch() {
        const { getWeekFromSupabaseByIsoWeek } = await import("@/lib/supabase/weeks");
        const week = await getWeekFromSupabaseByIsoWeek({ isoYear: isoWeek.isoYear, isoWeek: isoWeek.isoWeek, userId });
        if (!week?.id) return { week: null, list: null };
        const { getLatestShoppingListForWeekFromSupabase } = await import("@/lib/supabase/shopping-lists");
        const { getWeekFoodContextFromSupabase } = await import("@/lib/supabase/weeks");
        const [list, foodContext] = await Promise.all([
          getLatestShoppingListForWeekFromSupabase(week.id),
          getWeekFoodContextFromSupabase(week.id),
        ]);
        return {
          week: { days: supabaseWeekToWeekDays(week, isoWeek), version: week.version ?? null, updatedAt: week.updatedAt ?? null, foodContext },
          list,
        };
      },
      async save({ signature, items, expectedWeekVersion }) {
        const { saveShoppingListInSupabase } = await import("@/lib/supabase/shopping-lists");
        return saveShoppingListInSupabase({
          isoYear: isoWeek.isoYear,
          isoWeek: isoWeek.isoWeek,
          weekSignature: signature,
          items,
          expectedWeekVersion,
        });
      },
      async setChecked(itemIds, checked) {
        const { setShoppingItemsCheckedInSupabase } = await import("@/lib/supabase/shopping-lists");
        return setShoppingItemsCheckedInSupabase(itemIds, checked);
      },
    };
  },
};

supabaseRemotes.foodContext = async (_userId, isoWeek) => {
  const { getWeekFoodContextStatusFromSupabase } = await import("@/lib/supabase/weeks");
  return getWeekFoodContextStatusFromSupabase({ isoYear: isoWeek.isoYear, isoWeek: isoWeek.isoWeek });
};

let remotes: Remotes = supabaseRemotes;

// Tests replace the Supabase adapters with in-memory ones.
export function configureRemotes(next: Remotes | null) {
  remotes = next ?? supabaseRemotes;
}

const weekKey = (isoWeek: IsoWeek) => getIsoWeekStorageId(isoWeek);

// --- Profile -------------------------------------------------------------
export function readCachedProfile(identity: DataIdentity) {
  return readCached<UserProfile>({ scope: identity.scope, entity: "profile" })?.data ?? null;
}

export function loadProfile(identity: DataIdentity): Promise<LoadResult<UserProfile>> {
  return loadEntity({ scope: identity.scope, entity: "profile" }, identity.userId ? remotes.profile(identity.userId) : null);
}

export function saveProfile(identity: DataIdentity, profile: UserProfile): Promise<SaveResult<UserProfile>> {
  return saveEntity({ scope: identity.scope, entity: "profile" }, profile, identity.userId ? remotes.profile(identity.userId) : null);
}

// --- Week ----------------------------------------------------------------
export function readCachedWeek(identity: DataIdentity, isoWeek: IsoWeek) {
  return readCached<WeekDay[]>({ scope: identity.scope, entity: "week", week: weekKey(isoWeek) })?.data ?? null;
}

export function loadWeek(identity: DataIdentity, isoWeek: IsoWeek): Promise<LoadResult<WeekDay[]>> {
  return loadEntity(
    { scope: identity.scope, entity: "week", week: weekKey(isoWeek) },
    identity.userId ? remotes.week(identity.userId, isoWeek) : null,
  );
}

export function saveWeek(
  identity: DataIdentity,
  isoWeek: IsoWeek,
  weekDays: WeekDay[],
  { overwrite = false, baseVersion, ...options }: WeekPushOptions & { overwrite?: boolean; baseVersion?: string | null } = {},
): Promise<SaveResult<WeekDay[]>> {
  return saveEntity(
    { scope: identity.scope, entity: "week", week: weekKey(isoWeek) },
    weekDays,
    identity.userId ? remotes.week(identity.userId, isoWeek, options) : null,
    { overwrite, baseVersion },
  );
}

// The account week as it is now, without resending pending changes (they are about to be replaced).
// Throws when the account cannot be reached.
export async function readRemoteWeek(identity: DataIdentity, isoWeek: IsoWeek) {
  return identity.userId ? remotes.week(identity.userId, isoWeek).fetch() : { data: null, version: null };
}

// Dish edit: only that meal is written, if the account week is still the one this copy is based on.
export function saveWeekSlot(
  identity: DataIdentity,
  isoWeek: IsoWeek,
  weekDays: WeekDay[],
  slot: WeekSlot,
): Promise<SaveResult<WeekDay[]>> {
  return saveEntity(
    { scope: identity.scope, entity: "week", week: weekKey(isoWeek) },
    weekDays,
    identity.userId ? remotes.week(identity.userId, isoWeek, { slot }) : null,
  );
}

// Food context the week was planned with, compared with the profile now (C1). null: guest, or the
// account could not be read (nothing is claimed then).
export async function loadWeekFoodContext(identity: DataIdentity, isoWeek: IsoWeek): Promise<WeekFoodContextStatus | null> {
  if (!identity.userId || !remotes.foodContext) return null;
  try {
    return await remotes.foodContext(identity.userId, isoWeek);
  } catch {
    return null;
  }
}

// --- Pantry (item by item, see @/lib/data/pantry) ------------------------
export function pantryRemote(identity: DataIdentity) {
  return identity.userId ? remotes.pantry(identity.userId) : null;
}

// --- Selected week (device preference, per scope) ------------------------
export function readSelectedWeek(identity: DataIdentity): IsoWeek | null {
  return parseIsoWeek(readScoped<IsoWeek>(identity.scope, "selected-week") ?? {});
}

export function writeSelectedWeek(identity: DataIdentity, isoWeek: IsoWeek) {
  writeScoped(identity.scope, "selected-week", isoWeek);
}

// --- Shopping (per week; the account list is read first, see @/lib/data/shopping) ---
export type ShoppingCache = {
  weekSignature: string;
  items: GeneratedShoppingListItem[];
  checkedItemIds: string[];
  // B6. listId: the account list these items are (null: only on this device so far).
  // itemIds: account rows of each visible item. pendingChecks: marks the account has not accepted yet.
  listId?: string | null;
  itemIds?: Record<string, string[]>;
  pendingChecks?: Record<string, boolean>;
};

export function readShoppingCache(identity: DataIdentity, isoWeek: IsoWeek) {
  return readScoped<ShoppingCache>(identity.scope, "shopping", weekKey(isoWeek));
}

// Pending (B5): a list not saved in the account yet, or marks it has not accepted. Counted by the
// sign-out warning like any other change not saved.
export function writeShoppingCache(identity: DataIdentity, isoWeek: IsoWeek, cache: ShoppingCache) {
  const pending = cache.listId === null || Object.keys(cache.pendingChecks ?? {}).length > 0;
  writeScoped(identity.scope, "shopping", cache, { week: weekKey(isoWeek), pending });
}

export function clearShoppingCache(identity: DataIdentity, isoWeek: IsoWeek) {
  removeScoped(identity.scope, "shopping", weekKey(isoWeek));
}

export function shoppingRemote(identity: DataIdentity, isoWeek: IsoWeek) {
  return identity.userId ? remotes.shopping(identity.userId, isoWeek) : null;
}

// Account version of the week as last seen on this device (null: unknown).
export function readCachedWeekVersion(identity: DataIdentity, isoWeek: IsoWeek) {
  const version = readCached<WeekDay[]>({ scope: identity.scope, entity: "week", week: weekKey(isoWeek) })?.remoteVersion ?? null;
  const parsed = toWeekVersion(version);
  return parsed === null || parsed < 0 ? null : parsed;
}
