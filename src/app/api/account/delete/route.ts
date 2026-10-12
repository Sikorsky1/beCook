import { NextResponse } from "next/server";

import {
  DELETE_CONFIRMATION,
  accountError,
  accountLimits,
  hasBearerToken,
  loginRequired,
  precheckJson,
  readLimitedJson,
  serviceClient,
  verifyAccountSession,
} from "@/lib/server/account";
import { sendOpsAlert } from "@/lib/server/ops-alert";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

// P37: POST {confirmation: "ELIMINAR"} with the caller's session → the Auth user is deleted with
// the service key and the database removes every row of the account (ON DELETE CASCADE); the AI
// usage rows stay without owner for the monthly budget. Immediate and final (decision 5): there is
// no grace period. Copies inside backups disappear when those backups expire.
export async function POST(request: Request) {
  if (!hasBearerToken(request)) return loginRequired();
  const rejected = precheckJson(request, accountLimits.deleteBodyBytes);
  if (rejected) return rejected;
  const verified = await verifyAccountSession(request);
  if (!verified.ok) return verified.response;

  const body = await readLimitedJson(request, accountLimits.deleteBodyBytes);
  if (!body.ok) return body.response;
  if (body.body.confirmation !== DELETE_CONFIRMATION) {
    return accountError(400, `Escribe ${DELETE_CONFIRMATION} para confirmar.`, "confirmation_required");
  }

  const service = serviceClient();
  if (!service) {
    console.warn("account_delete", { outcome: "unconfigured" });
    await sendOpsAlert("account_delete_failed", { route: "/api/account/delete", status: 503 });
    return accountError(503, "Ahora no podemos eliminar la cuenta. Inténtalo de nuevo más tarde.");
  }

  try {
    const { error } = await service.auth.admin.deleteUser(verified.user.id);
    if (error) throw new Error("delete_failed");
  } catch {
    // No user id, e-mail or provider message in logs or alerts.
    console.warn("account_delete", { outcome: "failed" });
    await sendOpsAlert("account_delete_failed", { route: "/api/account/delete", status: 503 });
    return accountError(503, "Ahora no podemos eliminar la cuenta. Inténtalo de nuevo más tarde.");
  }

  console.info("account_delete", { outcome: "deleted" });
  return NextResponse.json({ deleted: true }, { status: 200, headers: { "Cache-Control": "no-store" } });
}
