import type { Instrumentation } from "next";

import { sendOpsAlert } from "@/lib/server/ops-alert";

// P37: server errors captured by Next.js (render, route handlers, actions, proxy) reach the
// operations channel, at most once per minute per route and instance. Only the route path
// (without query), method, route type and digest are sent: never the error message, headers or
// body, which may contain user data. Without OPS_ALERT_WEBHOOK_URL this does nothing.
export const onRequestError: Instrumentation.onRequestError = async (error, request, context) => {
  const digest =
    typeof error === "object" && error !== null && "digest" in error ? String((error as { digest: unknown }).digest) : undefined;
  await sendOpsAlert("server_error", {
    route: request.path,
    method: request.method,
    routeType: context.routeType,
    digest,
  });
};
