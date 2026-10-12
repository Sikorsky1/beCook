import "server-only";

import { after } from "next/server";

// P37: operational alerts to one channel (OPS_ALERT_WEBHOOK_URL). Without that variable nothing is
// sent. An alert never carries personal data or meal content: only the fields listed here, as
// short scalars, plus the environment and the commit. It never throws and waits at most 3 s.
//
// Channel (decision 6 of wave 8): e-mail through Resend. When the URL is Resend's e-mail API
// (https://api.resend.com/emails) the alert is sent as an e-mail with OPS_ALERT_WEBHOOK_TOKEN as the
// API key, to OPS_ALERT_EMAIL_TO, from OPS_ALERT_EMAIL_FROM. Any other https URL receives a JSON
// webhook ({text, content, event, fields, ...}, readable by Slack or Discord style hooks), with
// OPS_ALERT_WEBHOOK_TOKEN as a Bearer token when it is set.

export type OpsAlertEvent =
  | "ai_budget_threshold"
  | "ai_budget_exhausted"
  | "ai_usage_finish_failed"
  | "ai_ledger_unavailable"
  | "account_delete_failed"
  | "server_error";

export type OpsAlertFields = Partial<{
  flow: string;
  threshold: string;
  monthCostUsd: number;
  monthlyBudgetUsd: number;
  requestId: string;
  route: string;
  method: string;
  routeType: string;
  digest: string;
  status: number;
}>;

const allowedFields = [
  "flow",
  "threshold",
  "monthCostUsd",
  "monthlyBudgetUsd",
  "requestId",
  "route",
  "method",
  "routeType",
  "digest",
  "status",
] as const;

const timeoutMs = 3_000;
const minIntervalMs = 60_000;
// Wave 8: a global ceiling per server instance, so a burst of distinct routes (or a crawler hitting
// many failing paths) cannot flood the channel, and a bounded map of recent keys.
const maxAlertsPerWindow = 10;
const maxTrackedKeys = 200;
const resendEmailsUrl = "https://api.resend.com/emails";
const defaultFrom = "beCook alertas <no-reply@becook.xyz>";

// One alert per event and route (or flow / threshold) per minute in this server instance, and at
// most maxAlertsPerWindow alerts per minute in total.
const lastSent = new Map<string, number>();
let windowSends: number[] = [];

export function resetOpsAlertLimiter() {
  lastSent.clear();
  windowSends = [];
}

export const opsAlertLimits = { maxAlertsPerWindow, maxTrackedKeys, minIntervalMs } as const;

export function trackedOpsAlertKeys() {
  return lastSent.size;
}

// True when the alert may be sent now; records it. Expired keys are dropped on every call and the
// oldest are evicted beyond maxTrackedKeys, so the map stays small whatever the traffic.
function takeAlertSlot(key: string, now: number) {
  windowSends = windowSends.filter((sentAt) => now - sentAt < minIntervalMs);
  for (const [trackedKey, sentAt] of lastSent) {
    if (now - sentAt >= minIntervalMs) lastSent.delete(trackedKey);
  }
  const previous = lastSent.get(key);
  if (previous !== undefined && now - previous < minIntervalMs) return false;
  if (windowSends.length >= maxAlertsPerWindow) return false;
  windowSends.push(now);
  lastSent.delete(key);
  lastSent.set(key, now);
  while (lastSent.size > maxTrackedKeys) {
    const oldest = lastSent.keys().next().value;
    if (oldest === undefined) break;
    lastSent.delete(oldest);
  }
  return true;
}

// Path only: no query string or fragment, and identifiers replaced, so no value typed by a user
// (search terms, e-mails in links, tokens) can reach the channel.
export function sanitizeRoute(value: string) {
  const path = value.split(/[?#]/, 1)[0] ?? "";
  const cleaned = path
    .split("/")
    .map((segment) => (/^[0-9a-f-]{16,}$/i.test(segment) || /\d{4,}/.test(segment) || segment.includes("@") ? ":id" : segment))
    .join("/")
    .replace(/[^A-Za-z0-9/_\-.:[\]()]/g, "");
  return cleaned.slice(0, 120) || "/";
}

function cleanString(value: string) {
  return value.replace(/[^A-Za-z0-9 _\-.:%/]/g, "").slice(0, 80);
}

// Only allowed keys with short scalar values survive; anything else is dropped.
export function sanitizeAlertFields(fields: Record<string, unknown>): OpsAlertFields {
  const result: Record<string, string | number> = {};
  for (const key of allowedFields) {
    const value = fields[key];
    if (typeof value === "number" && Number.isFinite(value)) result[key] = Math.round(value * 10_000) / 10_000;
    else if (typeof value === "string" && value.trim()) result[key] = key === "route" ? sanitizeRoute(value) : cleanString(value.trim());
  }
  return result as OpsAlertFields;
}

function readTarget() {
  const raw = process.env.OPS_ALERT_WEBHOOK_URL?.trim();
  if (!raw) return null;
  try {
    const url = new URL(raw);
    const local = url.hostname === "localhost" || url.hostname === "127.0.0.1";
    if (url.protocol !== "https:" && !(local && url.protocol === "http:")) return null;
    return url;
  } catch {
    return null;
  }
}

function environment() {
  return {
    env: cleanString(process.env.VERCEL_ENV || process.env.NODE_ENV || "unknown"),
    commit: cleanString((process.env.VERCEL_GIT_COMMIT_SHA || "").slice(0, 7)) || null,
  };
}

export function buildOpsAlert(event: OpsAlertEvent, fields: OpsAlertFields) {
  const { env, commit } = environment();
  const lines = Object.entries(fields).map(([key, value]) => `${key}: ${value}`);
  const subject = `[beCook ${env}] ${event}`;
  const text = [subject, ...lines, `commit: ${commit ?? "-"}`].join("\n");
  return { event, env, commit, fields, subject, text, at: new Date().toISOString() };
}

export async function sendOpsAlert(event: OpsAlertEvent, rawFields: Record<string, unknown> = {}): Promise<boolean> {
  try {
    const target = readTarget();
    if (!target) return false;
    const fields = sanitizeAlertFields(rawFields);
    const key = `${event}|${fields.route ?? ""}|${fields.flow ?? ""}|${fields.threshold ?? ""}`;
    if (!takeAlertSlot(key, Date.now())) return false;

    const alert = buildOpsAlert(event, fields);
    const token = process.env.OPS_ALERT_WEBHOOK_TOKEN?.trim();
    const headers: Record<string, string> = { "content-type": "application/json" };
    if (token) headers.authorization = `Bearer ${token}`;

    let body: string;
    if (target.href === resendEmailsUrl) {
      const to = process.env.OPS_ALERT_EMAIL_TO?.trim();
      if (!token || !to) return false;
      body = JSON.stringify({
        from: process.env.OPS_ALERT_EMAIL_FROM?.trim() || defaultFrom,
        to: to.split(",").map((address) => address.trim()).filter(Boolean),
        subject: alert.subject,
        text: alert.text,
      });
    } else {
      body = JSON.stringify({ ...alert, content: alert.text });
    }

    const response = await fetch(target, {
      method: "POST",
      headers,
      body,
      redirect: "error",
      signal: AbortSignal.timeout(timeoutMs),
    });
    return response.ok;
  } catch {
    // The channel being down never affects the request that raised the alert.
    return false;
  }
}

// For request code (route handlers, server functions): the alert goes out after the response with
// next/server after(), so a slow channel never delays the user. Outside a request scope (unit tests,
// scripts) after() throws and the alert is sent before returning.
export async function notifyOps(event: OpsAlertEvent, rawFields: Record<string, unknown> = {}): Promise<void> {
  try {
    after(async () => {
      await sendOpsAlert(event, rawFields);
    });
    return;
  } catch {
    // No request scope.
  }
  await sendOpsAlert(event, rawFields);
}
