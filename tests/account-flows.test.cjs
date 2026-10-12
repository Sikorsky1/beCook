const {test} = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const {createDevice, useDevice} = require("./helpers/fake-browser.cjs");
const nav = require("../src/lib/navigation.ts");
const account = require("../src/lib/auth/account.ts");
const loginReturn = require("../src/lib/session/login-return.ts");
const {consumeCreateMenuDraft, saveCreateMenuDraft} = require("../src/lib/createMenuDraft.ts");

// Step 23 (D1): sign-up, sign-in, confirmation, password recovery and return to the destination.
// Synthetic auth client; no network. The real local Auth is exercised in scripts/auth-db-tests.cjs.
const root = path.resolve(__dirname, "..");
const read = file => fs.readFileSync(path.join(root, file), "utf8");

// Records every call; each method answers with the next queued response (or a default).
function createFakeAuth(responses = {}) {
 const calls = [];
 const answer = (name, fallback) => async (...args) => {
  calls.push({name, args});
  const queued = responses[name];
  if (typeof queued === "function") return queued(...args);
  if (queued instanceof Error) throw queued;
  return queued ?? fallback;
 };
 return {
  calls,
  auth: {
   signInWithPassword: answer("signInWithPassword", {data: {session: {user: {id: "u"}}, user: {id: "u"}}, error: null}),
   signUp: answer("signUp", {data: {session: null, user: {id: "u", identities: []}}, error: null}),
   resend: answer("resend", {data: {}, error: null}),
   resetPasswordForEmail: answer("resetPasswordForEmail", {data: {}, error: null}),
   updateUser: answer("updateUser", {data: {user: {id: "u"}}, error: null}),
  },
 };
}
const authError = (code, message = "Provider says something technical", status = 400) => ({code, message, status, name: "AuthApiError"});

test("after login the default destination is the week, not Perfil (old behaviour: always /profile)", () => {
 assert.equal(nav.safeNextPath(null), "/week");
 assert.equal(nav.safeNextPath(""), "/week");
 assert.equal(nav.loginHrefFor("/week"), "/login?next=%2Fweek");
 // D2: a new account without a destination starts the onboarding.
 assert.equal(nav.defaultAfterSignupPath, "/onboarding");
});

test("the requested destination survives, with its week and hash", () => {
 assert.equal(nav.safeNextPath("/create-menu?week=2026-W41"), "/create-menu?week=2026-W41");
 assert.equal(nav.safeNextPath("/shopping/list?week=2026-W53#x"), "/shopping/list?week=2026-W53#x");
 assert.equal(nav.loginHrefFor("/create-menu?week=2026-W41"), "/login?next=%2Fcreate-menu%3Fweek%3D2026-W41");
});

test("account screens are never a destination, so returning cannot loop (old: /login was accepted)", () => {
 for (const looping of [
  "/login", "/login?next=%2Flogin", "/login/", "/LOGIN", "/%6Cogin", "/signup?next=/week",
  "/forgot-password", "/reset-password", "/auth/callback?next=/week", "/auth",
 ]) {
  assert.equal(nav.safeNextPath(looping), "/week", looping);
  assert.equal(nav.isAuthPath(new URL(looping, "http://x").pathname), true, looping);
 }
 assert.equal(nav.isAuthPath("/authors"), false);
 assert.equal(nav.isAuthPath("/week"), false);
});

test("off-site destinations are rejected", () => {
 for (const evil of ["//evil.example", "/\\evil.example", "https://evil.example", "javascript:alert(1)", "week"]) {
  assert.equal(nav.safeNextPath(evil), "/week", evil);
 }
});

test("links between account screens keep the destination; email links are absolute", () => {
 assert.equal(nav.authHref("/signup", "/create-menu?week=2026-W41"), "/signup?next=%2Fcreate-menu%3Fweek%3D2026-W41");
 assert.equal(nav.authHref("/forgot-password", null), "/forgot-password");
 assert.equal(nav.authHref("/login", "/login"), "/login");
 assert.equal(nav.authHref("/login", "https://evil.example"), "/login");
 assert.equal(nav.authRedirectUrl("https://becook.xyz/", "/reset-password", "/week"), "https://becook.xyz/reset-password?next=%2Fweek");
 assert.equal(nav.authRedirectUrl("http://127.0.0.1:3001", "/auth/callback", null), "http://127.0.0.1:3001/auth/callback");
});

test("errors are explained in plain Spanish, never with the provider's wording", () => {
 const cases = {
  invalid_credentials: /email o la contraseña no son correctos/,
  email_not_confirmed: /confirmado tu email/,
  user_already_exists: /Ya hay una cuenta/,
  weak_password: /más segura/,
  same_password: /distinta de la anterior/,
  over_email_send_rate_limit: /Espera unos minutos/,
  otp_expired: /caducado o ya se ha usado/,
 };
 for (const [code, expected] of Object.entries(cases)) {
  const result = account.describeAccountError(authError(code), "signIn");
  assert.match(result.message, expected, code);
  assert.equal(result.code, code);
 }
 const unknown = account.describeAccountError(authError("brand_new_code", "Database error querying schema"), "signUp");
 assert.equal(unknown.message, "No se pudo crear la cuenta. Inténtalo de nuevo.");
 assert.match(account.describeAccountError({name: "AuthRetryableFetchError", status: 0, message: "Failed to fetch"}, "signIn").message, /No hay conexión/);
 assert.match(account.describeAccountError({status: 429, message: "Too many"}, "recover").message, /Demasiados intentos/);
 assert.doesNotMatch(account.accountUnavailableMessage, /Supabase|NEXT_PUBLIC|env/);
});

test("sign-in: validated before calling Auth; result and errors mapped", async () => {
 const ok = createFakeAuth();
 assert.deepEqual(await account.signInWithEmail(ok, {email: "  ana@example.com ", password: "x"}), {ok: true});
 assert.deepEqual(ok.calls[0].args[0], {email: "ana@example.com", password: "x"});

 const empty = createFakeAuth();
 assert.equal((await account.signInWithEmail(empty, {email: "ana@example.com", password: ""})).code, "invalid_input");
 assert.equal((await account.signInWithEmail(empty, {email: "ana", password: "x"})).code, "invalid_input");
 assert.equal(empty.calls.length, 0);

 const wrong = createFakeAuth({signInWithPassword: {data: {session: null, user: null}, error: authError("invalid_credentials", "Invalid login credentials")}});
 const result = await account.signInWithEmail(wrong, {email: "ana@example.com", password: "nope"});
 assert.equal(result.ok, false);
 assert.doesNotMatch(result.message, /Invalid login credentials/);

 const unconfirmed = createFakeAuth({signInWithPassword: {data: {session: null, user: null}, error: authError("email_not_confirmed")}});
 assert.equal((await account.signInWithEmail(unconfirmed, {email: "ana@example.com", password: "x"})).code, "email_not_confirmed");

 const offline = createFakeAuth({signInWithPassword: Object.assign(new TypeError("Failed to fetch"))});
 assert.equal((await account.signInWithEmail(offline, {email: "ana@example.com", password: "x"})).code, "offline");

 assert.equal((await account.signInWithEmail(null, {email: "ana@example.com", password: "x"})).code, "unavailable");
});

test("sign-up: immediate session, or confirmation email that does not reveal existing accounts", async () => {
 const redirectTo = "https://becook.xyz/auth/callback?next=%2Fcreate-menu";
 const immediate = createFakeAuth({signUp: {data: {session: {user: {id: "u"}}, user: {id: "u"}}, error: null}});
 assert.deepEqual(
  await account.signUpWithEmail(immediate, {email: "ana@example.com", password: "12345678", confirmation: "12345678", redirectTo}),
  {ok: true, status: "signed_in"},
 );
 assert.equal(immediate.calls[0].args[0].options.emailRedirectTo, redirectTo);

 // New address and an already registered one (Auth answers an obfuscated user): same screen.
 for (const user of [{id: "u", identities: [{id: "i"}]}, {id: "u", identities: []}]) {
  const confirm = createFakeAuth({signUp: {data: {session: null, user}, error: null}});
  assert.deepEqual(
   await account.signUpWithEmail(confirm, {email: " ana@example.com", password: "12345678", confirmation: "12345678", redirectTo}),
   {ok: true, status: "confirm_email", email: "ana@example.com"},
  );
 }

 const fake = createFakeAuth();
 assert.match((await account.signUpWithEmail(fake, {email: "ana@example.com", password: "1234567", confirmation: "1234567", redirectTo})).message, /al menos 8/);
 assert.match((await account.signUpWithEmail(fake, {email: "ana@example.com", password: "12345678", confirmation: "12345679", redirectTo})).message, /no coinciden/);
 assert.equal(fake.calls.length, 0);

 const exists = createFakeAuth({signUp: {data: {session: null, user: null}, error: authError("user_already_exists", "User already registered", 422)}});
 assert.match((await account.signUpWithEmail(exists, {email: "ana@example.com", password: "12345678", confirmation: "12345678", redirectTo})).message, /recupera tu contraseña/);
});

test("password recovery: neutral answer, link back to /reset-password with the destination", async () => {
 const redirectTo = nav.authRedirectUrl("https://becook.xyz", "/reset-password", "/shopping/list?week=2026-W41");
 const fake = createFakeAuth();
 assert.deepEqual(await account.requestPasswordReset(fake, {email: "ana@example.com", redirectTo}), {ok: true});
 assert.deepEqual(fake.calls[0].args, ["ana@example.com", {redirectTo: "https://becook.xyz/reset-password?next=%2Fshopping%2Flist%3Fweek%3D2026-W41"}]);

 const unknown = createFakeAuth({resetPasswordForEmail: {data: null, error: authError("user_not_found", "User not found", 404)}});
 assert.deepEqual(await account.requestPasswordReset(unknown, {email: "nadie@example.com", redirectTo}), {ok: true});

 const limited = createFakeAuth({resetPasswordForEmail: {data: null, error: authError("over_email_send_rate_limit", "email rate limit exceeded", 429)}});
 assert.match((await account.requestPasswordReset(limited, {email: "ana@example.com", redirectTo})).message, /Espera unos minutos/);

 const update = createFakeAuth({updateUser: {data: null, error: authError("same_password")}});
 assert.match((await account.updatePassword(update, {password: "12345678", confirmation: "12345678"})).message, /distinta/);
 const updated = createFakeAuth();
 assert.deepEqual(await account.updatePassword(updated, {password: "nueva-clave-1", confirmation: "nueva-clave-1"}), {ok: true});
 assert.deepEqual(updated.calls[0].args[0], {password: "nueva-clave-1"});
});

test("a failed email link is recognised from the query or the fragment; a valid one is not an error", () => {
 const expired = account.readAuthLinkError("https://becook.xyz/reset-password?next=%2Fweek#error=access_denied&error_code=otp_expired&error_description=Email+link+is+invalid+or+has+expired");
 assert.equal(expired.code, "otp_expired");
 assert.match(expired.message, /caducado/);
 assert.equal(account.readAuthLinkError("https://becook.xyz/auth/callback?error=server_error&error_description=x").code, "server_error");
 assert.equal(account.readAuthLinkError("https://becook.xyz/reset-password#access_token=a&refresh_token=b&expires_in=3600&token_type=bearer&type=recovery"), null);
 assert.equal(account.readAuthLinkError("https://becook.xyz/reset-password?next=%2Fweek"), null);
});

test("expired session: login returns to the same page and week, and the create-menu draft survives the trip", () => {
 const restore = useDevice(createDevice());
 try {
  const location = {pathname: "/create-menu", search: "?week=2026-W41"};
  assert.equal(loginReturn.loginHrefForCurrentPage(location), "/login?next=%2Fcreate-menu%3Fweek%3D2026-W41");
  // From an account screen there is nothing to return to: no /login?next=/login chain.
  assert.equal(loginReturn.currentReturnPath({pathname: "/login", search: "?next=%2Fweek"}), null);
  assert.equal(loginReturn.loginHrefForCurrentPage({pathname: "/login", search: ""}), "/login?next=%2Fweek");

  const draft = {mode: "generate", menuText: "", freeTextPrompt: "sin gluten esta semana", peopleCount: 3, menuStyles: ["rapido"], elaborationLevel: 2};
  const calls = [];
  const unregisterBroken = loginReturn.registerBeforeLoginSaver(() => { calls.push("broken"); throw new Error("boom"); });
  const unregister = loginReturn.registerBeforeLoginSaver(() => { calls.push("draft"); saveCreateMenuDraft(draft); });
  loginReturn.runBeforeLoginSavers();
  assert.deepEqual(calls, ["broken", "draft"]);
  assert.deepEqual(consumeCreateMenuDraft(), draft);
  unregister();
  unregisterBroken();
  loginReturn.runBeforeLoginSavers();
  assert.equal(calls.length, 2);
 } finally {
  restore();
 }
});

test("screens exist for every step and speak about the user's plans, not the provider", () => {
 for (const page of ["login", "signup", "forgot-password", "reset-password", "auth/callback"]) {
  assert.ok(fs.existsSync(path.join(root, "src/app", page, "page.tsx")), page);
 }
 for (const page of ["login", "signup", "forgot-password", "reset-password", "auth/callback"]) {
  assert.doesNotMatch(read(`src/app/${page}/page.tsx`), /Supabase|supabase\.(auth|from)/, page);
 }
 assert.match(read("src/app/login/page.tsx"), /authHref\("\/forgot-password", next\)/);
 assert.match(read("src/app/signup/page.tsx"), /"\/auth\/callback", next/);
 assert.match(read("src/app/forgot-password/page.tsx"), /"\/reset-password", next/);
});

// Sign-in with Google (and Apple later): NEXT_PUBLIC_AUTH_PROVIDERS switch, redirect and errors.
test("providers come only from NEXT_PUBLIC_AUTH_PROVIDERS; without it there are no buttons", () => {
 assert.deepEqual(account.enabledOAuthProviders(undefined), []);
 assert.deepEqual(account.enabledOAuthProviders(""), []);
 assert.deepEqual(account.enabledOAuthProviders("google"), ["google"]);
 assert.deepEqual(account.enabledOAuthProviders(" Google , "), ["google"]);
 assert.deepEqual(account.enabledOAuthProviders("apple,google,google"), ["google", "apple"], "display order, no duplicates");
 assert.deepEqual(account.enabledOAuthProviders("github,facebook"), [], "unknown providers are ignored");
});

test("signInWithProvider asks Auth for the provider with the callback and its destination", async () => {
 const calls = [];
 const client = {auth: {signInWithOAuth: async options => { calls.push(options); return {data: {provider: "google", url: "https://x"}, error: null}; }}};
 const redirectTo = nav.authRedirectUrl("https://www.becook.xyz", "/auth/callback", "/create-menu?week=2026-W42");
 assert.deepEqual(await account.signInWithProvider(client, "google", {redirectTo}), {ok: true});
 assert.deepEqual(calls, [{provider: "google", options: {redirectTo: "https://www.becook.xyz/auth/callback?next=%2Fcreate-menu%3Fweek%3D2026-W42"}}]);

 const failing = {auth: {signInWithOAuth: async () => ({data: {}, error: authError("provider_disabled")})}};
 const disabled = await account.signInWithProvider(failing, "google", {redirectTo});
 assert.equal(disabled.ok, false);
 assert.equal(disabled.message, "Ahora mismo no se puede entrar así. Entra con tu email.");
 const offline = await account.signInWithProvider({auth: {signInWithOAuth: async () => { throw new TypeError("Failed to fetch"); }}}, "google", {redirectTo});
 assert.equal(offline.code, "offline");
 const unknown = await account.signInWithProvider({auth: {signInWithOAuth: async () => ({data: {}, error: authError("weird")})}}, "google", {redirectTo});
 assert.equal(unknown.message, "No se pudo conectar. Inténtalo de nuevo o entra con tu email.");
 assert.equal((await account.signInWithProvider(null, "google", {redirectTo})).code, "unavailable");
});

test("the return from Google with an error is explained in Spanish and offers to try again, not an email", () => {
 const cancelled = account.readAuthLinkError("https://www.becook.xyz/auth/callback?next=%2Fweek&error=access_denied&error_description=The+user+denied");
 assert.equal(cancelled.message, "Has cancelado el inicio de sesión. Puedes volver a intentarlo o entrar con tu email.");
 assert.equal(account.isProviderSignInError(cancelled), true);
 const inFragment = account.readAuthLinkError("https://www.becook.xyz/auth/callback#error=access_denied&error_code=access_denied&error_description=x");
 assert.equal(account.isProviderSignInError(inFragment), true);
 const state = account.readAuthLinkError("https://www.becook.xyz/auth/callback?error=invalid_request&error_code=bad_oauth_state&error_description=x");
 assert.match(state.message, /Vuelve a intentarlo desde el principio/);
 assert.equal(account.isProviderSignInError(state), true);
 // An expired email link keeps the «send another link» path.
 const expired = account.readAuthLinkError("https://www.becook.xyz/auth/callback#error=access_denied&error_code=otp_expired&error_description=x");
 assert.equal(account.isProviderSignInError(expired), false);
 assert.equal(account.isProviderSignInError(null), false);
 for (const failure of [cancelled, state]) assert.doesNotMatch(failure.message, /denied|state|Supabase/i);
});

test("«Tus datos» names how the account signs in", () => {
 assert.deepEqual(account.signInMethodLabels([{provider: "email"}]), ["Email y contraseña"]);
 assert.deepEqual(account.signInMethodLabels([{provider: "google"}, {provider: "email"}]), ["Email y contraseña", "Google"]);
 assert.deepEqual(account.signInMethodLabels([{provider: "apple"}, {provider: "google"}]), ["Google", "Apple"]);
 assert.deepEqual(account.signInMethodLabels(undefined), []);
});

test("Google buttons, callback and legal pages are wired into the account screens", () => {
 for (const page of ["login", "signup"]) {
  const source = read(`src/app/${page}/page.tsx`);
  assert.match(source, /<OAuthButtons next=\{next\} \/>/, page);
  assert.match(source, /<LegalNotice \/>/, page);
 }
 const buttons = read("src/components/session/OAuthButtons.tsx");
 assert.match(buttons, /enabledOAuthProviders\(process\.env\.NEXT_PUBLIC_AUTH_PROVIDERS\)/);
 assert.match(buttons, /"\/auth\/callback", next/);
 assert.match(buttons, /if \(!providers\.length\) return null;/);
 // After Google the destination is next or the week; OnboardingGate takes new accounts to the onboarding.
 assert.match(read("src/app/auth/callback/page.tsx"), /next \?\? defaultAfterLoginPath/);
 assert.match(read("src/app/week/page.tsx"), /<OnboardingGate \/>/);
 for (const [page, file] of [["privacidad", "privacidad.md"], ["condiciones", "condiciones.md"]]) {
  assert.match(read(`src/app/${page}/page.tsx`), new RegExp(`file="${file}"`), page);
  assert.doesNotMatch(read(`docs/legal/${file}`), /\[(REVISAR|DECIDIR)|Borrador|Pendiente antes de publicar|\[fecha|\[email/i, file);
 }
 assert.match(read("docs/legal/privacidad.md"), /Si entras con Google, Google nos facilita tu email y tu nombre, y nada más\./);
});
