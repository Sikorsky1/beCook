// Identity-aware data access for profile, week, pantry, selected week and shopping cache.
// Pages call these instead of touching localStorage or Supabase directly.
import type { WeekDay } from "@/data/mockWeek";
import { getIsoWeekStorageId, parseIsoWeek, type IsoWeek } from "@/lib/isoWeek";
import type { PantryStorageItem } from "@/lib/pantryStorage";
import type { GeneratedShoppingListResponse } from "@/lib/shoppingList";
import {
  loadEntity,
  readCached,
  saveEntity,
  type EntityRemote,
  type LoadResult,
  type SaveResult,
} from "@/lib/data/sync";
import {
  readScoped,
  removeScoped,
  writeScoped,
  type StorageScope,
} from "@/lib/storage/scoped-storage";
import type { UserProfile } from "@/lib/supabase/profiles";
import { supabaseWeekToWeekDays, weekDaysToSupabaseWeek } from "@/lib/weekStorage";

export type DataIdentity = { scope: StorageScope; userId: string | null };

export type WeekPushOptions = { generationRequestId?: string | null };

export type RemoteShoppingList = {
  items: GeneratedShoppingListResponse["items"];
  checkedItemIds: string[];
  weekId: string;
};

export type Remotes = {
  profile: (userId: string) => EntityRemote<UserProfile>;
  week: (userId: string, isoWeek: IsoWeek, options?: WeekPushOptions) => EntityRemote<WeekDay[]> & {
    weekId: () => Promise<string | null>;
  };
  pantry: (userId: string) => EntityRemote<PantryStorageItem[]>;
  shoppingForWeek: (userId: string, isoWeek: IsoWeek) => Promise<RemoteShoppingList | null>;
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
        return (await fetch()).version;
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
      return { data: days.length ? days : null, version: remote?.updatedAt ?? null };
    };
    return {
      fetch,
      weekId: async () => (await read())?.id ?? null,
      async push(weekDays) {
        const { saveWeekToSupabase } = await import("@/lib/supabase/weeks");
        const weekId = await saveWeekToSupabase(
          { ...weekDaysToSupabaseWeek(weekDays), isoYear: isoWeek.isoYear, isoWeek: isoWeek.isoWeek },
          {
            userId,
            isoYear: isoWeek.isoYear,
            isoWeek: isoWeek.isoWeek,
            replaceExisting: true,
            generationRequestId: options.generationRequestId ?? undefined,
          },
        );
        if (options.generationRequestId) {
          try {
            const { markMenuGenerationRequestApplied } = await import("@/lib/supabase/menu-generation-requests");
            await markMenuGenerationRequestApplied(options.generationRequestId, weekId);
          } catch (error: unknown) {
            console.warn(
              "No se pudo marcar el request de generación como aplicado:",
              error instanceof Error ? error.message : error,
            );
          }
        }
        return (await fetch()).version;
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
        return (await fetch()).version;
      },
    };
  },
  async shoppingForWeek(userId, isoWeek) {
    const { getWeekFromSupabaseByIsoWeek } = await import("@/lib/supabase/weeks");
    const week = await getWeekFromSupabaseByIsoWeek({ isoYear: isoWeek.isoYear, isoWeek: isoWeek.isoWeek, userId });
    if (!week?.id) return null;
    const { getLatestShoppingListForWeekFromSupabase } = await import("@/lib/supabase/shopping-lists");
    const list = await getLatestShoppingListForWeekFromSupabase(week.id);
    if (!list || list.items.length === 0) return null;
    // A list generated before the last change of the week no longer matches its dishes.
    if (week.updatedAt && list.generatedAt < week.updatedAt) return null;
    const { groupShoppingListItems } = await import("@/lib/shoppingList");
    const items = list.items.map(({ name, quantity, unit, category }) => ({ name, quantity, unit, category }));
    const checked = list.items.filter((item) => item.checked).map(({ name, quantity, unit, category }) => ({ name, quantity, unit, category }));
    const checkedItemIds = groupShoppingListItems(checked).flatMap((group) => group.items.map((item) => item.id));
    return { items, checkedItemIds, weekId: week.id };
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
  { overwrite = false, ...options }: WeekPushOptions & { overwrite?: boolean } = {},
): Promise<SaveResult<WeekDay[]>> {
  return saveEntity(
    { scope: identity.scope, entity: "week", week: weekKey(isoWeek) },
    weekDays,
    identity.userId ? remotes.week(identity.userId, isoWeek, options) : null,
    { overwrite },
  );
}

export async function getRemoteWeekId(identity: DataIdentity, isoWeek: IsoWeek) {
  return identity.userId ? remotes.week(identity.userId, isoWeek).weekId() : null;
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

// --- Shopping cache (per week; remote list consulted before generating) ---
export type ShoppingCache = {
  weekSignature: string;
  items: GeneratedShoppingListResponse["items"];
  checkedItemIds: string[];
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

export async function loadRemoteShoppingList(identity: DataIdentity, isoWeek: IsoWeek) {
  return identity.userId ? remotes.shoppingForWeek(identity.userId, isoWeek) : null;
}
