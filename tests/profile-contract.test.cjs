const {test} = require("node:test");
const assert = require("node:assert/strict");
const {
  PROFILE_LIMITS,
  ProfileValidationError,
  legacyGoalFromGoals,
  parseDislikedFoods,
  profileFromRow,
  profileToRow,
  serializeDislikedFoods,
  validateProfileForStorage,
} = require("../src/lib/supabase/profiles.ts");

// B2: adapters between public.profiles (CHECKs, TEXT disliked_foods, legacy goal) and the domain.
const profile = (extra = {}) => ({
  sex: "female", birthDate: "1990-01-01", heightCm: 165, weightKg: 65, householdSize: 2,
  weeklyTrainingDays: 3, trainingTypes: ["running"], goals: ["healthy_eating"], goal: "healthy_eating",
  dietaryRestrictions: ["none"], allergies: [], dislikedFoods: [], ...extra,
});
const row = (extra = {}) => ({
  id: "p1", user_id: "u1", sex: "female", birth_date: "1990-01-01", height_cm: 165, weight_kg: 65,
  household_size: 2, weekly_training_days: 3, training_types: ["running"], other_training_type: null,
  goal: "healthy_eating", goals: ["healthy_eating"], other_goal: null, dietary_restrictions: ["none"],
  allergies: [], other_allergies: null, disliked_foods: null, ...extra,
});
const fieldsOf = value => validateProfileForStorage(value).map(issue => issue.field);

test("disliked_foods: every stored format reads as a list without loss", () => {
  assert.deepEqual(parseDislikedFoods('["pollo","brócoli, crudo"]'), ["pollo", "brócoli", "crudo"]);
  assert.deepEqual(parseDislikedFoods('["rábano ficticio"]'), ["rábano ficticio"]);
  assert.deepEqual(parseDislikedFoods("[]"), []);
  assert.deepEqual(parseDislikedFoods('{pollo,"queso azul"}'), ["pollo", "queso azul"]);
  assert.deepEqual(parseDislikedFoods("pollo, brócoli"), ["pollo", "brócoli"]);
  assert.deepEqual(parseDislikedFoods("pollo\nbrócoli; setas"), ["pollo", "brócoli", "setas"]);
  assert.deepEqual(parseDislikedFoods("[no es json"), ["[no es json"]);
  assert.deepEqual(parseDislikedFoods("rábano ficticio"), ["rábano ficticio"]);
  assert.deepEqual(parseDislikedFoods(null), []);
  assert.deepEqual(parseDislikedFoods("   "), []);
});

test("disliked_foods: canonical text round-trips; empty list is NULL", () => {
  const foods = ["pollo", "  brócoli ", "Pollo", "", "queso   azul"];
  const text = serializeDislikedFoods(foods);
  assert.equal(text, "pollo, brócoli, queso azul");
  assert.deepEqual(parseDislikedFoods(text), ["pollo", "brócoli", "queso azul"]);
  assert.equal(serializeDislikedFoods(parseDislikedFoods(text)), text);
  assert.equal(serializeDislikedFoods([]), null);
  assert.equal(serializeDislikedFoods([" ", ","]), null);
});

test("disliked_foods: the 150-character limit applies to the stored text", () => {
  const at150 = ["x".repeat(148), "y"]; // "xxx…, y" = 151
  assert.equal(serializeDislikedFoods(["x".repeat(150)]).length, PROFILE_LIMITS.dislikedFoodsMaxLength);
  assert.deepEqual(fieldsOf(profile({dislikedFoods: ["x".repeat(150)]})), []);
  assert.deepEqual(fieldsOf(profile({dislikedFoods: at150})), ["dislikedFoods"]);
  const [issue] = validateProfileForStorage(profile({dislikedFoods: at150}));
  assert.match(issue.message, /151\/150/);
  assert.throws(() => profileToRow(profile({dislikedFoods: at150})), ProfileValidationError);
});

test("legacy goal is always a value profiles_goal_check accepts", () => {
  assert.equal(legacyGoalFromGoals(["other", "muscle_gain"]), "muscle_gain");
  assert.equal(legacyGoalFromGoals(["other"]), "healthy_eating");
  assert.equal(legacyGoalFromGoals([]), "healthy_eating");
  assert.equal(legacyGoalFromGoals(["fat_loss", "other"]), "fat_loss");
  const stored = profileToRow(profile({goals: ["other", "sports_performance"], goal: "other", otherGoal: " Triatlón "}));
  assert.equal(stored.goal, "sports_performance");
  assert.deepEqual(stored.goals, ["other", "sports_performance"]);
  assert.equal(stored.other_goal, "Triatlón");
  assert.equal(profileToRow(profile({goals: [], goal: "maintenance"})).goal, "healthy_eating");
  assert.equal(profileToRow(profile({goals: ["fat_loss"], otherGoal: "ignorado"})).other_goal, null);
});

test("goals stay the source of truth when reading; legacy maintenance maps to healthy_eating", () => {
  assert.deepEqual(profileFromRow(row({goal: "muscle_gain", goals: ["other", "muscle_gain"], other_goal: "Triatlón"})).goals, ["other", "muscle_gain"]);
  assert.deepEqual(profileFromRow(row({goal: "maintenance", goals: []})).goals, ["healthy_eating"]);
  assert.deepEqual(profileFromRow(row({goal: "fat_loss", goals: null})).goals, ["fat_loss"]);
});

test("rows written by the previous code read back intact", () => {
  const read = profileFromRow(row({weekly_training_days: 5, disliked_foods: '["pollo","setas"]'}));
  assert.deepEqual(read.dislikedFoods, ["pollo", "setas"]);
  assert.equal(read.weeklyTrainingDays, 5);
  assert.equal(profileToRow(read).disliked_foods, "pollo, setas");
});

test("weekly training days 0–7 (widened CHECK) and the other DB ranges are validated before saving", () => {
  for (const days of [0, 6, 7]) assert.deepEqual(fieldsOf(profile({weeklyTrainingDays: days})), []);
  for (const days of [-1, 8, 2.5]) assert.deepEqual(fieldsOf(profile({weeklyTrainingDays: days})), ["weeklyTrainingDays"]);
  assert.equal(profileFromRow(row({weekly_training_days: 7})).weeklyTrainingDays, 7);
  assert.deepEqual(fieldsOf(profile({heightCm: 119})), ["heightCm"]);
  assert.deepEqual(fieldsOf(profile({heightCm: 230, weightKg: 45})), []);
  assert.deepEqual(fieldsOf(profile({weightKg: 200.5})), ["weightKg"]);
  assert.deepEqual(fieldsOf(profile({householdSize: 7})), ["householdSize"]);
  assert.deepEqual(fieldsOf(profile({birthDate: ""})), ["birthDate"]);
  assert.deepEqual(fieldsOf(profile({goals: ["maintenance"]})), ["goals"]);
  assert.deepEqual(fieldsOf(profile({allergies: ["fish"]})), ["allergies"]);
  assert.deepEqual(fieldsOf(profile({goals: ["other"], otherGoal: "x".repeat(151)})), ["otherGoal"]);
  assert.deepEqual(fieldsOf(profile({goals: ["fat_loss"], otherGoal: "x".repeat(151)})), []);
});
