import { expect, test, type Request } from "@playwright/test";
import { accountDish, accountWithMenu, completeOnboarding, createUser, dishButton, generateProposal, pageFor, readOwnRows, savedStatus, settleAccountLoad, shoppingItem } from "./helpers";

test("sin red con la cuenta: pendiente de sincronizar, «Reintentar» y guardado al volver", async ({ browser }, testInfo) => {
  const user = await createUser("red");
  const page = await pageFor(browser, testInfo, user);
  await accountWithMenu(page);
  await page.goto("/shopping/list");
  const eggs = shoppingItem(page, "Huevos");
  await expect(eggs).toBeVisible({ timeout: 20_000 });
  await expect(savedStatus(page)).toBeVisible();

  // Only the account API fails; the page and the app keep working.
  await page.route("**/rest/v1/**", route => route.abort("internetdisconnected"));
  await eggs.click();
  await expect(eggs).toBeChecked();
  await expect(page.getByRole("main").getByRole("status").filter({ hasText: /Pendiente de sincronizar|Error: reintentar/ })).toBeVisible();
  const retry = page.getByRole("main").getByRole("button", { name: "Reintentar" }).first();
  await expect(retry).toBeVisible();

  await page.unroute("**/rest/v1/**");
  await retry.click();
  await expect(savedStatus(page)).toBeVisible();
  await page.reload();
  await expect(shoppingItem(page, "Huevos")).toBeChecked();
});

test("dos dispositivos editan el mismo plato: el segundo ve el conflicto y la versión de la cuenta", async ({ browser }, testInfo) => {
  const user = await createUser("conflicto");
  const first = await pageFor(browser, testInfo, user);
  await accountWithMenu(first);
  const tuesdayLunch = await accountDish(user);
  // Same account in another browser context (another device), opened before the first edit.
  const second = await pageFor(browser, testInfo, user);
  await second.goto("/week");
  await settleAccountLoad(second, savedStatus(second));
  await expect(dishButton(second, tuesdayLunch).first()).toBeVisible();

  async function editTuesdayLunch(page: typeof first, dish: string) {
    await dishButton(page, tuesdayLunch).first().click();
    await page.getByRole("button", { name: "Cambiar plato de la comida del Martes" }).click();
    await page.getByRole("textbox", { name: "Comida del Martes" }).fill(dish);
    await page.getByRole("button", { name: "Guardar comida de Martes" }).click();
  }

  await editTuesdayLunch(first, "Garbanzos con espinacas");
  await expect(dishButton(first, "Garbanzos con espinacas")).toBeVisible();
  await expect(savedStatus(first)).toBeVisible();

  await editTuesdayLunch(second, "Pisto con huevo");
  await expect(second.getByText("Tu cuenta tenía cambios más recientes de otro dispositivo", { exact: false })).toBeVisible();
  await expect(dishButton(second, "Garbanzos con espinacas")).toBeVisible();
  await expect(dishButton(second, "Pisto con huevo")).toHaveCount(0);

  const query = new URLSearchParams({ select: "lunch_dish_name", lunch_dish_name: 'in.("Garbanzos con espinacas","Pisto con huevo")' });
  const days = await readOwnRows<{ lunch_dish_name: string }>(user, "week_days", query.toString());
  expect(days.map(day => day.lunch_dish_name)).toEqual(["Garbanzos con espinacas"]);
});

test("doble clic en «Usar este menú» guarda el menú una sola vez", async ({ browser }, testInfo) => {
  const user = await createUser("doble-clic");
  const page = await pageFor(browser, testInfo, user);
  const applyRequests: Request[] = [];
  page.on("request", request => {
    if (request.url().includes("/rest/v1/rpc/apply_week")) applyRequests.push(request);
  });
  await page.goto("/onboarding");
  await completeOnboarding(page);
  await generateProposal(page);

  const bar = page.getByRole("region", { name: "Usar la propuesta" });
  await bar.getByRole("button", { name: "Usar este menú" }).dblclick();
  await expect(bar.getByRole("status")).toContainText(/Menú guardado en tu cuenta\.|Este menú ya estaba guardado en tu cuenta\./);
  await expect(bar.getByText(/conflict|otro dispositivo/i)).toHaveCount(0);

  // One week, written once: any repeated request reuses the same idempotency key.
  const weeks = await readOwnRows<{ id: string; version: number }>(user, "weeks", "select=id,version");
  expect(weeks).toHaveLength(1);
  expect(weeks[0].version).toBe(1);
  expect(applyRequests.length).toBeGreaterThanOrEqual(1);
  const keys = new Set(applyRequests.map(request => (request.postDataJSON() as { p_request_key: string }).p_request_key));
  expect(keys.size).toBe(1);
  const days = await readOwnRows(user, "week_days", `select=id&week_id=eq.${weeks[0].id}`);
  expect(days).toHaveLength(7);
});
