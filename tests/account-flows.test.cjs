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

  const draft = {mode: "generate", menuText: "", freeTextPrompt: "sin gluten esta semana", peopleCount: 3, menuStyles: ["rapido"]};
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

test("signInWithProvider (Apple only) asks Auth for the provider with the callback and its destination", async () => {
 const calls = [];
 const client = {auth: {signInWithOAuth: async options => { calls.push(options); return {data: {provider: "apple", url: "https://x"}, error: null}; }}};
 const redirectTo = nav.oauthRedirectUrl("https://www.becook.xyz/", "/create-menu?week=2026-W42");
 assert.equal(redirectTo, "https://www.becook.xyz/auth/callback?next=%2Fcreate-menu%3Fweek%3D2026-W42&via=oauth");
 assert.equal(nav.oauthRedirectUrl("https://www.becook.xyz", "https://evil.example/x"), "https://www.becook.xyz/auth/callback?via=oauth", "an off-site next is dropped");
 assert.deepEqual(await account.signInWithProvider(client, "apple", {redirectTo}), {ok: true});
 assert.deepEqual(calls, [{provider: "apple", options: {redirectTo}}]);

 const failing = {auth: {signInWithOAuth: async () => ({data: {}, error: authError("provider_disabled")})}};
 const disabled = await account.signInWithProvider(failing, "apple", {redirectTo});
 assert.equal(disabled.ok, false);
 assert.equal(disabled.message, "Ahora mismo no se puede entrar así. Entra con tu email.");
 const offline = await account.signInWithProvider({auth: {signInWithOAuth: async () => { throw new TypeError("Failed to fetch"); }}}, "apple", {redirectTo});
 assert.equal(offline.code, "offline");
 const unknown = await account.signInWithProvider({auth: {signInWithOAuth: async () => ({data: {}, error: authError("weird")})}}, "apple", {redirectTo});
 assert.equal(unknown.message, "No se pudo conectar. Inténtalo de nuevo o entra con tu email.");
 assert.equal((await account.signInWithProvider(null, "apple", {redirectTo})).code, "unavailable");
});

// Google signs in on our page (Google Identity Services + ID token), never through supabase.co.
const google = require("../src/lib/auth/google.ts");

test("Google needs a real web client ID; anything else hides the button", () => {
 const id = "159899872726-f97ksbdk4qoh63ev05pvmstaggcl3qlb.apps.googleusercontent.com";
 assert.equal(google.googleClientId(id), id);
 assert.equal(google.googleClientId(` ${id}\n`), id);
 for (const value of [undefined, null, "", "GOCSPX-secret", "https://evil.example/x.apps.googleusercontent.com", "x.apps.googleusercontent.com.evil"]) {
  assert.equal(google.googleClientId(value), null, String(value));
 }
 assert.equal(google.googleButtonWidth(0), 200);
 assert.equal(google.googleButtonWidth(343.6), 344);
 assert.equal(google.googleButtonWidth(640), 400, "Google's button is at most 400 px wide");
});

test("each attempt has its own nonce: Google gets the SHA-256, Auth the plain value", async () => {
 const {createHash} = require("node:crypto");
 const first = await google.createNonce();
 const second = await google.createNonce();
 assert.match(first.raw, /^[0-9a-f]{64}$/);
 assert.equal(first.hashed, createHash("sha256").update(first.raw).digest("hex"));
 assert.notEqual(first.raw, second.raw);
});

test("signInWithGoogleIdToken hands the ID token and the plain nonce to Auth; errors in Spanish", async () => {
 const calls = [];
 const session = {data: {session: {access_token: "a"}, user: {id: "u"}}, error: null};
 const client = {auth: {signInWithIdToken: async credentials => { calls.push(credentials); return session; }}};
 assert.deepEqual(await account.signInWithGoogleIdToken(client, {token: "jwt", nonce: "plain"}), {ok: true});
 assert.deepEqual(calls, [{provider: "google", token: "jwt", nonce: "plain"}]);

 const answer = response => ({auth: {signInWithIdToken: async () => response}});
 const disabled = await account.signInWithGoogleIdToken(answer({data: {}, error: authError("provider_disabled")}), {token: "jwt", nonce: "n"});
 assert.equal(disabled.message, "Ahora mismo no se puede entrar así. Entra con tu email.");
 const banned = await account.signInWithGoogleIdToken(answer({data: {}, error: authError("user_banned")}), {token: "jwt", nonce: "n"});
 assert.equal(banned.message, "Esta cuenta no puede entrar ahora mismo.");
 const badNonce = await account.signInWithGoogleIdToken(answer({data: {}, error: authError("bad_jwt", "Passed nonce and nonce in id_token should either both exist or not.")}), {token: "jwt", nonce: "n"});
 assert.equal(badNonce.message, "No se pudo conectar. Inténtalo de nuevo o entra con tu email.");
 assert.doesNotMatch(badNonce.message, /nonce|id_token/i);
 const noSession = await account.signInWithGoogleIdToken(answer({data: {session: null}, error: null}), {token: "jwt", nonce: "n"});
 assert.equal(noSession.ok, false);
 const offline = await account.signInWithGoogleIdToken({auth: {signInWithIdToken: async () => { throw new TypeError("Failed to fetch"); }}}, {token: "jwt", nonce: "n"});
 assert.equal(offline.message, "No hay conexión. Comprueba tu red e inténtalo de nuevo.");
 assert.equal((await account.signInWithGoogleIdToken(client, {token: undefined, nonce: "n"})).ok, false, "no credential, no call");
 assert.equal(calls.length, 1);
 assert.equal((await account.signInWithGoogleIdToken(null, {token: "jwt", nonce: "n"})).code, "unavailable");

 assert.equal(account.googleUnavailableFailure(false).message, "No hay conexión. Comprueba tu red e inténtalo de nuevo.");
 assert.match(account.googleUnavailableFailure(true).message, /^No se pudo cargar el botón de Google\./);
});

test("Google's script loads once; a failure is reported and the next attempt tries again", async () => {
 const appended = [];
 const fakeWindow = (onAppend) => ({
  document: {
   head: {appendChild: script => { appended.push(script); onAppend(script); }},
   createElement: () => ({remove() { this.removed = true; }}),
  },
 });
 const failing = fakeWindow(script => setImmediate(() => script.onerror()));
 await assert.rejects(google.loadGoogleIdentity(failing), /google_unavailable/);
 assert.equal(appended[0].src, "https://accounts.google.com/gsi/client");
 assert.equal(appended[0].removed, true);

 const identity = {initialize() {}, renderButton() {}, cancel() {}};
 const win = fakeWindow(script => setImmediate(() => { win.google = {accounts: {id: identity}}; script.onload(); }));
 const [a, b] = [google.loadGoogleIdentity(win), google.loadGoogleIdentity(win)];
 assert.equal(await a, identity);
 assert.equal(await b, identity);
 assert.equal(appended.length, 2, "one script for the failed try and one for the good one, not one per caller");
 assert.equal(await google.loadGoogleIdentity(win), identity, "already loaded: no new script");
 assert.equal(appended.length, 2);
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
 // Any error after Google (via=oauth) offers to try again, with a message about signing in.
 const serverHref = "https://www.becook.xyz/auth/callback?via=oauth&error=server_error&error_code=unexpected_failure&error_description=Unable+to+exchange+external+code";
 const server = account.readAuthLinkError(serverHref);
 assert.equal(server.message, "No se pudo conectar. Inténtalo de nuevo o entra con tu email.");
 assert.equal(account.isProviderSignInError(server, serverHref), true);
 assert.equal(account.isProviderSignInError(server, "https://www.becook.xyz/auth/callback?error=server_error"), false);
 const apple = account.readAuthLinkError("https://www.becook.xyz/auth/callback?error=user_cancelled_authorize&error_code=user_cancelled_authorize");
 assert.equal(apple.message, cancelled.message);
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
  assert.match(source, /<OAuthButtons next=\{next\}[^>]* onBusyChange=\{setIsSubmitting\} \/>/, page);
  assert.match(source, /<LegalNotice \/>/, page);
 }
 const buttons = read("src/components/session/OAuthButtons.tsx");
 assert.match(buttons, /enabledOAuthProviders\(process\.env\.NEXT_PUBLIC_AUTH_PROVIDERS\)/);
 assert.match(buttons, /googleClientId\(process\.env\.NEXT_PUBLIC_GOOGLE_CLIENT_ID\)/);
 assert.match(buttons, /provider !== "google" \|\| clientId !== null/, "no client ID, no Google button");
 assert.match(buttons, /signInWithGoogleIdToken\(supabase, \{ token: credential, nonce: nonce\.raw \}\)/);
 assert.match(buttons, /nonce: nonce\.hashed/);
 assert.match(buttons, /signInWithProvider\(supabase, "apple"/);
 assert.match(buttons, /if \(!providers\.length\) return null;/);
 // No way back to Google's redirection through supabase.co (it would need supabase.co in Google's
 // authorized domains): signInWithOAuth only exists for Apple.
 assert.doesNotMatch(read("src/lib/auth/account.ts"), /provider: OAuthProvider,\n\s*\{ redirectTo \}/);
 assert.match(read("src/lib/auth/account.ts"), /provider: "apple",\n\s*\{ redirectTo \}/);
 // After Google the destination is next or the week; OnboardingGate takes new accounts to the onboarding.
 assert.match(read("src/app/auth/callback/page.tsx"), /next \?\? defaultAfterLoginPath/);
 assert.match(read("src/app/week/page.tsx"), /<OnboardingGate \/>/);
 assert.match(read("src/components/session/AuthPageShell.tsx"), /<Link href="\/sobre"[^>]*>Qué es beCook<\/Link>/);
 assert.match(read("src/app/sobre/page.tsx"), /export const dynamic = "force-static";/);
 const about = read("docs/legal/sobre.md");
 for (const scope of ["`openid`", "`email`", "`profile`"]) assert.ok(about.includes(scope), scope);
 assert.match(about, /\[Política de privacidad\]\(\/privacidad\)/);
 assert.match(about, /\[Condiciones de uso\]\(\/condiciones\)/);
 assert.match(about, /sergio\.ortiz\.torrijos@gmail\.com/);
 for (const page of ["privacidad", "condiciones"]) assert.match(read(`src/app/${page}/page.tsx`), /\{ href: "\/sobre", label: "Qué es beCook" \}/, page);
 for (const [page, file] of [["privacidad", "privacidad.md"], ["condiciones", "condiciones.md"], ["sobre", "sobre.md"]]) {
  assert.match(read(`src/app/${page}/page.tsx`), new RegExp(`file="${file}"`), page);
  assert.doesNotMatch(read(`docs/legal/${file}`), /\[(REVISAR|DECIDIR)|Borrador|Pendiente antes de publicar|\[fecha|\[email/i, file);
 }
 assert.match(read("docs/legal/privacidad.md"), /Si entras con Google, Google nos facilita tu email, tu nombre, la dirección de tu foto de perfil y un identificador de tu cuenta de Google, y nada más\./);
});

test("legal texts: headings, tables, lists, links and emails; no line can stop the parser", () => {
 const {parseLegalMarkdown, parseInline} = require("../src/lib/legal/parse.ts");
 const blocks = parseLegalMarkdown("# T\n\nUno\ndos\n\n### Sub\n#x raro\n\n| A | B |\n| --- | --- |\n| 1 | 2 |\n\n- a\n  sigue\n- b\n");
 assert.deepEqual(blocks, [
  {kind: "h1", text: "T"},
  {kind: "p", text: "Uno dos"},
  {kind: "h3", text: "Sub"},
  {kind: "p", text: "#x raro"},
  {kind: "table", head: ["A", "B"], rows: [["1", "2"]]},
  {kind: "ul", items: ["a sigue", "b"]},
 ]);
 assert.deepEqual(parseInline("**x@y.es** y [p](/privacidad), [e](//evil.example), [a](https://www.aepd.es)"), [
  {kind: "strong", text: "x@y.es"},
  {kind: "text", text: " y "},
  {kind: "link", text: "p", href: "/privacidad"},
  {kind: "text", text: ", [e](//evil.example), "},
  {kind: "link", text: "a", href: "https://www.aepd.es"},
 ]);
 assert.deepEqual(parseInline("javascript [j](javascript:alert(1))").map(part => part.kind), ["text"]);
 for (const file of ["privacidad.md", "condiciones.md"]) {
  const parsed = parseLegalMarkdown(read(`docs/legal/${file}`));
  assert.equal(parsed.filter(block => block.kind === "h1").length, 1, file);
  for (const table of parsed.filter(block => block.kind === "table")) {
   for (const row of table.rows) assert.equal(row.length, table.head.length, file);
  }
 }
});
