// Explicit, user-confirmed import of pre-B1 device data (now held in the guest scope).
// Never overwrites the account: an entity is imported only if the account has none.
import type { WeekDay } from "@/data/mockWeek";
import {
  loadPantry,
  loadProfile,
  loadWeek,
  savePantry,
  saveProfile,
  saveWeek,
  type DataIdentity,
} from "@/lib/data/repositories";
import { parseIsoWeek } from "@/lib/isoWeek";
import { pantryItemsOrDefault } from "@/lib/pantryStorage";
import { readLegacyOrigin, removeGuestEntity, resolveLegacyOrigin } from "@/lib/storage/legacy";
import { readScoped } from "@/lib/storage/scoped-storage";
import type { UserProfile } from "@/lib/supabase/profiles";

export type LegacyImportResult = { imported: string[]; keptInAccount: string[]; failed: string[] };

function isoWeekFromId(id: string) {
  const match = /^(\d{4})-W(\d{2})$/.exec(id);
  return match ? parseIsoWeek({ isoYear: Number(match[1]), isoWeek: Number(match[2]) }) : null;
}

export function hasPendingLegacyData() {
  const origin = readLegacyOrigin();
  return origin?.status === "pending" && origin.entities.length > 0;
}

export async function importLegacyData(identity: DataIdentity): Promise<LegacyImportResult> {
  const result: LegacyImportResult = { imported: [], keptInAccount: [], failed: [] };
  const origin = readLegacyOrigin();
  if (!identity.userId || !origin || origin.status !== "pending") return result;

  for (const entity of origin.entities) {
    try {
      let outcome: "imported" | "kept" | "failed" = "failed";
      if (entity === "profile") {
        const local = readScoped<UserProfile>("guest", "profile");
        const remote = await loadProfile(identity);
        if (remote.offline) outcome = "failed";
        else if (remote.data) outcome = "kept";
        else if (local) outcome = (await saveProfile(identity, local)).status === "synced" ? "imported" : "failed";
      } else if (entity === "pantry") {
        const local = pantryItemsOrDefault(readScoped("guest", "pantry"));
        const remote = await loadPantry(identity);
        if (remote.offline) outcome = "failed";
        else if (remote.data) outcome = "kept";
        else outcome = (await savePantry(identity, local)).status === "synced" ? "imported" : "failed";
      } else if (entity.startsWith("week:")) {
        const isoWeek = isoWeekFromId(entity.slice(5));
        const local = readScoped<WeekDay[]>("guest", "week", entity.slice(5));
        if (isoWeek && local?.length) {
          const remote = await loadWeek(identity, isoWeek);
          if (remote.offline) outcome = "failed";
          else if (remote.data) outcome = "kept";
          else outcome = (await saveWeek(identity, isoWeek, local)).status === "synced" ? "imported" : "failed";
        }
      }
      if (outcome === "imported") {
        removeGuestEntity(entity);
        result.imported.push(entity);
      } else if (outcome === "kept") {
        result.keptInAccount.push(entity);
      } else {
        result.failed.push(entity);
      }
    } catch {
      result.failed.push(entity);
    }
  }

  // Failed entities stay offered; the rest is settled (entities already in the account stay as guest data).
  if (result.failed.length === 0) resolveLegacyOrigin("imported");
  else resolveLegacyOrigin("pending", result.failed);
  return result;
}

export function declineLegacyImport() {
  resolveLegacyOrigin("declined");
}
