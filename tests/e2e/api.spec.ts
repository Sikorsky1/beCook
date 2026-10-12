import { expect, test } from "@playwright/test";
import { budgetUrl, createUser } from "./helpers";

// Contratos de las rutas de IA con `request`, sin navegador. Servidor principal: cuota de
// importación de 1 al día (AI_QUOTA_IMPORT_DAILY=1). Servidor «budget»: presupuesto global 0.
const prose = { text: "El lunes comemos lentejas" };
const aiRoutes: Record<string, object> = {
  "generate-menu": { peopleCount: 2 },
  "import-menu": prose,
  "substitute-dish": { day: "Lunes", meal: "lunch", currentDish: "Crema de calabaza", otherDishes: [] },
  "generate-shopping-list": { week: [{ day: "Lunes", date: "12 oct", lunch: "Lentejas", dinner: "LIBRE" }] },
  "dish-card": { isoWeek: "2026-W42", day: "Lunes", meal: "lunch", dish: "Lentejas estofadas", expectedVersion: 1, requestKey: "50000000-0000-4000-8000-000000000001" },
};

test("sin sesión, todas las rutas de IA responden 401", async ({ request }) => {
  for (const [route, body] of Object.entries(aiRoutes)) {
    const response = await request.post(`/api/${route}`, { data: body });
    expect(response.status(), route).toBe(401);
    expect((await response.json()).error, route).toMatch(/Inicia sesión/);
  }
});

test("token falsificado → 401", async ({ request }) => {
  const response = await request.post("/api/import-menu", { data: prose, headers: { authorization: "Bearer header.forged.signature" } });
  expect(response.status()).toBe(401);
});

test("cuota diaria agotada → 429 con Retry-After y motivo", async ({ request }) => {
  const user = await createUser("cuota");
  const headers = { authorization: `Bearer ${user.session.access_token}` };
  const first = await request.post("/api/import-menu", { data: prose, headers });
  expect(first.status()).toBe(200);
  expect((await first.json()).parsedBy).toBe("ai");

  const second = await request.post("/api/import-menu", { data: prose, headers });
  expect(second.status()).toBe(429);
  expect(Number(second.headers()["retry-after"])).toBeGreaterThan(0);
  expect(second.headers()["x-request-id"]).toBeTruthy();
  const body = await second.json();
  expect(body.reason).toBe("daily_quota");
  expect(body.error).toMatch(/límite de 1 importaciones por hoy/);
});

test("presupuesto mensual agotado → 503 antes de llamar a OpenAI", async ({ playwright }) => {
  const user = await createUser("presupuesto");
  const budget = await playwright.request.newContext({ baseURL: budgetUrl() });
  try {
    const response = await budget.post("/api/import-menu", { data: prose, headers: { authorization: `Bearer ${user.session.access_token}` } });
    expect(response.status()).toBe(503);
    expect(Number(response.headers()["retry-after"])).toBeGreaterThan(0);
    const body = await response.json();
    expect(body.reason).toBe("budget_exhausted");
    expect(body.error).toMatch(/no está disponible temporalmente/);
  } finally {
    await budget.dispose();
  }
});
