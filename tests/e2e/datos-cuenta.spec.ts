import { readFile } from "node:fs/promises";
import { expect, test } from "@playwright/test";
import { accountDish, accountWithMenu, createUser, pageFor, settleAccountLoad, signIn } from "./helpers";

// Paso 37: «Tus datos» exporta todo lo de la cuenta y la elimina con «ELIMINAR» escrito; después el
// dispositivo olvida la sesión y su copia, y la semana avisa una vez.
test("exportar mis datos y eliminar la cuenta", async ({ browser }, testInfo) => {
  const user = await createUser("datos");
  const page = await pageFor(browser, testInfo, user);
  await accountWithMenu(page);
  const dish = await accountDish(user);

  await page.getByRole("navigation", { name: "Navegación principal" }).getByRole("link", { name: "Perfil" }).click();
  await settleAccountLoad(page, page.getByRole("heading", { level: 1, name: "Lo que necesita tu menú" }));
  await page.getByRole("link", { name: "Tus datos: descargar o eliminar la cuenta" }).click();
  await expect(page).toHaveURL(/\/profile\/data$/);
  await expect(page.getByRole("heading", { level: 1, name: "Tus datos" })).toBeVisible();

  // Exportación: un JSON con la cuenta, su semana y el registro de IA sin ip_hash.
  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: "Descargar mis datos" }).click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toMatch(/^becook-datos-\d{4}-\d{2}-\d{2}\.json$/);
  const text = await readFile(await download.path(), "utf8");
  const exported = JSON.parse(text) as Record<string, unknown>;
  expect(text).toContain(user.email);
  expect(text).toContain(user.id);
  expect(text).not.toContain("ip_hash");
  expect(JSON.stringify(exported)).toContain(dish);
  await expect(page.getByRole("status").filter({ hasText: /Descarga lista: becook-datos-/ })).toBeVisible();

  // Borrado: el botón espera a «ELIMINAR» exacto.
  const confirmation = page.getByLabel("Escribe ELIMINAR para confirmar");
  const remove = page.getByRole("button", { name: "Eliminar mi cuenta" });
  await expect(remove).toBeDisabled();
  await confirmation.fill("eliminar");
  await expect(remove).toBeDisabled();
  await confirmation.fill("ELIMINAR");
  await expect(remove).toBeEnabled();
  await remove.click();

  await expect(page).toHaveURL(/\/week/);
  await expect(page.getByText("Tu cuenta se ha eliminado.")).toBeVisible();
  // Este dispositivo ya no guarda la sesión ni la copia de esa cuenta.
  const leftovers = await page.evaluate(id => Object.keys(localStorage).filter(key => key.includes(id) || /^sb-.*-auth-token$/.test(key)), user.id);
  expect(leftovers).toEqual([]);
  // La cuenta ya no existe: la contraseña no sirve.
  expect((await signIn(user.email)).status).toBe(400);
  // El aviso sale una sola vez.
  await page.reload();
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  await expect(page.getByText("Tu cuenta se ha eliminado.")).toHaveCount(0);
});
