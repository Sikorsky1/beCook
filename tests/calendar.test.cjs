// B3: ISO calendar, real day dates and the selected week. Run in a zone far from Madrid so that
// nothing can depend on the browser's time zone.
process.env.TZ = "America/Los_Angeles";

const {test} = require("node:test");
const assert = require("node:assert/strict");
const iso = require("../src/lib/isoWeek.ts");
const {resolveWeekSelection, buildWeekHref} = require("../src/lib/weekSelection.ts");
const {importedMenuToWeekDays} = require("../src/lib/importMenu.ts");
const {withWeekDates} = require("../src/lib/weekStorage.ts");
const {getShoppingSignature, matchesShoppingSignature} = require("../src/lib/shoppingListStorage.ts");

const week = (isoYear, isoWeek) => ({isoYear, isoWeek});
const slot = dishName => ({status: "planned", dishName});
const imported = (...names) => names.map(dayName => ({dayName, lunch: slot(`Comida ${dayName}`), dinner: slot(`Cena ${dayName}`)}));
const dateKeys = w => iso.getIsoWeekDays(w).map(day => day.dateKey);

test("week 53 exists only in long ISO years and is rejected elsewhere, never shifted silently", () => {
  for (const year of [2015, 2020, 2026, 2032]) assert.equal(iso.weeksInIsoYear(year), 53, String(year));
  for (const year of [2021, 2024, 2025, 2027]) assert.equal(iso.weeksInIsoYear(year), 52, String(year));
  assert.equal(iso.parseIsoWeek({isoYear: 2025, isoWeek: 53}), null);
  assert.deepEqual(iso.parseIsoWeek({isoYear: 2026, isoWeek: 53}), week(2026, 53));
  const rejected = iso.parseIsoWeekId("2025-W53");
  assert.equal(rejected.ok, false);
  assert.equal(rejected.reason, "no-week-53");
  assert.match(iso.describeInvalidIsoWeek(rejected), /2025 no tiene semana 53/);
  for (const value of ["2026-W54", "2026-W00", "2026-W5", "2026W41", "1999-W10", "abc", ""]) assert.equal(iso.parseIsoWeekId(value).ok, false, value);
  assert.deepEqual(iso.parseIsoWeekId("2026-W41"), {ok: true, week: week(2026, 41)});
});

test("weeks 52/53/01 have the real Monday–Sunday dates across the year change", () => {
  assert.deepEqual(dateKeys(week(2026, 53)), ["2026-12-28", "2026-12-29", "2026-12-30", "2026-12-31", "2027-01-01", "2027-01-02", "2027-01-03"]);
  assert.equal(dateKeys(week(2026, 1))[0], "2025-12-29");
  assert.equal(dateKeys(week(2025, 1))[0], "2024-12-30");
  assert.equal(dateKeys(week(2027, 1))[0], "2027-01-04");
  assert.equal(dateKeys(week(2025, 52))[6], "2025-12-28");
  assert.deepEqual(iso.addIsoWeeks(week(2026, 52), 1), week(2026, 53));
  assert.deepEqual(iso.addIsoWeeks(week(2026, 53), 1), week(2027, 1));
  assert.deepEqual(iso.addIsoWeeks(week(2025, 52), 1), week(2026, 1));
  assert.deepEqual(iso.addIsoWeeks(week(2026, 1), -1), week(2025, 52));
  assert.deepEqual(iso.addIsoWeeks(week(2027, 1), -1), week(2026, 53));
  assert.equal(iso.getIsoWeekDays(week(2026, 41)).map(day => day.dayName).join(), "Lunes,Martes,Miércoles,Jueves,Viernes,Sábado,Domingo");
});

test("DST weeks keep seven consecutive calendar days", () => {
  assert.deepEqual(dateKeys(week(2026, 13)), ["2026-03-23", "2026-03-24", "2026-03-25", "2026-03-26", "2026-03-27", "2026-03-28", "2026-03-29"]);
  assert.deepEqual(dateKeys(week(2026, 43)), ["2026-10-19", "2026-10-20", "2026-10-21", "2026-10-22", "2026-10-23", "2026-10-24", "2026-10-25"]);
  assert.equal(dateKeys(week(2026, 44))[0], "2026-10-26");
});

test("«today» is the calendar day in Europe/Madrid, also around DST and New Year", () => {
  const today = instant => {
    const value = iso.getMadridToday(new Date(instant));
    return `${value.dateKey} ${value.dayName} ${iso.getIsoWeekStorageId(value.week)}`;
  };
  assert.equal(today("2026-10-07T22:30:00Z"), "2026-10-08 Jueves 2026-W41");
  assert.equal(today("2026-03-28T23:30:00Z"), "2026-03-29 Domingo 2026-W13"); // still CET (+1)
  assert.equal(today("2026-03-29T22:30:00Z"), "2026-03-30 Lunes 2026-W14"); // already CEST (+2)
  assert.equal(today("2026-10-24T22:30:00Z"), "2026-10-25 Domingo 2026-W43");
  assert.equal(today("2026-10-25T23:30:00Z"), "2026-10-26 Lunes 2026-W44");
  assert.equal(today("2026-12-31T23:30:00Z"), "2027-01-01 Viernes 2026-W53");
  assert.equal(today("2027-01-03T22:59:00Z"), "2027-01-03 Domingo 2026-W53");
  assert.equal(today("2027-01-03T23:00:00Z"), "2027-01-04 Lunes 2027-W01");
});

test("preview dates come from the target week, never fixed dates", () => {
  const days = importedMenuToWeekDays(imported("Lunes", "Martes", "Miércoles", "Jueves", "Viernes", "Sábado", "Domingo"), week(2026, 41));
  assert.deepEqual(days.map(day => day.date), ["5 oct", "6 oct", "7 oct", "8 oct", "9 oct", "10 oct", "11 oct"]);
  const yearEnd = importedMenuToWeekDays(imported("Lunes", "Viernes"), week(2026, 53));
  assert.deepEqual(yearEnd.map(day => day.date), ["28 dic", "1 ene"]);
});

test("partial imports are dated by day name: only Wednesday, skipped days and unordered input", () => {
  assert.deepEqual(importedMenuToWeekDays(imported("Miércoles"), week(2026, 41)).map(day => `${day.day} ${day.date}`), ["Miércoles 7 oct"]);
  assert.deepEqual(
    importedMenuToWeekDays(imported("Sábado", "Lunes", "Miércoles"), week(2026, 41)).map(day => `${day.day} ${day.date}`),
    ["Lunes 5 oct", "Miércoles 7 oct", "Sábado 10 oct"],
  );
  const stored = [{day: "Miércoles", date: "", lunch: "Lentejas", dinner: "LIBRE"}, {day: "Domingo", date: "", lunch: "Paella", dinner: "Sopa"}];
  assert.deepEqual(withWeekDates(stored, week(2026, 41)).map(day => `${day.day} ${day.date}`), ["Miércoles 7 oct", "Domingo 11 oct"]);
});

test("titles keep both ends of the week and the year when it changes", () => {
  assert.equal(iso.formatIsoWeekTitle(week(2026, 41)), "5–11 octubre");
  assert.equal(iso.formatIsoWeekTitle(week(2026, 36)), "31 agosto – 6 septiembre");
  assert.equal(iso.formatIsoWeekTitle(week(2026, 36), {compact: true}), "31 ago – 6 sept");
  assert.equal(iso.formatIsoWeekTitle(week(2026, 53)), "28 diciembre 2026 – 3 enero 2027");
  assert.equal(iso.formatIsoWeekTitle(week(2026, 53), {compact: true}), "28 dic 2026 – 3 ene 2027");
});

test("the URL is the selected week; preference and today are only fallbacks", () => {
  const today = week(2026, 41);
  const preference = week(2026, 30);
  const none = {weekParam: null, isoYearParam: null, isoWeekParam: null, preference, today};
  // Reload with ?week= returns the same week, with nothing to rewrite.
  assert.deepEqual(resolveWeekSelection({...none, weekParam: "2025-W52"}), {week: week(2025, 52), needsReplace: false, notice: null});
  assert.deepEqual(resolveWeekSelection(none), {week: preference, needsReplace: true, notice: null});
  assert.deepEqual(resolveWeekSelection({...none, preference: null}), {week: today, needsReplace: true, notice: null});
  // Old links are still understood and rewritten to ?week=.
  assert.deepEqual(resolveWeekSelection({...none, isoYearParam: "2026", isoWeekParam: "53"}), {week: week(2026, 53), needsReplace: true, notice: null});
  // An invalid URL is corrected to the current week, with an explicit notice.
  for (const params of [{weekParam: "2025-W53"}, {isoYearParam: "2025", isoWeekParam: "53"}, {weekParam: "mañana"}]) {
    const selection = resolveWeekSelection({...none, ...params});
    assert.deepEqual(selection.week, today);
    assert.equal(selection.needsReplace, true);
    assert.ok(selection.notice && /semana actual/.test(selection.notice), JSON.stringify(params));
  }
});

test("previous, next and today produce shareable ?week= links, also across the year", () => {
  assert.equal(buildWeekHref("/week", week(2026, 5)), "/week?week=2026-W05");
  assert.equal(buildWeekHref("/create-menu", week(2026, 41)), "/create-menu?week=2026-W41");
  assert.equal(buildWeekHref("/week", iso.addIsoWeeks(week(2026, 53), 1)), "/week?week=2027-W01");
  assert.equal(buildWeekHref("/week", iso.addIsoWeeks(week(2026, 1), -1)), "/week?week=2025-W52");
  assert.equal(buildWeekHref("/week", iso.getMadridToday(new Date("2026-10-07T22:30:00Z")).week), "/week?week=2026-W41");
});

test("shopping signature has no presented date and still accepts existing caches", () => {
  const target = week(2026, 41);
  const preview = importedMenuToWeekDays(imported("Lunes", "Miércoles"), target);
  const stored = withWeekDates(preview.map(day => ({...day, date: ""})), target);
  const sign = days => getShoppingSignature(target, days);
  assert.equal(sign(preview), sign(stored));
  assert.doesNotMatch(sign(preview), /oct/);
  assert.equal(sign(withWeekDates(preview, week(2026, 42))), sign(preview));
  // Caches written before B3 signed JSON.stringify(weekDays) with the real dates.
  assert.ok(matchesShoppingSignature(JSON.stringify(stored), target, stored));
  assert.ok(matchesShoppingSignature(sign(stored), target, stored));
  assert.equal(matchesShoppingSignature(sign(stored), target, [{...stored[0], lunch: "Otro plato"}, stored[1]]), false);
});
