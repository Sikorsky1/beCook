// Step 23 (D1) against the real local Auth: sign-up, wrong password, neutral recovery,
// recovery link → new password, reused link and off-site redirect. Uses the application's
// account flows. The synthetic user is deleted at the end; no email is sent (generateLink).
const assert = require("node:assert/strict");

const siteUrl = "http://127.0.0.1:3000";

function fragmentOf(location) {
  const url = new URL(location);
  return new URLSearchParams(url.hash.replace(/^#/, ""));
}

async function followVerifyLink(actionLink) {
  const response = await fetch(actionLink, { redirect: "manual" });
  return { status: response.status, location: response.headers.get("location") || "" };
}

async function runAuthFlowTests({ check, api, createClient }) {
  const account = require("../src/lib/auth/account.ts");
  const nav = require("../src/lib/navigation.ts");
  const options = { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } };
  const admin = createClient(api.url, api.serviceKey, options);
  const email = `d1-auth-${Date.now()}@example.invalid`;
  const password = "Local-auth-test-only-2026!";
  const newPassword = "Local-auth-new-only-2026!";
  let userId = null;
  try {
    // Local Auth has confirmations off (config.toml), so sign-up starts a session.
    const signupClient = createClient(api.url, api.key, options);
    const signup = await account.signUpWithEmail(signupClient, {
      email, password, confirmation: password,
      redirectTo: nav.authRedirectUrl(siteUrl, "/auth/callback", "/create-menu?week=2026-W41"),
    });
    const { data: created } = await signupClient.auth.getUser();
    userId = created.user?.id ?? null;
    check("D1 auth: sign-up with confirmations off signs in immediately", () => {
      assert.deepEqual(signup, { ok: true, status: "signed_in" });
      assert.ok(userId);
    });
    await signupClient.auth.signOut({ scope: "local" });

    const wrong = await account.signInWithEmail(createClient(api.url, api.key, options), { email, password: "not-the-password" });
    check("D1 auth: wrong password is explained in Spanish without the provider's text", () => {
      assert.equal(wrong.ok, false);
      assert.equal(wrong.code, "invalid_credentials");
      assert.doesNotMatch(wrong.message, /Invalid login credentials/);
    });

    const duplicate = await account.signUpWithEmail(createClient(api.url, api.key, options), {
      email, password, confirmation: password, redirectTo: siteUrl + "/auth/callback",
    });
    check("D1 auth: signing up again with the same email points to login or recovery", () => {
      assert.equal(duplicate.ok, false);
      assert.match(duplicate.message, /Ya hay una cuenta/);
    });

    const unknown = await account.requestPasswordReset(createClient(api.url, api.key, options), {
      email: `nobody-${Date.now()}@example.invalid`,
      redirectTo: nav.authRedirectUrl(siteUrl, "/reset-password", "/week"),
    });
    check("D1 auth: recovery for an unknown email gives the same neutral answer", () => assert.deepEqual(unknown, { ok: true }));

    const redirectTo = nav.authRedirectUrl(siteUrl, "/reset-password", "/shopping/list?week=2026-W41");
    const { data: link, error: linkError } = await admin.auth.admin.generateLink({ type: "recovery", email, options: { redirectTo } });
    const first = linkError ? { status: 0, location: "" } : await followVerifyLink(link.properties.action_link);
    const tokens = first.location ? fragmentOf(first.location) : new URLSearchParams();
    check("D1 auth: the recovery link returns to /reset-password with the destination and a recovery session", () => {
      assert.equal(linkError, null);
      assert.ok([302, 303].includes(first.status));
      assert.ok(first.location.startsWith(redirectTo + "#"), "redirect keeps /reset-password?next=…");
      assert.equal(tokens.get("type"), "recovery");
      assert.ok(tokens.get("access_token") && tokens.get("refresh_token"));
      assert.equal(account.readAuthLinkError(first.location), null);
    });

    const recoveryClient = createClient(api.url, api.key, options);
    await recoveryClient.auth.setSession({ access_token: tokens.get("access_token"), refresh_token: tokens.get("refresh_token") });
    const updated = await account.updatePassword(recoveryClient, { password: newPassword, confirmation: newPassword });
    const oldLogin = await account.signInWithEmail(createClient(api.url, api.key, options), { email, password });
    const newLogin = await account.signInWithEmail(createClient(api.url, api.key, options), { email, password: newPassword });
    check("D1 auth: the new password replaces the old one", () => {
      assert.deepEqual(updated, { ok: true });
      assert.equal(oldLogin.code, "invalid_credentials");
      assert.deepEqual(newLogin, { ok: true });
    });

    const reused = linkError ? { location: "" } : await followVerifyLink(link.properties.action_link);
    const reusedError = account.readAuthLinkError(reused.location);
    check("D1 auth: a used recovery link is refused and explained (no session in the address)", () => {
      assert.ok(reusedError, "error in the redirect");
      assert.match(reusedError.message, /caducado|no es válido/);
      assert.equal(fragmentOf(reused.location).get("access_token"), null);
    });

    const { data: evilLink } = await admin.auth.admin.generateLink({ type: "recovery", email, options: { redirectTo: "https://evil.example/steal" } });
    const evil = evilLink?.properties ? await followVerifyLink(evilLink.properties.action_link) : { location: "" };
    check("D1 auth: a recovery link never redirects to a non-allowed site", () => {
      assert.ok(evil.location);
      assert.ok(!evil.location.startsWith("https://evil.example"));
    });
  } finally {
    if (userId) await admin.auth.admin.deleteUser(userId);
  }
}

module.exports = { runAuthFlowTests };
