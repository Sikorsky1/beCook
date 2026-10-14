import { expect, test, type Browser, type Locator, type Page, type TestInfo } from "@playwright/test";

// Synthetic identities only (e2e-…@example.invalid), against the dedicated local container.
// scripts/e2e.cjs deletes them before each run and after a green one.
export const password = "E2e-local-only-2026!";

function required(name: string) {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is missing: run through npm run test:e2e.`);
  return value;
}

export const supabaseUrl = () => required("E2E_SUPABASE_URL");
const anonKey = () => required("E2E_SUPABASE_ANON_KEY");
const serviceKey = () => required("E2E_SUPABASE_SERVICE_ROLE_KEY");
export const budgetUrl = () => required("E2E_BUDGET_URL");

// supabase-js default storage key: sb-<first label of the API host>-auth-token.
const sessionStorageKey = () => `sb-${new URL(supabaseUrl()).hostname.split(".")[0]}-auth-token`;

let counter = 0;
export function uniqueEmail(label: string) {
  counter += 1;
  return `e2e-${process.env.E2E_RUN_ID ?? "local"}-${label}-${process.pid}-${counter}-${Date.now()}@example.invalid`;
}

export type Session = { access_token: string; refresh_token: string; expires_at?: number; user: { id: string } };
export type TestUser = { email: string; id: string; session: Session };

// Admin API (local service role) + one password sign-in per identity: Auth limits sign-ins
// to 30 every 5 minutes per IP, so journeys never log in through the form unless they test it.
export async function createUser(label: string): Promise<TestUser> {
  const email = uniqueEmail(label);
  const created = await fetch(`${supabaseUrl()}/auth/v1/admin/users`, {
    method: "POST",
    headers: { apikey: serviceKey(), authorization: `Bearer ${serviceKey()}`, "content-type": "application/json" },
    body: JSON.stringify({ email, password, email_confirm: true }),
  });
  if (!created.ok) throw new Error(`Could not create the synthetic user (${created.status}).`);
  const session = (await (await signIn(email)).json()) as Session;
  return { email, id: session.user.id, session };
}

export function signIn(email: string) {
  return fetch(`${supabaseUrl()}/auth/v1/token?grant_type=password`, {
    method: "POST",
    headers: { apikey: anonKey(), "content-type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
}

// A new browser context (same viewport/locale as the project) already signed in as `user`.
export async function pageFor(browser: Browser, testInfo: TestInfo, user?: TestUser): Promise<Page> {
  const { viewport, locale, timezoneId, baseURL, hasTouch } = testInfo.project.use;
  const context = await browser.newContext({
    viewport, locale, timezoneId, baseURL, hasTouch,
    storageState: user
      ? { cookies: [], origins: [{ origin: baseURL!, localStorage: [{ name: sessionStorageKey(), value: JSON.stringify(user.session) }] }] }
      : undefined,
  });
  return context.newPage();
}

// Rows the user can read under RLS, through PostgREST with their own token.
export async function readOwnRows<T>(user: TestUser, table: string, query: string): Promise<T[]> {
  const response = await fetch(`${supabaseUrl()}/rest/v1/${table}?${query}`, {
    headers: { apikey: anonKey(), authorization: `Bearer ${user.session.access_token}` },
  });
  expect(response.status, `GET ${table}`).toBe(200);
  return (await response.json()) as T[];
}

// Custom inputs are visually hidden (sr-only) inside their label: click the label, as a person
// would, and check the input by role and name.
async function choose(page: Page, input: Locator) {
  if (!(await input.isChecked())) await input.locator("xpath=ancestor::label[1]").click();
  await expect(input).toBeChecked();
}

export async function completeOnboarding(page: Page, { pantryItem }: { pantryItem?: string } = {}) {
  await settleAccountLoad(page, page.getByRole("heading", { level: 1, name: "Bienvenido a beCook" }));
  await page.getByRole("button", { name: "Empezar" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Para quién cocinas y qué necesitas" })).toBeVisible();
  await choose(page, page.getByRole("group", { name: "Personas" }).getByRole("radio", { name: "2", exact: true }));
  await choose(page, page.getByRole("checkbox", { name: "Comer más saludable" }));
  await choose(page, page.getByRole("group", { name: "Restricciones alimentarias" }).getByRole("checkbox", { name: "Ninguna" }));
  await choose(page, page.getByRole("group", { name: "Alergias" }).getByRole("checkbox", { name: "Ninguna" }));
  await page.getByRole("button", { name: "Guardar y continuar" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "¿Qué tienes ya en casa?" })).toBeVisible();
  if (pantryItem) {
    const item = page.getByRole("group", { name: "Despensa exprés" }).getByRole("button", { name: pantryItem });
    await item.click();
    await expect(item).toHaveAttribute("aria-pressed", "true");
    await expect(page.getByRole("status").filter({ hasText: "Guardado en tu cuenta" })).toBeVisible();
    await page.getByRole("button", { name: "Terminar y crear mi menú" }).click();
  } else {
    await page.getByRole("button", { name: "Saltar y crear mi menú" }).click();
  }
  await expect(page).toHaveURL(/\/create-menu/);
}

// The week comes from the recipe catalogue (no AI), so its dishes vary: tests read them back.
export async function generateProposal(page: Page) {
  await page.getByRole("button", { name: "Crear menú semanal" }).click();
  await expect(page.getByRole("heading", { level: 2, name: "Revisa tu semana" })).toBeVisible();
  await expect(page.getByRole("region", { name: "Usar la propuesta" })).toContainText("14 platos · 7 días");
}

export async function applyProposal(page: Page) {
  const bar = page.getByRole("region", { name: "Usar la propuesta" });
  await bar.getByRole("button", { name: "Usar este menú" }).click();
  await expect(bar.getByRole("status")).toContainText("Menú guardado en tu cuenta.");
}

// Signed-in account with onboarding done and the simulated menu applied to the current week.
export async function accountWithMenu(page: Page) {
  await page.goto("/onboarding");
  await completeOnboarding(page);
  await generateProposal(page);
  await applyProposal(page);
  await page.getByRole("button", { name: "Ver mi semana" }).click();
  await expect(page).toHaveURL(/\/week/);
  await expect(savedStatus(page)).toBeVisible();
}

export const savedStatus = (page: Page) => page.getByRole("main").getByRole("status").filter({ hasText: "Guardado en tu cuenta" });

// A dish of the account's saved week («Martes» lunch by default), read under its own session.
export async function accountDish(user: TestUser, day = "Martes", meal: "lunch" | "dinner" = "lunch") {
  const rows = await readOwnRows<Record<string, string>>(user, "week_days", `select=${meal}_dish_name&day_name=eq.${encodeURIComponent(day)}`);
  const dish = rows[0]?.[`${meal}_dish_name`];
  if (!dish) throw new Error(`no ${meal} on ${day}`);
  return dish;
}

// The week's dish buttons read «Comida de hoy: X. Ver ficha» or «Comida del Martes: X. Ver ficha».
const escapeRegExp = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
export const dishButton = (page: Page, dish: string) => page.getByRole("button", { name: new RegExp(`: ${escapeRegExp(dish)}\\. Ver ficha$`) });

// Shopping rows: «Tomate, 28 ud» (the quantity depends on the week, the name does not).
export const shoppingItem = (page: Page, name: string) => page.getByRole("checkbox", { name: new RegExp(`^${name}, `) });

// Local PostgREST (v16) caches its clock and can reject a fresh, valid JWT as «issued at future»
// (PGRST303); scripts/e2e.cjs keeps it awake to avoid it. If it still happens on the first load,
// the app shows
// «No se ha podido cargar tu cuenta» with «Reintentar». A person would retry; so does the test,
// and the run records it as an annotation so it stays visible.
export async function settleAccountLoad(page: Page, ready: Locator) {
  const failed = page.getByText("No se ha podido cargar tu cuenta");
  await expect(ready.or(failed).first()).toBeVisible();
  if (await failed.isVisible()) {
    test.info().annotations.push({ type: "postgrest-iat", description: "Carga de cuenta reintentada tras PGRST303 (JWT issued at future) en PostgREST local." });
    await page.getByRole("main").getByRole("button", { name: "Reintentar" }).click();
    await expect(ready).toBeVisible();
  }
}
