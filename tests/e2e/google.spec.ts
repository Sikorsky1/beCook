import { createHash } from "node:crypto";

import { expect, test, type Page } from "@playwright/test";
import { createUser, supabaseUrl } from "./helpers";

// «Continuar con Google»: the E2E build has NEXT_PUBLIC_AUTH_PROVIDERS=google and a made-up
// NEXT_PUBLIC_GOOGLE_CLIENT_ID. Google's script (Google Identity Services) is replaced by a
// stand-in whose button hands back a fake ID token, and Auth's id_token grant is intercepted: the
// local Auth cannot check a Google signature. The real Google is tried by hand in the Preview.
const fakeGoogleIdentity = `
  window.__gis = { configs: [], buttons: [] };
  window.google = { accounts: { id: {
    initialize(config) { window.__gis.configs.push(config); },
    renderButton(parent, options) {
      window.__gis.buttons.push(options);
      const button = document.createElement("button");
      button.type = "button";
      button.textContent = "Continuar con Google";
      button.onclick = () => window.__gis.configs.at(-1).callback({ credential: "fake-google-id-token", select_by: "btn" });
      parent.appendChild(button);
    },
    cancel() {},
  } } };
`;

async function fakeGoogle(page: Page) {
  await page.route("https://accounts.google.com/gsi/client", (route) =>
    route.fulfill({ status: 200, contentType: "text/javascript", body: fakeGoogleIdentity }),
  );
}

type GisState = { configs: { client_id: string; nonce: string; ux_mode: string; context: string }[]; buttons: { locale: string; width: number }[] };
const gisState = (page: Page) => page.evaluate(() => (window as unknown as { __gis: GisState }).__gis);
const sha256 = (value: string) => createHash("sha256").update(value).digest("hex");

test.beforeEach(async ({ page }) => {
  await fakeGoogle(page);
});

test("el botón de Google entra en la página, sin pasar por supabase.co, y vuelve a su destino @320", async ({ page }) => {
  const user = await createUser("google-gis");
  const grants: { url: URL; body: { provider: string; id_token: string; nonce: string } }[] = [];
  await page.route(`${supabaseUrl()}/auth/v1/token**`, async (route) => {
    const url = new URL(route.request().url());
    if (url.searchParams.get("grant_type") !== "id_token") return route.fallback();
    grants.push({ url, body: route.request().postDataJSON() });
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(user.session) });
  });
  let authorize = false;
  await page.route(`${supabaseUrl()}/auth/v1/authorize**`, (route) => {
    authorize = true;
    return route.abort();
  });

  await page.goto("/login?next=%2Fshopping%2Flist");
  await expect(page.getByRole("heading", { level: 1, name: "Entra en beCook" })).toBeVisible();
  // Above the email form, with the divider; the email form is still there.
  await expect(page.getByText("o con tu email")).toBeVisible();
  await expect(page.getByLabel("Email")).toBeVisible();
  await expect(page.getByRole("link", { name: "Qué es beCook" })).toBeVisible();
  await page.getByRole("button", { name: "Continuar con Google" }).click();

  await expect(page).toHaveURL(/\/shopping\/list$/);
  expect(grants).toHaveLength(1);
  expect(grants[0].body.provider).toBe("google");
  expect(grants[0].body.id_token).toBe("fake-google-id-token");
  expect(grants[0].body.nonce).toMatch(/^[0-9a-f]{64}$/);
  expect(authorize, "no redirection through Auth's /authorize").toBe(false);
  // The session is stored like any other sign-in.
  const stored = await page.evaluate(() =>
    Object.entries(localStorage).find(([key]) => key.startsWith("sb-") && key.endsWith("-auth-token"))?.[1] ?? "",
  );
  expect(stored).toContain(user.session.access_token);
});

test("Google recibe el hash del nonce y Auth el nonce en claro; un error se explica y se reintenta con otro", async ({ page }) => {
  const nonces: string[] = [];
  await page.route(`${supabaseUrl()}/auth/v1/token**`, async (route) => {
    if (new URL(route.request().url()).searchParams.get("grant_type") !== "id_token") return route.fallback();
    nonces.push(route.request().postDataJSON().nonce);
    await route.fulfill({
      status: 400,
      contentType: "application/json",
      body: JSON.stringify({ code: 400, error_code: "provider_disabled", msg: "Provider (issuer \"https://accounts.google.com\") is not enabled" }),
    });
  });

  await page.goto("/signup");
  await expect(page.getByRole("heading", { level: 1, name: "Crea tu cuenta" })).toBeVisible();
  await page.getByRole("button", { name: "Continuar con Google" }).click();
  await expect(page.getByRole("main").getByRole("alert")).toHaveText("Ahora mismo no se puede entrar así. Entra con tu email.");
  await expect(page).toHaveURL(/\/signup$/);

  // A new button with a new nonce; each Google nonce is the SHA-256 of what Auth received.
  await expect(page.getByRole("button", { name: "Continuar con Google" })).toBeEnabled();
  let gis = await gisState(page);
  expect(gis.configs).toHaveLength(2);
  expect(gis.configs[0]).toMatchObject({ client_id: "e2e-local.apps.googleusercontent.com", ux_mode: "popup", context: "signup" });
  expect(gis.buttons[0].locale).toBe("es");
  expect(gis.buttons[0].width).toBeGreaterThanOrEqual(200);
  expect(gis.buttons[0].width).toBeLessThanOrEqual(400);
  expect(gis.configs[0].nonce).toBe(sha256(nonces[0]));

  await page.getByRole("button", { name: "Continuar con Google" }).click();
  await expect(page.getByRole("main").getByRole("alert")).toBeVisible();
  gis = await gisState(page);
  expect(nonces).toHaveLength(2);
  expect(nonces[1]).not.toBe(nonces[0]);
  expect(gis.configs[1].nonce).toBe(sha256(nonces[1]));
});

test("si el script de Google no carga, se dice en español y se puede reintentar", async ({ page }) => {
  await page.unroute("https://accounts.google.com/gsi/client");
  await page.route("https://accounts.google.com/gsi/client", (route) => route.abort("blockedbyclient"));
  await page.goto("/login");
  await expect(page.getByRole("main").getByRole("alert")).toHaveText(
    "No se pudo cargar el botón de Google. Comprueba tu conexión (o si un bloqueador lo impide) o entra con tu email.",
  );
  // The email form still works; retrying loads Google's button.
  await expect(page.getByLabel("Email")).toBeEnabled();
  await page.unroute("https://accounts.google.com/gsi/client");
  await fakeGoogle(page);
  await page.getByRole("button", { name: "Continuar con Google" }).click();
  await expect(page.getByRole("main").getByRole("alert")).toHaveCount(0);
  await expect(page.getByTestId("google-button").getByRole("button", { name: "Continuar con Google" })).toBeVisible();
});

test("la página pública «Qué es beCook» explica el acceso con Google y enlaza la política @320", async ({ page }) => {
  await page.goto("/sobre");
  await expect(page.getByRole("heading", { level: 1, name: "Qué es beCook" })).toBeVisible();
  await expect(page.getByRole("heading", { level: 2, name: "Entrar con Google" })).toBeVisible();
  for (const scope of ["openid", "email", "profile"]) await expect(page.getByRole("cell", { name: scope, exact: true })).toBeVisible();
  await expect(page.getByRole("link", { name: "sergio.ortiz.torrijos@gmail.com" })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.getByRole("link", { name: "Política de privacidad" }).first().click();
  await expect(page).toHaveURL(/\/privacidad$/);
  await page.getByRole("link", { name: "Qué es beCook" }).click();
  await expect(page).toHaveURL(/\/sobre$/);
});

test("alta: el mismo botón y los enlaces a la política y las condiciones @320", async ({ page }) => {
  await page.goto("/signup");
  await expect(page.getByRole("heading", { level: 1, name: "Crea tu cuenta" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Continuar con Google" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Continuar con Apple" })).toHaveCount(0);

  await page.getByRole("link", { name: "política de privacidad" }).click();
  await expect(page).toHaveURL(/\/privacidad$/);
  await expect(page.getByRole("heading", { level: 1, name: "Política de privacidad de beCook" })).toBeVisible();
  await expect(page.getByText("Si entras con Google, Google nos facilita tu email, tu nombre, la dirección de tu foto de perfil y un identificador de tu cuenta de Google, y nada más. No usamos la foto.")).toBeVisible();
  await page.getByRole("link", { name: "Condiciones de uso" }).click();
  await expect(page).toHaveURL(/\/condiciones$/);
  await expect(page.getByRole("heading", { level: 1, name: "Condiciones de uso de beCook" })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});

test("vuelta de un proveedor por redirección (Apple) cancelada: mensaje en español y volver a iniciar sesión", async ({ page }) => {
  await page.goto("/auth/callback?next=%2Fshopping%2Flist&via=oauth&error=access_denied&error_description=The+user+denied+access");
  await expect(page.getByRole("heading", { level: 1, name: "No has iniciado sesión" })).toBeVisible();
  await expect(page.getByRole("main").getByRole("alert")).toHaveText("Has cancelado el inicio de sesión. Puedes volver a intentarlo o entrar con tu email.");
  // Resending an email link does not apply to Google.
  await expect(page.getByRole("button", { name: "Enviar otro enlace" })).toHaveCount(0);
  await page.getByRole("link", { name: "Volver a iniciar sesión" }).click();
  await expect(page).toHaveURL(/\/login\?next=%2Fshopping%2Flist$/);
});

test("vuelta de un proveedor por redirección con un error del servidor: reintentar, no reenviar un email", async ({ page }) => {
  await page.goto("/auth/callback?next=%2Fweek&via=oauth#error=server_error&error_code=unexpected_failure&error_description=Unable+to+exchange+external+code");
  await expect(page.getByRole("main").getByRole("alert")).toHaveText("No se pudo conectar. Inténtalo de nuevo o entra con tu email.");
  await expect(page.getByRole("link", { name: "Volver a iniciar sesión" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Enviar otro enlace" })).toHaveCount(0);
});

test("un enlace de email caducado sigue ofreciendo otro enlace", async ({ page }) => {
  await page.goto("/auth/callback#error=access_denied&error_code=otp_expired&error_description=Email+link+is+invalid+or+has+expired");
  await expect(page.getByRole("heading", { level: 1, name: "No hemos podido activar la cuenta" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Enviar otro enlace" })).toBeVisible();
});

test("vuelta de un proveedor con sesión de una cuenta nueva: semana → onboarding", async ({ page }) => {
  // The session Auth hands back in the fragment (implicit flow), for an account without profile.
  const user = await createUser("google");
  const { access_token, refresh_token } = user.session;
  await page.goto(`/auth/callback#access_token=${access_token}&refresh_token=${refresh_token}&expires_in=3600&token_type=bearer`);
  await expect(page).toHaveURL(/\/onboarding/);
  await expect(page.getByRole("heading", { level: 1, name: "Bienvenido a beCook" })).toBeVisible();

  // «Tus datos» says how the account signs in.
  await page.goto("/profile/data");
  await expect(page.getByText("Entras con:")).toContainText("Email y contraseña");
});
