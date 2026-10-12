import { supabase } from "./client";

export type PantryCategory =
  | "básicos"
  | "especias"
  | "salsas"
  | "conservas"
  | "congelados"
  | "otros";
// «Aceites y vinagres» was a section until 2026-10-12; rows still holding it are read as «Básicos».
type LegacyPantryCategory = PantryCategory | "aceites y vinagres";

export type PantryItem = {
  id?: string;
  profileId?: string;
  userId?: string;
  name: string;
  category: PantryCategory;
  active: boolean;
};

type PantryItemRow = {
  id: string;
  profile_id: string | null;
  user_id?: string | null;
  name: string | null;
  category: string | null;
  active: boolean | null;
};

const pantryCategoryValues = new Set<LegacyPantryCategory>([
  "básicos",
  "especias",
  "aceites y vinagres",
  "salsas",
  "conservas",
  "congelados",
  "otros",
]);

function parseRequiredString(value: string | null, columnName: string) {
  if (typeof value === "string" && value.length > 0) {
    return value;
  }

  throw new Error(`Unexpected empty value in ${columnName}.`);
}

function parseRequiredBoolean(value: boolean | null, columnName: string) {
  if (typeof value === "boolean") {
    return value;
  }

  throw new Error(`Unexpected empty value in ${columnName}.`);
}

function parsePantryCategory(value: string | null): PantryCategory {
  const parsedValue = parseRequiredString(value, "pantry_items.category");

  if (pantryCategoryValues.has(parsedValue as LegacyPantryCategory)) {
    return parsedValue === "aceites y vinagres" ? "básicos" : (parsedValue as PantryCategory);
  }

  throw new Error(`Unexpected value in pantry_items.category: ${parsedValue}.`);
}

function rowToPantryItem(row: PantryItemRow): PantryItem {
  return {
    id: row.id,
    profileId: row.profile_id ?? undefined,
    userId: row.user_id ?? undefined,
    name: parseRequiredString(row.name, "pantry_items.name"),
    category: parsePantryCategory(row.category),
    active: parseRequiredBoolean(row.active, "pantry_items.active"),
  };
}

export async function getLatestPantryItemsFromSupabase(
  profileId?: string,
): Promise<PantryItem[]> {
  if (!supabase) {
    throw new Error(
      "Supabase client is not configured. Check NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY in .env.local.",
    );
  }

  let query = supabase
    .from("pantry_items")
    .select("id,profile_id,user_id,name,category,active")
    .order("category", { ascending: true })
    .order("name", { ascending: true });

  if (profileId) {
    query = query.eq("profile_id", profileId);
  }

  const { data: pantryItems, error: pantryItemsError } = await query;

  if (pantryItemsError) {
    throw new Error(`Could not read pantry items: ${pantryItemsError.message}`);
  }

  return ((pantryItems ?? []) as PantryItemRow[]).map(rowToPantryItem);
}

// One account row of the pantry and its version (pantry_items.version, B7).
export type PantryRowState = {
  id: string;
  name: string;
  category: PantryCategory;
  active: boolean;
  version: number;
};

export type PantryRowRef = { id: string; version: number };

export type AddPantryItemResult = {
  // The id sent by the client.
  id: string;
  // created · duplicate: already added with that id · existing: same category and name already there.
  result: "created" | "duplicate" | "existing";
  row: PantryRowState;
};

export type PantryRowsWriteResult = {
  status: "applied" | "conflict" | "missing";
  rows: PantryRowState[];
};

function requireSupabase() {
  if (!supabase) {
    throw new Error(
      "Supabase client is not configured. Check NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY in .env.local.",
    );
  }
  return supabase;
}

function parseRowState(value: unknown): PantryRowState {
  const row = value as { id?: unknown; name?: unknown; category?: unknown; active?: unknown; version?: unknown } | null;
  if (!row || typeof row.id !== "string" || typeof row.version !== "number") {
    throw new Error("Unexpected pantry row.");
  }
  return {
    id: row.id,
    name: parseRequiredString(typeof row.name === "string" ? row.name : null, "pantry_items.name"),
    category: parsePantryCategory(typeof row.category === "string" ? row.category : null),
    active: parseRequiredBoolean(typeof row.active === "boolean" ? row.active : null, "pantry_items.active"),
    version: row.version,
  };
}

// The signed-in user's pantry rows, oldest first (the first row of an item names it), and the
// latest updated_at (only to recognise device copies saved before B7; null when empty).
export async function getPantryRowsForUserFromSupabase(
  userId: string,
): Promise<{ rows: PantryRowState[]; version: string | null }> {
  const { data, error } = await requireSupabase()
    .from("pantry_items")
    .select("id,name,category,active,version,updated_at")
    .eq("user_id", userId)
    .order("created_at", { ascending: true })
    .order("id", { ascending: true });

  if (error) {
    throw new Error(`Could not read pantry items: ${error.message}`);
  }

  const rows = (data ?? []) as { updated_at: string | null }[];
  const version = rows.reduce<string | null>(
    (latest, row) => (row.updated_at && (!latest || row.updated_at > latest) ? row.updated_at : latest),
    null,
  );

  return { rows: rows.map(parseRowState), version };
}

// add_pantry_items: ids chosen by the client, so a retried request changes nothing.
export async function addPantryItemsInSupabase(
  items: { id: string; name: string; category: PantryCategory; active: boolean }[],
): Promise<AddPantryItemResult[]> {
  const { data, error } = await requireSupabase().rpc("add_pantry_items", {
    p_items: items.map(({ id, name, category, active }) => ({ id, name, category, active })),
  });

  if (error) {
    throw new Error(`Could not add pantry items: ${error.message}`);
  }

  const result = data as { status?: string; items?: { id?: unknown; result?: unknown; row?: unknown }[] } | null;
  if (result?.status !== "applied" || !Array.isArray(result.items)) {
    throw new Error("Unexpected add_pantry_items result.");
  }

  return result.items.map((item) => {
    if (typeof item.id !== "string" || !["created", "duplicate", "existing"].includes(String(item.result))) {
      throw new Error("Unexpected add_pantry_items result.");
    }
    return { id: item.id, result: item.result as AddPantryItemResult["result"], row: parseRowState(item.row) };
  });
}

function parseRowsWrite(data: unknown, name: string): PantryRowsWriteResult {
  const result = data as { status?: string; rows?: unknown } | null;
  if ((result?.status === "applied" || result?.status === "conflict" || result?.status === "missing")
    && (result.rows === null || Array.isArray(result.rows))) {
    return { status: result.status, rows: ((result.rows ?? []) as unknown[]).map(parseRowState) };
  }
  throw new Error(`Unexpected ${name} result.`);
}

// set_pantry_items_active: sets (never toggles) the value of every row of one visible item.
export async function setPantryItemsActiveInSupabase(rows: PantryRowRef[], active: boolean) {
  const { data, error } = await requireSupabase().rpc("set_pantry_items_active", {
    p_rows: rows.map(({ id, version }) => ({ id, version })),
    p_active: active,
  });

  if (error) {
    throw new Error(`Could not update pantry items: ${error.message}`);
  }

  return parseRowsWrite(data, "set_pantry_items_active");
}

// delete_pantry_items: rows already gone count as deleted.
export async function deletePantryItemsInSupabase(rows: PantryRowRef[]) {
  const { data, error } = await requireSupabase().rpc("delete_pantry_items", {
    p_rows: rows.map(({ id, version }) => ({ id, version })),
  });

  if (error) {
    throw new Error(`Could not delete pantry items: ${error.message}`);
  }

  return parseRowsWrite(data, "delete_pantry_items");
}
