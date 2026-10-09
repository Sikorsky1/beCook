// Step 29 (D4): /week opens on «Hoy». Today comes only from isoWeek (Madrid); the selected week
// (URL) is never changed by it. Run far from Madrid so nothing depends on the browser's zone.
process.env.TZ = "America/Los_Angeles";

const {test} = require("node:test");
const assert = require("node:assert/strict");
const iso = require("../src/lib/isoWeek.ts");
const {withWeekDates} = require("../src/lib/weekStorage.ts");
const {resolveWeekSelection} = require("../src/lib/weekSelection.ts");
const today = require("../src/lib/weekToday.ts");

const week = (isoYear, isoWeek) => ({isoYear, isoWeek});
const days = (...names) => names.map(day => ({day, date: "", lunch: `Comida ${day}`, dinner: `Cena ${day}`}));
const fullWeek = () => days(...iso.isoDayNames);
const at = utc => iso.getMadridToday(new Date(utc));
const names = list => list.map(day => day.day);

test("current week: today is featured and the other six days follow Monday → Sunday", () => {
  const now = at("2026-10-09T10:00:00Z"); // Friday 9 Oct 2026, 2026-W41
  const layout = today.getWeekTodayLayout(withWeekDates(fullWeek(), week(2026, 41)), week(2026, 41), now);
  assert.equal(layout.todayPosition, 4);
  assert.equal(layout.todayDay.day, "Viernes");
  assert.equal(layout.todayDay.date, "9 oct");
  assert.equal(layout.todayDay.lunch, "Comida Viernes");
  assert.deepEqual(names(layout.otherDays), ["Lunes", "Martes", "Miércoles", "Jueves", "Sábado", "Domingo"]);
});

test("another week shows no «Hoy» block and all its days compact, whatever today is", () => {
  const now = at("2026-10-09T10:00:00Z");
  for (const shown of [week(2026, 40), week(2026, 42), week(2025, 41)]) {
    const layout = today.getWeekTodayLayout(fullWeek(), shown, now);
    assert.equal(layout.todayPosition, null);
    assert.equal(layout.todayDay, null);
    assert.equal(layout.otherDays.length, 7);
  }
});

test("partial week: today without a menu keeps an empty «Hoy» slot and only the imported days", () => {
  const now = at("2026-10-09T10:00:00Z");
  const missing = today.getWeekTodayLayout(days("Miércoles", "Sábado"), week(2026, 41), now);
  assert.equal(missing.todayPosition, 4);
  assert.equal(missing.todayDay, null);
  assert.deepEqual(names(missing.otherDays), ["Miércoles", "Sábado"]);

  const onlyToday = today.getWeekTodayLayout(days("Viernes"), week(2026, 41), now);
  assert.equal(onlyToday.todayDay.day, "Viernes");
  assert.deepEqual(onlyToday.otherDays, []);
});

test("«Hoy» is the Madrid calendar day around midnight, DST and New Year, never the browser's", () => {
  // 23:30 UTC on Sunday 11 Oct = 01:30 Monday 12 Oct in Madrid (CEST): next week, Monday.
  const monday = at("2026-10-11T23:30:00Z");
  assert.equal(today.getWeekTodayLayout(fullWeek(), week(2026, 41), monday).todayPosition, null);
  assert.equal(today.getWeekTodayLayout(fullWeek(), week(2026, 42), monday).todayDay.day, "Lunes");
  // 21:59 UTC Sunday 11 Oct = 23:59 Sunday in Madrid: still this week's Sunday.
  assert.equal(today.getWeekTodayLayout(fullWeek(), week(2026, 41), at("2026-10-11T21:59:00Z")).todayDay.day, "Domingo");
  // DST change (25 Oct 2026, CET from 03:00): 23:30 UTC on the 25th = 00:30 Monday 26 (W44).
  assert.equal(today.getWeekTodayLayout(fullWeek(), week(2026, 44), at("2026-10-25T23:30:00Z")).todayDay.day, "Lunes");
  // New Year inside week 53: 1 Jan 2027 is the Friday of 2026-W53.
  const newYear = at("2026-12-31T23:30:00Z");
  const layout = today.getWeekTodayLayout(withWeekDates(fullWeek(), week(2026, 53)), week(2026, 53), newYear);
  assert.equal(layout.todayDay.day, "Viernes");
  assert.equal(layout.todayDay.date, "1 ene");
  assert.equal(today.getWeekTodayLayout(fullWeek(), week(2027, 1), newYear).todayPosition, null);
});

test("today never changes the selected week: the URL (B3) still decides what is shown", () => {
  const now = at("2026-10-09T10:00:00Z");
  const selection = resolveWeekSelection({weekParam: "2026-W43", isoYearParam: null, isoWeekParam: null, preference: null, today: now.week});
  assert.deepEqual(selection.week, week(2026, 43));
  assert.equal(today.getWeekTodayLayout(fullWeek(), selection.week, now).todayDay, null);
  const current = resolveWeekSelection({weekParam: null, isoYearParam: null, isoWeekParam: null, preference: null, today: now.week});
  assert.equal(today.getWeekTodayLayout(fullWeek(), current.week, now).todayDay.day, "Viernes");
});

test("day strip: one accent for today, selection only after the user picks a day", () => {
  const all = new Set([0, 1, 2, 3, 4, 5, 6]);
  const initial = today.getDayStripCells(all, 4, null);
  assert.deepEqual(initial.filter(cell => cell.isToday).map(cell => cell.position), [4]);
  assert.deepEqual(initial.filter(cell => cell.isSelected), [], "nothing is selected on entry");

  const picked = today.getDayStripCells(all, 4, 1);
  assert.deepEqual(picked.filter(cell => cell.isSelected).map(cell => cell.position), [1]);
  assert.deepEqual(picked.filter(cell => cell.isToday).map(cell => cell.position), [4]);

  const partial = today.getDayStripCells(new Set([2, 5]), 4, 4);
  assert.equal(partial[4].isToday, true);
  assert.equal(partial[4].hasMenu, false);
  assert.equal(partial[4].isSelected, false, "a day without menu cannot be selected");
  assert.equal(today.getDayStripCells(all, null, null).some(cell => cell.isToday), false);
});

test("a selected day belongs to its week and is dropped when the week changes", () => {
  const selection = {weekId: iso.getIsoWeekStorageId(week(2026, 41)), position: 2};
  assert.equal(today.selectedPositionFor(selection, week(2026, 41)), 2);
  assert.equal(today.selectedPositionFor(selection, week(2026, 42)), null);
  assert.equal(today.selectedPositionFor(null, week(2026, 41)), null);
});

test("an open page moves «Hoy» to the new day after midnight and keeps it otherwise", () => {
  const friday = at("2026-10-09T10:00:00Z");
  assert.equal(today.nextMadridToday(friday, at("2026-10-09T21:00:00Z")), friday);
  const saturday = at("2026-10-09T22:30:00Z"); // 00:30 Saturday in Madrid
  assert.equal(today.nextMadridToday(friday, saturday), saturday);
  assert.equal(saturday.dayName, "Sábado");
  assert.equal(today.getWeekTodayLayout(fullWeek(), week(2026, 41), saturday).todayDay.day, "Sábado");
});
