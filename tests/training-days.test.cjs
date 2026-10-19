const {test} = require("node:test");
const assert = require("node:assert/strict");
const {defaultTrainingWeekdays, normalizeTrainingWeekdays, trainingWeekdaysOf} = require("../src/lib/trainingDays.ts");
const {isStarchyDish, prefersStarch} = require("../src/lib/menu-generation/carbs.ts");
const {catalogMenu} = require("../src/lib/menu-generation/catalog-menu.ts");
const {readMenuProfile, buildMenuInput} = require("../src/lib/menu-generation/prompt.ts");
const {profileFromRow, profileToRow, validateProfileForStorage} = require("../src/lib/supabase/profiles.ts");
const {draftFromProfile, applySection} = require("../src/lib/profileForm.ts");

test("a profile with only a count reads as a spread of that many days", () => {
 assert.deepEqual(defaultTrainingWeekdays(0), []);
 assert.deepEqual(defaultTrainingWeekdays(3), [1, 3, 5]);
 assert.deepEqual(defaultTrainingWeekdays(7), [1, 2, 3, 4, 5, 6, 7]);
 assert.deepEqual(trainingWeekdaysOf({weeklyTrainingDays: 2}), [2, 4]);
 assert.deepEqual(trainingWeekdaysOf({weeklyTrainingDays: 2, trainingWeekdays: [6, 7]}), [6, 7]);
 assert.deepEqual(normalizeTrainingWeekdays([5, 1, 5, 9]), [1, 5]);
 assert.equal(normalizeTrainingWeekdays(null), null);
});

const row = (extra = {}) => ({id: "p", user_id: "u", sex: null, birth_date: null, height_cm: null, weight_kg: null, household_size: 2,
 weekly_training_days: 3, training_types: ["cardio"], other_training_type: null, goal: "healthy_eating", goals: ["healthy_eating"],
 other_goal: null, dietary_restrictions: ["none"], allergies: [], other_allergies: null, disliked_foods: null, confirmed_sections: [], ...extra});

test("profiles: the days are read and saved with their count; cardio is a training type", () => {
 const legacy = profileFromRow(row());
 assert.equal(legacy.trainingWeekdays, undefined);
 assert.deepEqual(draftFromProfile(legacy).trainingWeekdays, [1, 3, 5]);
 assert.equal(profileToRow(legacy).training_weekdays, undefined, "a profile without days keeps the account's");
 const marked = profileFromRow(row({training_weekdays: [2, 6], weekly_training_days: 2}));
 assert.deepEqual(marked.trainingWeekdays, [2, 6]);
 assert.deepEqual(profileToRow(marked).training_weekdays, [2, 6]);
 assert.deepEqual(validateProfileForStorage({...marked, weeklyTrainingDays: 3}).map((issue) => issue.field), ["trainingWeekdays"]);
 const draft = {...draftFromProfile(marked), trainingWeekdays: [1, 2, 4], weeklyTrainingDays: 3};
 const result = applySection(marked, draft, "training");
 assert.ok(result.ok);
 const saved = result.profile;
 assert.equal(saved.weeklyTrainingDays, 3);
 assert.deepEqual(saved.trainingWeekdays, [1, 2, 4]);
});

test("starchy dishes: pasta, rice, potato, bread; not legumes or a coating of bread crumbs", () => {
 for (const dish of ["Espaguetis con setas", "Arroz con pollo", "Merluza con patatas", "Cuscús de verduras", "Lasaña de espinacas"]) assert.ok(isStarchyDish(dish), dish);
 for (const dish of ["Lentejas estofadas", "Salmón a la plancha con espárragos", "Crema de calabaza"]) assert.ok(!isStarchyDish(dish), dish);
 assert.ok(!isStarchyDish("Merluza rebozada", [{name: "pan rallado", optional: false}, {name: "merluza", optional: false}]));
 assert.ok(isStarchyDish("Pollo al horno", [{name: "patatas", optional: false}]));
 assert.equal(prefersStarch([], 0), null);
 assert.equal(prefersStarch([1, 3], 0), true);
 assert.equal(prefersStarch([1, 3], 1), false);
});

test("Crear menú: starchy lunches and dinners on the training days, without starch on the others", () => {
 const profile = readMenuProfile({dietaryRestrictions: ["none"], trainingWeekdays: [1, 3, 5], weeklyTrainingDays: 3});
 let matched = 0;
 let total = 0;
 for (const seed of [1, 2, 3, 4, 5]) {
  const menu = catalogMenu({profile, styles: ["healthy_balanced"], elaboration: "balanced", seed});
  assert.ok(menu);
  menu.days.forEach((day, index) => {
   for (const meal of [day.lunch, day.dinner]) {
    total++;
    if (isStarchyDish(meal.dishName) === [1, 3, 5].includes(index + 1)) matched++;
   }
  });
 }
 // The title alone undercounts catalogue recipes whose starch is an ingredient: most must match.
 assert.ok(matched / total >= 0.75, `${matched}/${total}`);
});

test("the AI hears the training days by name", () => {
 const profile = readMenuProfile({dietaryRestrictions: ["none"], trainingWeekdays: [2, 6], weeklyTrainingDays: 2});
 const input = buildMenuInput({peopleCount: 2}, profile);
 assert.deepEqual(JSON.parse(input.userPrompt).preferences.trainingDays, ["Martes", "Sábado"]);
 const none = buildMenuInput({peopleCount: 2}, readMenuProfile({dietaryRestrictions: ["none"]}));
 assert.deepEqual(JSON.parse(none.userPrompt).preferences.trainingDays, []);
});
