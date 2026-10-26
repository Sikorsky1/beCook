// The weekly rules of lunches and dinners (Sergio, 2026-10-24, menu-rules.ts): Crear menú keeps
// them before AESAN and the menu types, with the carbohydrates on the training days, and breaks
// the fewest when the week cannot keep them all.
const {test} = require("node:test");
const assert = require("node:assert/strict");
const {catalogMenu} = require("../src/lib/menu-generation/catalog-menu.ts");
const {readMenuProfile} = require("../src/lib/menu-generation/profile-input.ts");
const {defaultMenuRules, minimumViolations, ruleBreakdown, ruleDish} = require("../src/lib/menu-generation/menu-rules.ts");
const {catalogCardForCheck} = require("../src/lib/recipes/catalogChecks.ts");

const dish = (title) => ruleDish(title, catalogCardForCheck(title)?.ingredients ?? null);
const broken = (menu, trainingDays) =>
 ruleBreakdown(defaultMenuRules, {lunch: menu.days.map((day) => dish(day.lunch.dishName)), dinner: menu.days.map((day) => dish(day.dinner.dishName))}, trainingDays);

test("lunches avoid fish (Sergio, 2026-10-24): no fish targets, carbohydrates with meat", () => {
 assert.deepEqual(defaultMenuRules.lunch.proteins, {red_meat: 1, white_meat: 2});
 assert.equal(defaultMenuRules.lunch.carbWith, "meat");
 assert.equal(defaultMenuRules.lunch.avoidFish, true);
 const week = (lunch) => ({lunch: Array(7).fill(null).map((_, i) => (i === 0 ? lunch : null)), dinner: Array(7).fill(null)});
 const fishRice = ruleBreakdown(defaultMenuRules, week(ruleDish("Arroz con merluza y verduras")), []);
 const chickenRice = ruleBreakdown(defaultMenuRules, week(ruleDish("Arroz con pollo y verduras")), []);
 assert.equal(fishRice.fish, 1);
 assert.equal(fishRice.missing["lunch.rice"], 1, "rice with fish does not keep «arroz + carne»");
 assert.equal(chickenRice.missing["lunch.rice"], undefined);
});

test("dishes as the rules count them: lomo de cerdo and cordero are white meat, seafood is white fish", () => {
 assert.equal(ruleDish("Lomo de cerdo a la plancha con pimientos").protein, "white_meat");
 assert.equal(ruleDish("Cordero al horno con verduras").protein, "white_meat");
 assert.equal(ruleDish("Ternera guisada con setas").protein, "red_meat");
 assert.equal(ruleDish("Sepia a la plancha con ensalada").protein, "white_fish");
 assert.equal(ruleDish("Sardinas al horno con pimientos").protein, "blue_fish");
 assert.equal(ruleDish("Tortilla de calabacín").protein, "egg");
 const rice = ruleDish("Arroz con pollo y verduras");
 assert.deepEqual([rice.carb, rice.meatOrFish, rice.hydrate, rice.vegetable], ["rice", true, true, true]);
 const lentils = ruleDish("Lentejas estofadas");
 assert.deepEqual([lentils.carb, lentils.meatOrFish, lentils.hydrate], ["legume", false, true]);
 assert.equal(ruleDish("Pechuga de pollo al horno").vegetable, false);
});

test("Crear menú: every week breaks only the rules the training days cannot fit", () => {
 for (const trainingDays of [[1, 3, 5], [2, 4], [1, 2, 3, 4, 5], []]) {
  const profile = readMenuProfile({trainingWeekdays: trainingDays, weeklyTrainingDays: trainingDays.length});
  const floor = minimumViolations(defaultMenuRules, trainingDays);
  assert.equal(floor, Math.max(0, trainingDays.length ? 4 - trainingDays.length : 0));
  let atMinimum = 0;
  const weeks = 100;
  for (let seed = 1; seed <= weeks; seed++) {
   const menu = catalogMenu({profile, styles: ["healthy_balanced"], seed: seed * 7919});
   assert.ok(menu, `${trainingDays} seed ${seed}`);
   if (broken(menu, trainingDays).total <= floor) atMinimum++;
  }
  assert.ok(atMinimum / weeks >= 0.95, `${trainingDays}: ${atMinimum}/${weeks}`);
 }
});

test("Crear menú: lunches without fish, the carbohydrates with meat, always a vegetable; dinners of white fish, egg and white meat", () => {
 const profile = readMenuProfile({trainingWeekdays: [1, 3, 5], weeklyTrainingDays: 3});
 for (let seed = 1; seed <= 50; seed++) {
  const menu = catalogMenu({profile, styles: ["healthy_balanced"], seed});
  const lunches = menu.days.map((day) => dish(day.lunch.dishName));
  const dinners = menu.days.map((day) => dish(day.dinner.dishName));
  assert.ok(lunches.every((lunch) => !lunch.fish && lunch.vegetable), `seed ${seed}`);
  // Since 2026-10-24: «legumbre/arroz/pasta/patata + carne»; with three training days one of them
  // is missing or on a rest day.
  assert.ok(lunches.filter((lunch) => lunch.carb && lunch.meat).length >= 3, `seed ${seed}`);
  const proteins = (list) => list.reduce((counts, item) => ({...counts, [item.protein]: (counts[item.protein] ?? 0) + 1}), {});
  assert.equal(proteins(lunches).red_meat, 1, `seed ${seed}`);
  assert.ok(proteins(lunches).white_meat >= 2, `seed ${seed}`);
  const dinner = proteins(dinners);
  for (const protein of ["white_fish", "egg", "white_meat"]) assert.ok(dinner[protein] >= 2, `seed ${seed}: ${protein}`);
  // Carbohydrates only on Monday, Wednesday and Friday, or one lunch on a rest day.
  const off = menu.days.flatMap((day, index) => [1, 3, 5].includes(index + 1) ? [] : [day.lunch.dishName, day.dinner.dishName]).filter((title) => dish(title).hydrate);
  assert.ok(off.length <= 1, `seed ${seed}: ${off.join(" / ")}`);
 }
});

test("vegetarian weeks keep the AESAN frequencies instead of the rules", () => {
 const vegetarian = readMenuProfile({dietaryRestrictions: ["vegetarian"]});
 const menu = catalogMenu({profile: vegetarian, styles: ["healthy_balanced"], seed: 3});
 assert.ok(menu);
 assert.ok(menu.days.every((day) => !dish(day.lunch.dishName).meatOrFish));
});
