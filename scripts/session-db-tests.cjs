// B1 against the real local Supabase (Auth + RLS): A signs in, signs out, B signs in on one device.
// Read-only: loads fixture data through the application repositories; nothing is written remotely.
const assert = require("node:assert/strict");
const path = require("node:path");

async function runSessionTests({ check, id, supabase }) {
  const { createDevice, useDevice } = require(path.join(__dirname, "../tests/helpers/fake-browser.cjs"));
  const { createIdentityStore } = require("../src/lib/session/identity.ts");
  const repos = require("../src/lib/data/repositories.ts");
  const pantry = require("../src/lib/data/pantry.ts");
  const restoreDevice = useDevice(createDevice());
  const store = createIdentityStore(supabase);
  try {
    await supabase.auth.signOut({ scope: "local" });
    await supabase.auth.signInWithPassword({ email: "fixture-1@example.invalid", password: "Local-fixture-only-2026!" });
    await store.start();
    const asA = store.getSnapshot();
    const profileA = await repos.loadProfile(asA);
    const pantryA = await pantry.loadPantry(asA);
    check("B1 session: A resolves to its own scope and loads its own profile and pantry", () => {
      assert.equal(asA.userId, id("0", 1));
      assert.equal(profileA.source, "remote");
      assert.equal(profileA.data.id, id("1", 1));
      assert.equal(pantryA.data.length, 2);
      assert.ok(window.localStorage.keys().every(key => key.startsWith("becook:u_" + id("0", 1) + ":")));
    });

    await store.signOut();
    check("B1 session: explicit sign-out leaves no data of A on the device", () => {
      assert.equal(store.getSnapshot().scope, "guest");
      assert.equal(window.localStorage.keys().filter(key => key.includes(id("0", 1))).length, 0);
    });

    await supabase.auth.signInWithPassword({ email: "fixture-2@example.invalid", password: "Local-fixture-only-2026!" });
    const asB = store.getSnapshot();
    check("B1 session: B is picked up from onAuthStateChange with a new scope", () => {
      assert.equal(asB.userId, id("0", 2));
      assert.equal(asB.scope, "u_" + id("0", 2));
    });
    const cachedForB = repos.readCachedProfile(asB);
    const profileB = await repos.loadProfile(asB);
    const pantryB = await pantry.loadPantry(asB);
    check("B1 session: B sees only B's profile and pantry, never A's", () => {
      assert.equal(cachedForB, null);
      assert.equal(profileB.data.id, id("1", 2));
      assert.equal(pantryB.data.length, 2);
      assert.ok(!JSON.stringify(window.localStorage.map).includes(id("1", 1)));
    });
  } finally {
    store.stop();
    await supabase.auth.signOut({ scope: "local" });
    restoreDevice();
  }
}

module.exports = { runSessionTests };
