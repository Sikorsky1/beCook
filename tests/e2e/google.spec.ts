import { expect, test } from "@playwright/test";
import { createUser, supabaseUrl } from "./helpers";

// «Continuar con Google»: the E2E build has NEXT_PUBLIC_AUTH_PROVIDERS=google. The trip to Google is
// intercepted at Auth's /authorize; the real one is tried by hand in the Preview.
test("el botón de Google lleva a Auth con el proveedor y la vuelta con su destino @320", async ({ page, baseURL }) => {
  let authorize: URL | null = null;
  await page.route(`${supabaseUrl()}/auth/v1/authorize**`, async (route) => {
    authorize = new URL(route.request().url());
    await route.fulfill({ status: 200, contentType: "text/html", body: "<title>Google (simulado)</title>" });
  });

  await page.goto("/login?next=%2Fcreate-menu%3Fweek%3D2026-W42");
  await expect(page.getByRole("heading", { level: 1, name: "Entra en beCook" })).toBeVisible();
  // Above the email form, with the divider; the email form is still there.
  await expect(page.getByText("o con tu email")).toBeVisible();
  await expect(page.getByLabel("Email")).toBeVisible();
  await page.getByRole("button", { name: "Continuar con Google" }).click();

  await expect(page).toHaveTitle("Google (simulado)");
  expect(authorize).not.toBeNull();
  const url = authorize as unknown as URL;
  expect(url.searchParams.get("provider")).toBe("google");
  expect(url.searchParams.get("redirect_to")).toBe(`${baseURL}/auth/callback?next=%2Fcreate-menu%3Fweek%3D2026-W42&via=oauth`);

  // «Atrás» from the provider: the button is usable again (back/forward cache or not).
  await page.goBack();
  await expect(page.getByRole("button", { name: "Continuar con Google" })).toBeEnabled();
  // Nothing overflows sideways on a narrow screen.
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
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

test("vuelta de Google cancelada: mensaje en español y volver a iniciar sesión", async ({ page }) => {
  await page.goto("/auth/callback?next=%2Fshopping%2Flist&via=oauth&error=access_denied&error_description=The+user+denied+access");
  await expect(page.getByRole("heading", { level: 1, name: "No has iniciado sesión" })).toBeVisible();
  await expect(page.getByRole("main").getByRole("alert")).toHaveText("Has cancelado el inicio de sesión. Puedes volver a intentarlo o entrar con tu email.");
  // Resending an email link does not apply to Google.
  await expect(page.getByRole("button", { name: "Enviar otro enlace" })).toHaveCount(0);
  await page.getByRole("link", { name: "Volver a iniciar sesión" }).click();
  await expect(page).toHaveURL(/\/login\?next=%2Fshopping%2Flist$/);
});

test("vuelta de Google con un error del servidor: reintentar, no reenviar un email", async ({ page }) => {
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

test("vuelta de Google con sesión de una cuenta nueva: semana → onboarding", async ({ page }) => {
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
