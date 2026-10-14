import { expect, test, type Page } from "@playwright/test";
import { accountDish, accountWithMenu, completeOnboarding, createUser, dishButton, pageFor, password, readOwnRows, settleAccountLoad, shoppingItem } from "./helpers";

// Positive signals first (the empty states only render once the account has answered), then
// the absence of A's dishes and items.
const emptyWeek = (page: Page) => page.getByText("No hay menú para esta semana");
async function expectNothingOfA(page: Page, dishOfA: string) {
  await page.goto("/week");
  await expect(emptyWeek(page)).toBeVisible();
  await expect(dishButton(page, dishOfA)).toHaveCount(0);
  await page.goto("/shopping/list");
  await expect(page.getByText("No hay una semana guardada.")).toBeVisible();
  await expect(shoppingItem(page, "Huevos")).toHaveCount(0);
}

// Aislamiento A/B: otra cuenta no ve ni lee la semana de A, ni en otro navegador ni al cambiar
// de cuenta en el mismo dispositivo.
test("la cuenta B no ve la semana, la compra ni las filas de A", async ({ browser }, testInfo) => {
  const [a, b] = await Promise.all([createUser("aislamiento-a"), createUser("aislamiento-b")]);

  const pageA = await pageFor(browser, testInfo, a);
  await accountWithMenu(pageA);
  const dishOfA = await accountDish(a);
  await expect(dishButton(pageA, dishOfA).first()).toBeVisible();
  const [weekA] = await readOwnRows<{ id: string }>(a, "weeks", "select=id");
  expect(weekA?.id).toBeTruthy();

  // Under RLS, B reads none of A's rows, even asking for A's week by id.
  expect(await readOwnRows(b, "weeks", `select=id&id=eq.${weekA.id}`)).toEqual([]);
  expect(await readOwnRows(b, "week_days", `select=id&week_id=eq.${weekA.id}`)).toEqual([]);
  expect(await readOwnRows(b, "shopping_lists", "select=id")).toEqual([]);

  // Another browser signed in as B: no trace of A's menu or shopping list.
  const pageB = await pageFor(browser, testInfo, b);
  await pageB.goto("/onboarding");
  await completeOnboarding(pageB);
  await expectNothingOfA(pageB, dishOfA);

  // Same device: A signs out and B signs in through the form; A's cached week must not show.
  await pageA.goto("/profile");
  await pageA.getByRole("button", { name: "Cerrar sesión" }).click();
  await expect(pageA.getByRole("link", { name: "Entrar o crear cuenta" })).toBeVisible();
  await pageA.goto("/week");
  await expect(emptyWeek(pageA)).toBeVisible();
  await expect(dishButton(pageA, dishOfA)).toHaveCount(0);
  await pageA.goto("/login");
  await pageA.getByLabel("Email").fill(b.email);
  await pageA.getByLabel("Contraseña").fill(password);
  await pageA.getByRole("button", { name: "Entrar" }).click();
  await expect(pageA).toHaveURL(/\/week/);
  await settleAccountLoad(pageA, emptyWeek(pageA));
  await expectNothingOfA(pageA, dishOfA);
});
