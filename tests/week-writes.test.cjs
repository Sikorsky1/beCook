const {test, beforeEach, afterEach} = require("node:test");
const assert = require("node:assert/strict");

// B4: client side of transactional week writes. The real repositories and Supabase adapters run
// against a synthetic Supabase (rpc + the two reads of a week); no network.
process.env.NEXT_PUBLIC_SUPABASE_URL = "http://supabase.test";
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "synthetic-anon-key";
const {createDevice, useDevice} = require("./helpers/fake-browser.cjs");
const {supabase} = require("../src/lib/supabase/client.ts");
const {parseWeekWriteResult, weekToApplyWeekDays} = require("../src/lib/supabase/weeks.ts");
const repos = require("../src/lib/data/repositories.ts");
const {RemoteConflictError} = require("../src/lib/data/sync.ts");
const {readEnvelope} = require("../src/lib/storage/scoped-storage.ts");
const {applyWeekMessages, applyWeekOutcome, resolveApplyWeekAttempt} = require("../src/lib/applyWeek.ts");

const A = "00000000-0000-4000-8000-00000000000a";
const asA = {scope: "u_" + A, userId: A};
const week41 = {isoYear: 2026, isoWeek: 41};
const days = dish => [
 {day: "Miércoles", date: "", lunch: dish + " X", dinner: "LIBRE"},
 {day: "Lunes", date: "", lunch: dish + " L", dinner: "Cena " + dish},
];

// The account: one week row (version, days) and the answers the next RPC calls should give.
function installSyntheticSupabase() {
 const state = {week: null, calls: [], next: []};
 const rowsOf = week => week.days.map(day => ({
  day_name: day.day_name, position: day.position, lunch_status: day.lunch_status,
  lunch_dish_name: day.lunch_dish_name, dinner_status: day.dinner_status, dinner_dish_name: day.dinner_dish_name,
 }));
 const query = table => {
  const result = () => table === "weeks"
   ? {data: state.week && {id: "w1", title: "", iso_year: 2026, iso_week: 41, version: state.week.version, updated_at: "2026-10-08T10:00:00Z"}, error: null}
   : {data: state.week ? rowsOf(state.week) : [], error: null};
  const chain = {
   select: () => chain, eq: () => chain, order: () => chain, limit: () => chain,
   maybeSingle: async () => result(),
   then: (resolve, reject) => Promise.resolve(result()).then(resolve, reject),
  };
  return chain;
 };
 const saved = {rpc: supabase.rpc, from: supabase.from};
 supabase.from = query;
 supabase.rpc = async (name, params) => {
  state.calls.push({name, params});
  const scripted = state.next.shift();
  if (scripted) return scripted(state, params);
  if (name === "apply_week") {
   const current = state.week?.version ?? null;
   if (!params.p_overwrite && current !== params.p_expected_version) return {data: {status: "conflict", week_id: "w1", version: current, updated_at: null}, error: null};
   state.week = {version: (current ?? 0) + 1, days: params.p_days};
   return {data: {status: "applied", week_id: "w1", version: state.week.version, updated_at: null}, error: null};
  }
  if (state.week?.version !== params.p_expected_version) return {data: {status: "conflict", week_id: "w1", version: state.week?.version ?? null, updated_at: null}, error: null};
  const day = state.week.days.find(row => row.position === params.p_position);
  day[params.p_meal + "_status"] = params.p_status;
  day[params.p_meal + "_dish_name"] = params.p_dish_name;
  state.week.version++;
  return {data: {status: "applied", week_id: "w1", version: state.week.version, updated_at: null}, error: null};
 };
 state.restore = () => Object.assign(supabase, saved);
 return state;
}

let account, restoreDevice;
beforeEach(() => {
 account = installSyntheticSupabase();
 restoreDevice = useDevice(createDevice());
});
afterEach(() => {
 account.restore();
 restoreDevice();
});

test("apply_week / update_week_slot results map to typed outcomes; anything else is an error", () => {
 assert.deepEqual(parseWeekWriteResult({status: "applied", week_id: "w1", version: 3, updated_at: "t"}), {status: "applied", weekId: "w1", version: 3, updatedAt: "t"});
 assert.equal(parseWeekWriteResult({status: "duplicate", week_id: "w1", version: 3}).status, "duplicate");
 assert.deepEqual(parseWeekWriteResult({status: "conflict", week_id: null, version: null, updated_at: null}), {status: "conflict", weekId: null, version: null, updatedAt: null});
 assert.throws(() => parseWeekWriteResult({status: "ok", week_id: "w1", version: 1}), /Unexpected week write result/);
 assert.throws(() => parseWeekWriteResult({status: "applied", week_id: "w1"}), /missing week or version/);
 assert.throws(() => parseWeekWriteResult({status: "applied", week_id: "w1", version: 1.5}), /invalid version/);
 assert.throws(() => parseWeekWriteResult(null), /Unexpected week write result/);

 assert.deepEqual(repos.weekWriteToPush({status: "applied", weekId: "w1", version: 4, updatedAt: null}), {version: "4", duplicate: false});
 assert.deepEqual(repos.weekWriteToPush({status: "duplicate", weekId: "w1", version: 4, updatedAt: null}), {version: "4", duplicate: true});
 assert.throws(() => repos.weekWriteToPush({status: "conflict", weekId: "w1", version: 5, updatedAt: null}), RemoteConflictError);
});

test("versions: weeks.version as text; a pre-B4 cached updated_at can never match (remote wins)", () => {
 assert.equal(repos.toWeekVersion(null), null);
 assert.equal(repos.toWeekVersion("7"), 7);
 assert.equal(repos.toWeekVersion("2026-10-07T10:00:00.123+00:00"), -1);
});

test("days for apply_week: position by day name, Monday→Sunday, free meals without dish, unknown day refused", () => {
 const rows = weekToApplyWeekDays({days: [
  {dayName: "Domingo", lunch: {status: "planned", dishName: " Paella "}, dinner: {status: "free", dishName: "no se guarda"}},
  {dayName: "Miércoles", lunch: {status: "free", dishName: ""}, dinner: {status: "planned", dishName: "Sopa"}},
 ]});
 assert.deepEqual(rows, [
  {position: 2, day_name: "Miércoles", lunch_status: "free", lunch_dish_name: "", dinner_status: "planned", dinner_dish_name: "Sopa"},
  {position: 6, day_name: "Domingo", lunch_status: "planned", lunch_dish_name: "Paella", dinner_status: "free", dinner_dish_name: ""},
 ]);
 assert.throws(() => weekToApplyWeekDays({days: [{dayName: "Funday", lunch: {status: "free", dishName: ""}, dinner: {status: "free", dishName: ""}}]}), /unknown day/);
});

test("«Usar este menú»: one request key per attempt (same menu and week), a new one otherwise", () => {
 let n = 0;
 const key = () => "key-" + (++n);
 const menu = {days: []};
 const first = resolveApplyWeekAttempt(null, menu, "2026-W41", key);
 assert.equal(first.requestKey, "key-1");
 assert.equal(first.overwrite, null);
 first.overwrite = true;
 assert.equal(resolveApplyWeekAttempt(first, menu, "2026-W41", key), first, "a resend keeps key and the confirmed replace");
 assert.equal(resolveApplyWeekAttempt(first, {days: []}, "2026-W41", key).requestKey, "key-2", "another menu is another attempt");
 assert.equal(resolveApplyWeekAttempt(first, menu, "2026-W42", key).requestKey, "key-3", "another week is another attempt");
});

test("«Usar este menú»: applied, duplicate, guest, conflict and offline each give a clear message (B5: menu result apart)", () => {
 const success = (menu, message) => ({status: "success", menu, message, attempt: "discard", openWeek: true});
 assert.deepEqual(applyWeekOutcome({status: "synced"}), success("account", applyWeekMessages.applied));
 assert.deepEqual(applyWeekOutcome({status: "local"}), success("device", applyWeekMessages.device), "a guest is not told it is in an account");
 assert.deepEqual(applyWeekOutcome({status: "synced", duplicate: true}), success("account", applyWeekMessages.duplicate));
 assert.deepEqual(applyWeekOutcome({status: "conflict", remoteData: null}), {status: "error", menu: "conflict", message: applyWeekMessages.conflict, attempt: "discard", openWeek: false});
 assert.deepEqual(applyWeekOutcome({status: "pending"}), {status: "error", menu: "pending", message: applyWeekMessages.pending, attempt: "keep", openWeek: false});
 assert.match(applyWeekMessages.conflict, /Otro dispositivo/);
 assert.match(applyWeekMessages.applied, /en tu cuenta/);
 assert.doesNotMatch(applyWeekMessages.device, /Guardado en tu cuenta/);
 assert.match(applyWeekMessages.pending, /Solo en este dispositivo/);
});

test("saving a week sends the cached version to apply_week (no separate read first) and caches the new one", async () => {
 assert.equal((await repos.saveWeek(asA, week41, days("Uno"))).status, "synced");
 assert.deepEqual(account.calls.map(call => [call.name, call.params.p_expected_version, call.params.p_overwrite]), [["apply_week", null, false]]);
 assert.deepEqual(account.calls[0].params.p_days.map(day => day.position), [0, 2]);
 assert.equal(readEnvelope(asA.scope, "week", "2026-W41").remoteVersion, "1");
 assert.equal(readEnvelope(asA.scope, "week", "2026-W41").pending, false);

 await repos.saveWeek(asA, week41, days("Dos"));
 assert.equal(account.calls[1].params.p_expected_version, 1);
 assert.notEqual(account.calls[1].params.p_request_key, account.calls[0].params.p_request_key, "every plain save is its own request");
 assert.equal(readEnvelope(asA.scope, "week", "2026-W41").remoteVersion, "2");
});

test("conflict: nothing is written, the account week replaces the device copy and is returned", async () => {
 await repos.saveWeek(asA, week41, days("Mía"));
 account.week.version = 9; // another device saved meanwhile
 account.week.days[0].lunch_dish_name = "De otro dispositivo";
 const result = await repos.saveWeek(asA, week41, days("Pisada"));
 assert.equal(result.status, "conflict");
 assert.equal(result.remoteData[0].lunch, "De otro dispositivo");
 const cached = readEnvelope(asA.scope, "week", "2026-W41");
 assert.deepEqual([cached.remoteVersion, cached.pending, cached.data[0].lunch], ["9", false, "De otro dispositivo"]);
});

test("«reemplazar semana» confirmed: overwrite with the attempt's request key; a resend of it is a duplicate", async () => {
 await repos.saveWeek(asA, week41, days("Antes"));
 account.week.version = 5;
 const requestKey = "11111111-1111-4111-8111-111111111111";
 const first = await repos.saveWeek(asA, week41, days("Menú"), {overwrite: true, requestKey, generationRequestId: "g1"});
 assert.equal(first.status, "synced");
 const call = account.calls.at(-1).params;
 assert.deepEqual([call.p_overwrite, call.p_request_key, call.p_generation_request_id], [true, requestKey, "g1"]);

 account.next.push(state => ({data: {status: "duplicate", week_id: "w1", version: state.week.version, updated_at: null}, error: null}));
 const again = await repos.saveWeek(asA, week41, days("Menú"), {overwrite: true, requestKey});
 assert.deepEqual(again, {status: "synced", duplicate: true});
 assert.equal(account.calls.at(-1).params.p_request_key, requestKey);
 assert.equal(readEnvelope(asA.scope, "week", "2026-W41").data[0].lunch, "Menú L");
});

test("a database error (e.g. foreign generation request) is never retried without the link; the change stays pending", async () => {
 account.next.push(() => ({data: null, error: {message: "violates foreign key constraint"}}));
 const result = await repos.saveWeek(asA, week41, days("Ajeno"), {overwrite: true, generationRequestId: "foreign"});
 assert.equal(result.status, "pending");
 assert.equal(account.calls.length, 1);
 assert.equal(account.week, null);
});

test("editing a dish calls update_week_slot for that meal only, at the cached version", async () => {
 await repos.saveWeek(asA, week41, days("Base"));
 const loaded = (await repos.loadWeek(asA, week41)).data;
 const edited = loaded.map(day => (day.day === "Miércoles" ? {...day, dinner: "Lentejas"} : day));
 assert.equal((await repos.saveWeekSlot(asA, week41, edited, {day: "Miércoles", meal: "dinner"})).status, "synced");
 const call = account.calls.at(-1);
 assert.equal(call.name, "update_week_slot");
 assert.deepEqual([call.params.p_position, call.params.p_meal, call.params.p_status, call.params.p_dish_name, call.params.p_expected_version], [2, "dinner", "planned", "Lentejas", 1]);

 account.week.version = 40;
 const stale = await repos.saveWeekSlot(asA, week41, edited.map(day => ({...day, lunch: "Otra"})), {day: "Lunes", meal: "lunch"});
 assert.equal(stale.status, "conflict");
 assert.equal(account.calls.at(-1).name, "update_week_slot");
 assert.equal(account.week.days[0].lunch_dish_name, "Base L", "a conflicting edit writes nothing");
});

test("a pending week is resent with its base version; if the account changed meanwhile the remote wins", async () => {
 await repos.saveWeek(asA, week41, days("Base"));
 account.next.push(() => { throw new TypeError("fetch failed"); });
 assert.equal((await repos.saveWeek(asA, week41, days("Sin conexión"))).status, "pending");

 // The read still sees version 1, but another device writes before the resend lands.
 account.next.push(state => {
  state.week.version = 2;
  return {data: {status: "conflict", week_id: "w1", version: 2, updated_at: null}, error: null};
 });
 const load = await repos.loadWeek(asA, week41);
 assert.equal(account.calls.at(-1).params.p_expected_version, 1);
 assert.equal(load.discardedLocalChanges, true);
 assert.equal(load.data[0].lunch, "Base L");
 assert.equal(readEnvelope(asA.scope, "week", "2026-W41").pending, false);
});

test("applying a menu over a pending copy the server keeps refusing: read without resending, save on the version read", async () => {
 await repos.saveWeek(asA, week41, days("Base"));
 account.next.push(() => ({data: null, error: {message: "rejected"}}));
 assert.equal((await repos.saveWeek(asA, week41, days("Atascado"))).status, "pending");
 const callsBefore = account.calls.length;

 const current = await repos.readRemoteWeek(asA, week41);
 assert.equal(account.calls.length, callsBefore, "reading the account week resends nothing");
 assert.deepEqual([current.version, current.data[0].lunch], ["1", "Base L"]);

 const result = await repos.saveWeek(asA, week41, days("Menú"), {overwrite: true, requestKey: "22222222-2222-4222-8222-222222222222", baseVersion: current.version});
 assert.equal(result.status, "synced");
 assert.equal(account.calls.at(-1).params.p_expected_version, 1);
 const cached = readEnvelope(asA.scope, "week", "2026-W41");
 assert.deepEqual([cached.pending, cached.remoteVersion, cached.data.find(day => day.day === "Lunes").lunch], [false, "2", "Menú L"]);
});
