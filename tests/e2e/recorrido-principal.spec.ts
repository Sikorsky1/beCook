import { expect, test } from "@playwright/test";
import { applyProposal, completeOnboarding, dishButton, generateProposal, password, savedStatus, shoppingItem, uniqueEmail } from "./helpers";

// Alta local → onboarding → propuesta → aplicar → semana → ficha → compra → marcar → recargar.
test("alta, primer menú, ficha y compra que sobrevive a recargar @320", async ({ page }) => {
  await page.goto("/signup");
  await expect(page.getByRole("heading", { level: 1, name: "Crea tu cuenta" })).toBeVisible();
  await page.getByLabel("Email").fill(uniqueEmail("alta"));
  await page.getByLabel("Contraseña", { exact: true }).fill(password);
  await page.getByLabel("Repite la contraseña").fill(password);
  await page.getByRole("button", { name: "Crear cuenta" }).click();

  await expect(page).toHaveURL(/\/onboarding/);
  await completeOnboarding(page, { pantryItem: "Aceite de oliva" });

  await expect(page.getByRole("heading", { level: 1, name: "Prepara tu menú semanal" })).toBeVisible();
  await generateProposal(page);
  await expect(page.getByRole("button", { name: "Otra idea para la comida del lunes" })).toBeVisible();
  await applyProposal(page);
  await page.getByRole("button", { name: "Ver mi semana" }).click();

  await expect(page).toHaveURL(/\/week\?week=\d{4}-W\d{2}/);
  await expect(savedStatus(page)).toBeVisible();
  await expect(dishButton(page, "Pollo asado con batata")).toBeVisible();
  await expect(dishButton(page, "Tosta de Salmón ahumado")).toBeVisible();

  // Ficha: the catalogue dish has no card yet; the estimated one comes from the simulated OpenAI.
  await dishButton(page, "Lentejas estofadas").click();
  const card = page.getByRole("dialog", { name: "Lentejas estofadas" });
  await expect(card).toBeVisible();
  await card.getByRole("button", { name: "Crear ficha estimada (IA)" }).click();
  await expect(card.getByText("Estimada por IA · sin revisar")).toBeVisible();
  await expect(card.getByRole("region", { name: "Ingredientes" })).toContainText("tomate");
  await expect(card.getByRole("region", { name: "Pasos" }).getByRole("listitem")).toHaveCount(2);
  await card.getByRole("button", { name: "Cerrar" }).click();
  await expect(card).toBeHidden();

  await page.getByRole("navigation", { name: "Navegación principal" }).getByRole("link", { name: "Compra" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Tu compra" })).toBeVisible();
  await expect(page.getByText("2 raciones por comida")).toBeVisible();
  const eggs = shoppingItem(page, "Huevos");
  await expect(eggs).toBeVisible({ timeout: 20_000 });
  await expect(shoppingItem(page, "Tomate")).toBeVisible();
  await expect(eggs).not.toBeChecked();

  await eggs.click();
  await expect(eggs).toBeChecked();
  await expect(savedStatus(page)).toBeVisible();
  await expect(page.getByText(/^1\/\d+ comprados$/)).toBeVisible();

  await page.reload();
  await expect(page.getByRole("heading", { level: 1, name: "Tu compra" })).toBeVisible();
  await expect(shoppingItem(page, "Huevos")).toBeChecked();
  await expect(shoppingItem(page, "Tomate")).not.toBeChecked();
  await expect(savedStatus(page)).toBeVisible();
});
