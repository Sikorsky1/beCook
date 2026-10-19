import { expect, test } from "@playwright/test";
import { dishButton } from "./helpers";

// Invitado: pega una tabla (día, comida, cena), se ordena en el dispositivo sin IA y se guarda solo aquí.
test("invitado importa una tabla sin IA y la semana queda en el dispositivo @320", async ({ page }) => {
  const apiCalls: string[] = [];
  page.on("request", request => {
    if (new URL(request.url()).pathname.startsWith("/api/")) apiCalls.push(request.url());
  });

  await page.goto("/import");
  await expect(page).toHaveURL(/\/create-menu\?mode=import/);
  const pasted = page.getByRole("textbox", { name: "Escribe o pega tu menú" });
  await pasted.fill([
    "Lunes\tCrema de calabaza\tTortilla francesa",
    "Martes\tArroz con verduras\tLIBRE",
    "Miércoles\tLentejas con arroz\tEnsalada de pasta",
  ].join("\n"));
  await page.getByRole("button", { name: "Procesar menú" }).click();

  await expect(page.getByRole("heading", { level: 2, name: "Revisa tu semana" })).toBeVisible();
  await expect(page.getByText("Ordenado en este dispositivo, sin IA.", { exact: false })).toBeVisible();
  const bar = page.getByRole("region", { name: "Usar la propuesta" });
  await expect(bar).toContainText("5 platos · 3 días");
  await bar.getByRole("button", { name: "Usar este menú" }).click();

  await expect(page).toHaveURL(/\/week/);
  const status = page.getByRole("main").getByRole("status").filter({ hasText: "Solo en este dispositivo" });
  await expect(status).toBeVisible();
  await expect(dishButton(page, "Crema de calabaza")).toBeVisible();
  await expect(dishButton(page, "Ensalada de pasta")).toBeVisible();
  await expect(page.getByRole("button", { name: /^Cena (del Martes|de hoy): sin plato/ })).toBeVisible();

  await page.reload();
  await expect(dishButton(page, "Lentejas con arroz")).toBeVisible();
  await expect(status).toBeVisible();
  expect(apiCalls, "a guest import never calls the AI routes").toEqual([]);
});
