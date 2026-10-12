import { NextResponse } from "next/server";

import { accountError, buildAccountExport, exportFileName, verifyAccountSession } from "@/lib/server/account";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

// P37: GET with the caller's session → every row of their account as a downloadable JSON file.
// All or nothing: if any table cannot be read, 503 instead of an incomplete copy.
export async function GET(request: Request) {
  const verified = await verifyAccountSession(request);
  if (!verified.ok) return verified.response;

  const startedAt = performance.now();
  const data = await buildAccountExport(verified.user, verified.accessToken);
  // No identifiers, e-mails or contents in logs.
  console.info("account_export", { outcome: data ? "success" : "unavailable", totalMs: Math.round(performance.now() - startedAt) });
  if (!data) return accountError(503, "No hemos podido preparar la copia de tus datos. Inténtalo de nuevo en unos minutos.");

  return new NextResponse(JSON.stringify(data, null, 2), {
    status: 200,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Content-Disposition": `attachment; filename="${exportFileName()}"`,
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
