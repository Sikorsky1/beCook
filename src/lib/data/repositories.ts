// Identity-aware data access for profile, week, pantry, selected week and shopping cache.
// Pages call these instead of touching localStorage or Supabase directly.
import type { WeekDay } from "@/data/mockWeek";
import { getIsoWeekStorageId, parseIsoWeek, type IsoWeek } from "@/lib/isoWeek";
import type { PantryStorageItem } from "@/lib/pantryStorage";
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

export function weekWriteToPush(result: WeekWriteResult): PushResult {
  if (result.status === "conflict") throw new RemoteConflictError();
  return { version: String(result.version), duplicate: result.status === "duplicate" };
}

// The account side of one calendar week's shopping (B6): the week as it is now and its current list.
export type RemoteShoppingState = {
  // null: the account has no such week.
  week: { days: WeekDay[]; version: number | null; updatedAt: string | null } | null;
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

export type Remotes = {
  profile: (userId: string) => EntityRemote<UserProfile>;
  week: (userId: string, isoWeek: IsoWeek, options?: WeekPushOptions) => EntityRemote<WeekDay[]>;
  pantry: (userId: string) => EntityRemote<PantryStorageItem[]>;
  shopping: (userId: string, isoWeek: IsoWeek) => ShoppingRemote;
};

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
        return weekWriteToPush(await applyWeekInSupabase({
          isoYear: isoWeek.isoYear,
          isoWeek: isoWeek.isoWeek,
          week: weekDaysToSupabaseWeek(weekDays),
          requestKey,
          expectedVersion,
          overwrite,
          generationRequestId: options.generationRequestId,
        }));
      },
    };
  },
  pantry(userId) {
    const fetch = async () => {
      const { getPantryForUserFromSupabase } = await import("@/lib/supabase/pantry");
      const remote = await getPantryForUserFromSupabase(userId);
      const items = remote.items.map(({ name, category, active }) => ({ name, category, active }));
      return { data: items.length ? items : null, version: remote.version };
    };
    return {
      fetch,
      async push(items) {
        // The pantry links to the user's OWN profile, read from the server, never from a cache.
        const { getProfileForUserFromSupabase } = await import("@/lib/supabase/profiles");
        const { replacePantryItemsInSupabase } = await import("@/lib/supabase/pantry");
        const ownProfile = await getProfileForUserFromSupabase(userId);
        await replacePantryItemsInSupabase(items, ownProfile?.profile.id, userId);
        return { version: (await fetch()).version };
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
        return {
          week: { days: supabaseWeekToWeekDays(week, isoWeek), version: week.version ?? null, updatedAt: week.updatedAt ?? null },
          list: await getLatestShoppingListForWeekFromSupabase(week.id),
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

// --- Pantry --------------------------------------------------------------
export function readCachedPantry(identity: DataIdentity) {
  return readCached<PantryStorageItem[]>({ scope: identity.scope, entity: "pantry" })?.data ?? null;
}

export function loadPantry(identity: DataIdentity): Promise<LoadResult<PantryStorageItem[]>> {
  return loadEntity({ scope: identity.scope, entity: "pantry" }, identity.userId ? remotes.pantry(identity.userId) : null);
}

export function savePantry(identity: DataIdentity, items: PantryStorageItem[]): Promise<SaveResult<PantryStorageItem[]>> {
  return saveEntity({ scope: identity.scope, entity: "pantry" }, items, identity.userId ? remotes.pantry(identity.userId) : null);
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

export function writeShoppingCache(identity: DataIdentity, isoWeek: IsoWeek, cache: ShoppingCache) {
  writeScoped(identity.scope, "shopping", cache, { week: weekKey(isoWeek) });
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
