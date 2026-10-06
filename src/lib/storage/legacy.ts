// Pre-B1 keys had no owner. They are moved to the guest scope (never to an account)
// and flagged so a signed-in user can explicitly choose to import them.
import {
  readScoped,
  removeScoped,
  scopedKey,
  writeScoped,
} from "@/lib/storage/scoped-storage";

const LEGACY_PROFILE_KEY = "becook-profile";
const LEGACY_PANTRY_KEY = "becook-pantry-base";
const LEGACY_WEEK_KEY = "becook-week";
const LEGACY_SELECTED_WEEK_KEY = "becook-selected-iso-week";
const LEGACY_SHOPPING_KEY = "becook-shopping-list-cache";
const LEGACY_WEEK_PREFIX = "becook-week:";

export type LegacyOrigin = {
  status: "pending" | "imported" | "declined";
  entities: string[];
  migratedAt: string;
};

function storage(): Storage | null {
  try {
    return typeof window === "undefined" ? null : window.localStorage;
  } catch {
    return null;
  }
}

function parse(raw: string | null): unknown {
  if (raw === null) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function legacyKeys(store: Storage) {
  const keys: string[] = [];
  for (let index = 0; index < store.length; index++) {
    const key = store.key(index);
    if (
      key &&
      (key === LEGACY_PROFILE_KEY ||
        key === LEGACY_PANTRY_KEY ||
        key === LEGACY_WEEK_KEY ||
        key === LEGACY_SELECTED_WEEK_KEY ||
        key === LEGACY_SHOPPING_KEY ||
        key.startsWith(LEGACY_WEEK_PREFIX))
    ) {
      keys.push(key);
    }
  }
  return keys;
}

// Idempotent. Existing guest data always wins over a legacy copy.
export function migrateLegacyStorage(): LegacyOrigin | null {
  const store = storage();
  if (!store) return null;
  const keys = legacyKeys(store);
  if (keys.length === 0) return readLegacyOrigin();

  const entities = new Set<string>(readLegacyOrigin()?.entities ?? []);
  const moveIfAbsent = (entity: "profile" | "pantry" | "week" | "selected-week", value: unknown, week?: string) => {
    if (value === null || value === undefined) return;
    if (store.getItem(scopedKey("guest", entity, week)) !== null) return;
    writeScoped("guest", entity, value, { week });
    if (entity !== "selected-week") entities.add(week ? `${entity}:${week}` : entity);
  };

  for (const key of keys) {
    const value = parse(store.getItem(key));
    if (key === LEGACY_PROFILE_KEY) moveIfAbsent("profile", value);
    else if (key === LEGACY_PANTRY_KEY) moveIfAbsent("pantry", value);
    else if (key === LEGACY_SELECTED_WEEK_KEY) moveIfAbsent("selected-week", value);
    else if (key.startsWith(LEGACY_WEEK_PREFIX)) {
      const week = key.slice(LEGACY_WEEK_PREFIX.length);
      if (/^\d{4}-W\d{2}$/.test(week) && Array.isArray(value)) moveIfAbsent("week", value, week);
    }
    // `becook-week` (no ISO week) and the shopping cache are not attributable to a week:
    // the former predates ISO weeks and the latter is regenerable. Both are dropped.
    store.removeItem(key);
  }

  if (entities.size === 0) return readLegacyOrigin();
  const origin: LegacyOrigin = {
    status: readLegacyOrigin()?.status ?? "pending",
    entities: [...entities].sort(),
    migratedAt: new Date().toISOString(),
  };
  writeScoped("guest", "legacy-origin", origin);
  return origin;
}

export function readLegacyOrigin(): LegacyOrigin | null {
  return readScoped<LegacyOrigin>("guest", "legacy-origin");
}

export function resolveLegacyOrigin(status: LegacyOrigin["status"], remainingEntities: string[] = []) {
  const origin = readLegacyOrigin();
  if (!origin) return;
  writeScoped("guest", "legacy-origin", { ...origin, status, entities: remainingEntities });
}

export function removeGuestEntity(entity: string) {
  const [name, week] = entity.split(":", 2) as ["profile" | "pantry" | "week", string | undefined];
  removeScoped("guest", name, week);
}
