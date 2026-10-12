import path from "node:path";
import { expect, test, type Page } from "@playwright/test";
import { createUser, pageFor } from "./helpers";

// «Ya tengo un menú» desde un archivo: el texto leído va a la caja de pegar y el usuario lo procesa.
const fixture = (name: string) => path.join(__dirname, "fixtures", name);

async function upload(page: Page, file: string) {
  const chooser = page.waitForEvent("filechooser");
  await page.getByRole("button", { name: "Subir PDF o foto" }).click();
  await (await chooser).setFiles(fixture(file));
}

test("invitado sube un PDF con texto: se lee en el dispositivo, sin IA @320", async ({ page }) => {
  const apiCalls: string[] = [];
  page.on("request", request => {
    if (new URL(request.url()).pathname.startsWith("/api/")) apiCalls.push(request.url());
  });

  await page.goto("/create-menu?mode=import");
  await upload(page, "menu-texto.pdf");

  await expect(page.getByRole("status").filter({ hasText: "Hemos pasado «menu-texto.pdf» a texto" })).toBeVisible();
  const pasted = page.getByRole("textbox", { name: "Pega tu menú de la semana" });
  await expect(pasted).toHaveValue(/Lunes\tCrema de calabaza\tTortilla francesa/);
  await page.getByRole("button", { name: "Procesar menú" }).click();

  // The panel is above the generator: the page takes the user to the proposal.
  await expect(page.getByRole("heading", { level: 2, name: "Revisa tu semana" })).toBeInViewport();
  await expect(page.getByText("Ordenado en este dispositivo, sin IA.", { exact: false })).toBeVisible();
  await expect(page.getByRole("region", { name: "Usar la propuesta" })).toContainText("5 platos · 3 días");

  // A photo needs the AI, and the AI needs a session: nothing is sent.
  await upload(page, "menu-foto.png");
  await expect(page.getByText("Las fotos y los PDF escaneados los lee la IA.", { exact: false })).toBeVisible();
  expect(apiCalls, "a guest upload never calls the AI routes").toEqual([]);
});

test("con sesión, una foto del menú la lee la IA y el texto se revisa antes de procesarlo", async ({ browser }, testInfo) => {
  const user = await createUser("foto");
  const page = await pageFor(browser, testInfo, user);
  await page.goto("/create-menu?mode=import");
  await upload(page, "menu-foto.png");

  await expect(page.getByText("Lo ha leído la IA", { exact: false })).toBeVisible();
  const pasted = page.getByRole("textbox", { name: "Pega tu menú de la semana" });
  await expect(pasted).toHaveValue(/^Lunes\nComida: Crema de calabaza\nCena: Tortilla francesa/);
  await pasted.fill((await pasted.inputValue()).replace("Lentejas estofadas", "Lentejas con arroz"));
  await page.getByRole("button", { name: "Procesar menú" }).click();

  await expect(page.getByRole("heading", { level: 2, name: "Revisa tu semana" })).toBeInViewport();
  await expect(page.getByRole("region", { name: "Usar la propuesta" })).toContainText("3 platos · 2 días");
  await page.context().close();
});

test("un texto que no se puede ordenar muestra el problema en pantalla, no fuera de la vista", async ({ page }) => {
  await page.goto("/create-menu?mode=import");
  await page.getByRole("textbox", { name: "Pega tu menú de la semana" }).fill(Array.from({ length: 90 }, (_, i) => `Línea ${i + 1}`).join("\n"));
  await page.getByRole("button", { name: "Procesar menú" }).click();
  await expect(page.getByRole("alert").filter({ hasText: "demasiadas líneas" })).toBeInViewport();
});

test("invitado pega una tabla con los días en columnas (L M X) y se ordena sin IA", async ({ page }) => {
  await page.goto("/create-menu?mode=import");
  await page.getByRole("textbox", { name: "Pega tu menú de la semana" }).fill(
    ["\tL\tM\tX", "Comida\tLentejas\tArroz con verduras\tPasta", "Cena\tSopa\tTortilla francesa\tLIBRE"].join("\n"),
  );
  await page.getByRole("button", { name: "Procesar menú" }).click();
  await expect(page.getByRole("heading", { level: 2, name: "Revisa tu semana" })).toBeInViewport();
  await expect(page.getByRole("region", { name: "Usar la propuesta" })).toContainText("5 platos · 3 días");
});
