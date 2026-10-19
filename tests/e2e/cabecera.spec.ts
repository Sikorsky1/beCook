import { expect, test, type Page } from "@playwright/test";
import { accountWithMenu, createUser, pageFor, savedStatus, settleAccountLoad, listedItem } from "./helpers";

// Paso 34: cabecera fija compacta (≤ 120 px pegados arriba) y foco visible al tabular, a 390 y 320 px.
// Nombres accesibles congelados en design-plans/2026-10-15-consolidacion-paso-34.md.
const maxFixedHeaderPx = 120;

type Layout = { fixedTop: number; fixedBottom: number; scrollable: boolean; overflowX: boolean };

// What is stuck at the top (sticky header bar and pinned row) and what covers the bottom (bottom
// navigation, a sticky save bar), measured in the page.
async function layout(page: Page): Promise<Layout> {
  return page.evaluate(() => {
    let fixedTop = 0;
    let fixedBottom = window.innerHeight;
    for (const element of Array.from(document.querySelectorAll<HTMLElement>("body *"))) {
      const position = getComputedStyle(element).position;
      if (position !== "sticky" && position !== "fixed") continue;
      const rect = element.getBoundingClientRect();
      if (rect.height === 0 || rect.width === 0) continue;
      if (rect.top <= 1 + fixedTop && rect.top < window.innerHeight / 2) fixedTop = Math.max(fixedTop, rect.bottom);
      else if (rect.bottom >= window.innerHeight - 200 && rect.top > window.innerHeight / 2) fixedBottom = Math.min(fixedBottom, rect.top);
    }
    const root = document.documentElement;
    return { fixedTop, fixedBottom, scrollable: root.scrollHeight > window.innerHeight + 1, overflowX: root.scrollWidth > root.clientWidth };
  });
}

async function expectCompactHeader(page: Page, h1: RegExp | string) {
  const heading = page.getByRole("heading", { level: 1, name: h1 });
  await expect(heading).toBeVisible();
  await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
  await expect.poll(async () => (await layout(page)).fixedTop).toBeGreaterThan(0);
  const measured = await layout(page);
  expect(measured.overflowX, "sin desplazamiento horizontal").toBe(false);
  expect(measured.fixedTop, "alto pegado arriba").toBeLessThanOrEqual(maxFixedHeaderPx);
  // The h1 scrolls away with the content; only the bar (and the pinned row) stay.
  // A short page (Despensa) may scroll just enough to tuck it under the bar: hidden all the same.
  if (measured.scrollable) {
    await expect
      .poll(async () => {
        const box = await heading.boundingBox();
        return box ? box.y + box.height : Number.NEGATIVE_INFINITY;
      })
      .toBeLessThanOrEqual(measured.fixedTop + 1);
  }
  await page.evaluate(() => window.scrollTo(0, 0));
}

// The focused element is never hidden under the fixed header or the bottom bars.
async function expectFocusClear(page: Page): Promise<boolean> {
  const state = await page.evaluate(() => {
    const active = document.activeElement as HTMLElement | null;
    if (!active || active === document.body) return null;
    let node: HTMLElement | null = active;
    while (node) {
      const position = getComputedStyle(node).position;
      if (position === "sticky" || position === "fixed") return null; // part of a fixed bar itself
      node = node.parentElement;
    }
    const rect = active.getBoundingClientRect();
    const label = active.getAttribute("aria-label") || active.textContent?.trim().slice(0, 40) || active.tagName;
    return { top: rect.top, bottom: rect.bottom, label };
  });
  if (!state) return false;
  const { fixedTop, fixedBottom } = await layout(page);
  expect(state.top, `«${state.label}» bajo la cabecera fija`).toBeGreaterThanOrEqual(fixedTop - 1);
  expect(state.bottom, `«${state.label}» bajo la barra inferior`).toBeLessThanOrEqual(fixedBottom + 1);
  return true;
}

// Returns how many focused elements outside the fixed bars were checked.
async function tabThrough(page: Page, key: "Tab" | "Shift+Tab", presses: number) {
  let checked = 0;
  for (let i = 0; i < presses; i += 1) {
    await page.keyboard.press(key);
    if (await expectFocusClear(page)) checked += 1;
  }
  return checked;
}

test("cabecera compacta en Semana, Compra, Despensa y Perfil, y foco visible al tabular @320", async ({ browser }, testInfo) => {
  const user = await createUser("cabecera");
  const page = await pageFor(browser, testInfo, user);
  await accountWithMenu(page);

  // Semana: barra con ‹ › y el h1 con el título completo de la semana.
  await expect(page.getByRole("button", { name: "Semana anterior" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Semana siguiente" })).toBeVisible();
  await expect(page.getByRole("group", { name: "Ir a un día de la semana" })).toBeVisible();
  await expectCompactHeader(page, /\d{1,2}\s?–\s?\d{1,2}|\d{1,2} \p{L}+ – \d{1,2}/u);

  // Compra: h1, pestañas y accesos de sección; casillas «Nombre, cantidad».
  await page.getByRole("navigation", { name: "Navegación principal" }).getByRole("link", { name: "Compra" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Tu compra" })).toBeVisible();
  const tabs = page.getByRole("navigation", { name: "Secciones de compra" });
  await expect(tabs.getByRole("link", { name: "Lista de la compra" })).toBeVisible();
  await expect(await listedItem(page)).toBeVisible();
  await expect(page.getByRole("navigation", { name: "Secciones de la lista" })).toBeVisible();
  await expect(savedStatus(page)).toBeVisible();
  await expectCompactHeader(page, "Tu compra");

  // Hacia atrás desde la última casilla: cada elemento enfocado queda bajo la cabecera fija.
  const boxes = page.getByRole("checkbox");
  await boxes.last().focus();
  await expectFocusClear(page);
  expect(await tabThrough(page, "Shift+Tab", 14)).toBeGreaterThanOrEqual(8);
  // Y hacia delante desde arriba: nada queda tapado por la navegación inferior.
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.getByRole("heading", { level: 1, name: "Tu compra" }).click();
  expect(await tabThrough(page, "Tab", 14)).toBeGreaterThanOrEqual(8);

  // Despensa: misma barra, sin fila fija.
  await page.goto("/shopping/pantry");
  await expect(page.getByRole("heading", { level: 1, name: "Tu despensa" })).toBeVisible();
  await expect(page.getByRole("navigation", { name: "Secciones de compra" }).getByRole("link", { name: "Despensa" })).toBeVisible();
  await expectCompactHeader(page, "Tu despensa");

  // Perfil.
  await page.getByRole("navigation", { name: "Navegación principal" }).getByRole("link", { name: "Perfil" }).click();
  await settleAccountLoad(page, page.getByRole("heading", { level: 1, name: "Lo que necesita tu menú" }));
  // «Guardar perfil» solo aparece sin perfil guardado; tras el onboarding, cada sección guarda la suya.
  await expect(page.getByRole("link", { name: "Tus datos: descargar o eliminar la cuenta" })).toBeAttached();
  await expectCompactHeader(page, "Lo que necesita tu menú");
  await page.getByRole("heading", { level: 1, name: "Lo que necesita tu menú" }).click();
  expect(await tabThrough(page, "Tab", 20)).toBeGreaterThanOrEqual(10);
});
