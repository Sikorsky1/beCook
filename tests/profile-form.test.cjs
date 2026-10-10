const {test} = require("node:test");
const assert = require("node:assert/strict");
const {
  applySection,
  assumedMenuSections,
  buildNewProfile,
  buildOnboardingProfile,
  canSaveSection,
  draftFromProfile,
  emptyBodyDraft,
  emptyProfileDraft,
  isSectionDirty,
  issuesBySection,
  parseWholeNumber,
  profileSectionInfo,
  profileSections,
  readStoredProfile,
  resetSections,
  sectionStatus,
  toggleRestriction,
} = require("../src/lib/profileForm.ts");
const {profileFromRow, profileToRow} = require("../src/lib/supabase/profiles.ts");

// Step 24: no invented personal data, explicit «Ninguna», sections saved one at a time.
const allConfirmed = ["household", "goals", "restrictions", "allergies", "training", "body"];
const saved = (extra = {}) => ({
  id: "p1", sex: "female", birthDate: "1990-01-01", heightCm: 165, weightKg: 65, householdSize: 3,
  weeklyTrainingDays: 2, trainingTypes: ["running"], otherTrainingType: "", goals: ["fat_loss"], goal: "fat_loss",
  otherGoal: "", dietaryRestrictions: ["vegetarian"], allergies: ["nuts"], otherAllergies: "",
  dislikedFoods: ["brócoli"], confirmedSections: allConfirmed, ...extra,
});
// A profile saved by the previous form: every value there, nothing confirmed.
const legacy = (extra = {}) => saved({confirmedSections: [], ...extra});
const answered = (extra = {}) => ({
  ...emptyProfileDraft(), householdSize: 2, goals: ["healthy_eating"], dietaryRestrictions: ["none"],
  noAllergies: true, sex: "male", birthDate: "1985-05-05", heightCm: "180", weightKg: "80", ...extra,
});
const fields = result => result.issues.map(issue => issue.field).sort();

test("a new profile starts with nothing chosen and nothing personal filled in", () => {
  const draft = emptyProfileDraft();
  assert.equal(draft.householdSize, null);
  assert.deepEqual(draft.goals, []);
  assert.deepEqual(draft.dietaryRestrictions, []);
  assert.deepEqual(draft.allergies, []);
  assert.equal(draft.noAllergies, false);
  assert.equal(draft.sex, null);
  assert.equal(draft.birthDate, "");
  assert.equal(draft.heightCm, "");
  assert.equal(draft.weightKg, "");
  assert.deepEqual(draftFromProfile(null), draft);
  // Training and body data are optional and start empty.
  assert.deepEqual(profileSections.map(section => sectionStatus(draft, null, section)),
    ["pending", "pending", "pending", "optional", "optional"]);
  assert.deepEqual(profileSections.filter(section => profileSectionInfo[section].required),
    ["household", "goals", "restrictions"]);
});

test("an untouched new profile cannot be saved: every question is reported, nothing is assumed", () => {
  const result = buildNewProfile(emptyProfileDraft());
  assert.equal(result.ok, false);
  assert.deepEqual(fields(result), ["allergies", "dietaryRestrictions", "goals", "householdSize"]);
  assert.deepEqual(Object.keys(issuesBySection(result.issues)).sort(), ["goals", "household", "restrictions"]);
});

test("body data is optional: a profile saves without it and stores NULL, never a default", () => {
  const result = buildNewProfile(answered(emptyBodyDraft()));
  assert.equal(result.ok, true);
  const row = profileToRow(result.profile, {userId: "u1"});
  assert.deepEqual([row.sex, row.birth_date, row.height_cm, row.weight_kg], [null, null, null, null]);
  assert.deepEqual(row.confirmed_sections, ["household", "goals", "restrictions", "allergies"]);
  const reloaded = profileFromRow({...row, id: "p1"});
  assert.deepEqual([reloaded.sex, reloaded.birthDate, reloaded.heightCm, reloaded.weightKg], [null, null, null, null]);
  const draft = draftFromProfile(reloaded);
  assert.deepEqual([draft.sex, draft.birthDate, draft.heightCm, draft.weightKg], [null, "", "", ""]);
  assert.equal(sectionStatus(draft, reloaded, "body"), "optional");
  assert.equal(sectionStatus(draft, reloaded, "training"), "optional");
  // Only a value that is given is checked; partial body data is fine.
  assert.equal(buildNewProfile(answered({...emptyBodyDraft(), heightCm: "170"})).ok, true);
  assert.deepEqual(fields(buildNewProfile(answered({...emptyBodyDraft(), weightKg: "300"}))), ["weightKg"]);
  // Body data the user gave is confirmed; clearing it later saves NULL and keeps it confirmed.
  const withBody = buildNewProfile(answered()).profile;
  assert.ok(withBody.confirmedSections.includes("body"));
  const cleared = applySection(withBody, {...draftFromProfile(withBody), ...emptyBodyDraft()}, "body");
  assert.equal(cleared.ok, true);
  assert.equal(profileToRow(cleared.profile).height_cm, null);
  assert.ok(cleared.profile.confirmedSections.includes("body"));
});

test("«Ninguna» must be chosen explicitly for restrictions and allergies", () => {
  const result = buildNewProfile(answered({dietaryRestrictions: [], noAllergies: false}));
  assert.deepEqual(fields(result), ["allergies", "dietaryRestrictions"]);
  assert.match(result.issues[0].message, /Ninguna/);
  const noneChosen = buildNewProfile(answered());
  assert.equal(noneChosen.ok, true);
  assert.deepEqual(noneChosen.profile.dietaryRestrictions, ["none"]);
  assert.deepEqual(noneChosen.profile.allergies, []);
  // «Otra» allergy needs its text.
  assert.deepEqual(fields(buildNewProfile(answered({noAllergies: false, allergies: ["other"]}))), ["otherAllergies"]);
});

test("«Ninguna» and the other restrictions exclude each other", () => {
  assert.deepEqual(toggleRestriction([], "none"), ["none"]);
  assert.deepEqual(toggleRestriction(["none"], "vegan"), ["vegan"]);
  assert.deepEqual(toggleRestriction(["vegan", "no_pork"], "none"), ["none"]);
  assert.deepEqual(toggleRestriction(["none"], "none"), []);
});

test("the first save stores exactly what was answered and meets the B2 contract", () => {
  const result = buildNewProfile(answered({
    householdSize: 4, goals: ["other"], otherGoal: "  más energía ", dislikedFoodsText: "setas,  setas, queso azul",
    weeklyTrainingDays: 0, trainingTypes: [],
  }));
  assert.equal(result.ok, true);
  const row = profileToRow(result.profile, {userId: "u1"});
  assert.equal(row.household_size, 4);
  assert.equal(row.sex, "male");
  assert.equal(row.height_cm, 180);
  assert.equal(row.weight_kg, 80);
  assert.deepEqual(row.goals, ["other"]);
  assert.equal(row.goal, "healthy_eating"); // legacy goal derived from goals, never 'other'
  assert.equal(row.other_goal, "más energía");
  assert.equal(row.disliked_foods, "setas, queso azul"); // text, as in B2
  assert.equal(row.weekly_training_days, 0);
  // Training left at 0 days is not an answer; the body data given is.
  assert.deepEqual(row.confirmed_sections, ["household", "goals", "restrictions", "allergies", "body"]);
  const reloaded = profileFromRow({...row, id: "p1"});
  assert.deepEqual(draftFromProfile(reloaded).goals, ["other"]);
  assert.equal(sectionStatus(draftFromProfile(reloaded), reloaded, "restrictions"), "saved");
});

test("height and weight: numeric text with units, ranges from the database", () => {
  assert.equal(parseWholeNumber("175"), 175);
  assert.equal(parseWholeNumber(" 175 cm"), 175);
  assert.equal(parseWholeNumber("80kg"), 80);
  assert.ok(Number.isNaN(parseWholeNumber("72,5")));
  assert.ok(Number.isNaN(parseWholeNumber("abc")));
  assert.deepEqual(fields(buildNewProfile(answered({heightCm: "300", weightKg: "72,5"}))), ["heightCm", "weightKg"]);
  assert.match(buildNewProfile(answered({heightCm: "90"})).issues[0].message, /entre 120 y 230 cm/);
});

test("a saved profile loads as it is, without filling gaps", () => {
  const profile = saved();
  const draft = draftFromProfile(profile);
  assert.equal(draft.householdSize, 3);
  assert.equal(draft.heightCm, "165");
  assert.equal(draft.dislikedFoodsText, "brócoli");
  assert.equal(draft.noAllergies, false);
  assert.ok(profileSections.every(section => sectionStatus(draft, profile, section) === "saved"));
  // Restrictions saved empty by an older form are shown as pending, not as «Ninguna».
  const oldProfile = legacy({dietaryRestrictions: [], allergies: []});
  const oldDraft = draftFromProfile(oldProfile);
  assert.equal(sectionStatus(oldDraft, oldProfile, "restrictions"), "pending");
  assert.equal(oldDraft.noAllergies, true);
  // Legacy goal only.
  assert.deepEqual(draftFromProfile(saved({goals: [], goal: "maintenance"})).goals, ["healthy_eating"]);
});

test("old or broken device copies read as no profile instead of being completed", () => {
  assert.equal(readStoredProfile(null), null);
  assert.equal(readStoredProfile({householdSize: 2}), null);
  assert.equal(readStoredProfile({...saved(), heightCm: "165"}), null);
  assert.equal(readStoredProfile({...saved(), householdSize: undefined}), null);
  assert.equal(readStoredProfile({...saved(), weeklyTrainingDays: 9}), null);
  // Body data may be missing (optional since D2); it reads as null, not as a default.
  assert.equal(readStoredProfile({...saved(), heightCm: undefined, sex: null}).heightCm, null);
  // A copy from before D2 has no confirmations: undefined, so saving it keeps the account's.
  const oldCopy = readStoredProfile({...saved(), confirmedSections: undefined});
  assert.equal(oldCopy.confirmedSections, undefined);
  assert.equal("confirmed_sections" in profileToRow(oldCopy), false);
  assert.deepEqual(readStoredProfile(saved({goals: undefined, goal: "maintenance"})).goals, ["healthy_eating"]);
});

test("saving one section only sends that section; other unsaved edits stay in the form", () => {
  const profile = saved();
  const draft = {...draftFromProfile(profile), householdSize: 5, goals: ["muscle_gain"], heightCm: "999"};
  assert.ok(isSectionDirty(draft, profile, "household"));
  assert.ok(isSectionDirty(draft, profile, "goals"));
  assert.ok(!isSectionDirty(draft, profile, "training"));
  const result = applySection(profile, draft, "household");
  assert.equal(result.ok, true);
  assert.equal(result.profile.householdSize, 5);
  assert.deepEqual(result.profile.goals, ["fat_loss"]); // unsaved goal edit not sent
  assert.equal(result.profile.heightCm, 165); // invalid unsaved body edit not sent
  assert.equal(result.profile.id, "p1");
  const after = resetSections(draft, result.profile, ["household"]);
  assert.equal(sectionStatus(after, result.profile, "household"), "saved");
  assert.deepEqual(after.goals, ["muscle_gain"]);
  assert.equal(sectionStatus(after, result.profile, "goals"), "unsaved");
  // The invalid section reports only its own problems.
  assert.deepEqual(fields(applySection(profile, draft, "body")), ["heightCm"]);
});

test("a section cannot be saved emptied: goals and restrictions stay answered", () => {
  const profile = saved();
  assert.deepEqual(fields(applySection(profile, {...draftFromProfile(profile), goals: []}, "goals")), ["goals"]);
  const cleared = {...draftFromProfile(profile), dietaryRestrictions: [], allergies: [], noAllergies: false};
  assert.deepEqual(fields(applySection(profile, cleared, "restrictions")), ["allergies", "dietaryRestrictions"]);
  assert.deepEqual(fields(applySection(profile, {...draftFromProfile(profile), dislikedFoodsText: "x".repeat(151)}, "restrictions")),
    ["dislikedFoods"]);
});

test("conflict: the remote copy replaces the saved section and keeps edits elsewhere", () => {
  const draft = {...draftFromProfile(saved()), householdSize: 6, weeklyTrainingDays: 5};
  const remote = saved({householdSize: 1});
  const after = resetSections(draft, remote, ["household"]);
  assert.equal(after.householdSize, 1);
  assert.equal(after.weeklyTrainingDays, 5);
  // No remote profile (deleted elsewhere): the section is empty again, not invented.
  assert.equal(resetSections(draft, null, ["household"]).householdSize, null);
});

test("every section explains how it affects the menu; body data says it is not used", () => {
  for (const section of profileSections) assert.ok(profileSectionInfo[section].usage.length > 10);
  assert.match(profileSectionInfo.body.usage, /No se usan/);
  assert.match(profileSectionInfo.restrictions.usage, /obligatorias/);
});

test("profiles of the previous form are «assumed» until each section is confirmed", () => {
  const profile = legacy({dietaryRestrictions: ["none"], allergies: []});
  const draft = draftFromProfile(profile);
  assert.deepEqual(profileSections.map(section => sectionStatus(draft, profile, section)),
    ["assumed", "assumed", "assumed", "assumed", "assumed"]);
  assert.deepEqual(assumedMenuSections(profile), ["household", "goals", "restrictions"]);
  assert.ok(canSaveSection("assumed"));
  assert.ok(!canSaveSection("saved"));
  // Confirming without changes keeps the values and records the confirmation.
  const confirmed = applySection(profile, draft, "restrictions");
  assert.equal(confirmed.ok, true);
  assert.deepEqual(confirmed.profile.dietaryRestrictions, ["none"]);
  assert.deepEqual(confirmed.profile.confirmedSections, ["restrictions", "allergies"]);
  assert.equal(sectionStatus(draft, confirmed.profile, "restrictions"), "saved");
  assert.equal(sectionStatus(draft, confirmed.profile, "goals"), "assumed");
  assert.deepEqual(assumedMenuSections(confirmed.profile), ["household", "goals"]);
  // A legacy profile with nothing in an optional section shows it as optional, not assumed.
  const noTraining = legacy({weeklyTrainingDays: 0, trainingTypes: []});
  assert.equal(sectionStatus(draftFromProfile(noTraining), noTraining, "training"), "optional");
});

test("«Ninguna» allergies is kept as an answer once confirmed, also after reloading", () => {
  const result = buildNewProfile(answered({noAllergies: true}));
  const row = profileToRow(result.profile, {userId: "u1"});
  assert.deepEqual(row.allergies, []);
  assert.ok(row.confirmed_sections.includes("allergies"));
  const reloaded = profileFromRow({...row, id: "p1"});
  const draft = draftFromProfile(reloaded);
  assert.equal(draft.noAllergies, true);
  assert.equal(sectionStatus(draft, reloaded, "restrictions"), "saved");
  assert.deepEqual(assumedMenuSections(reloaded), []);
});

test("onboarding step 2 saves household, goals and restrictions without inventing the rest", () => {
  assert.deepEqual(fields(buildOnboardingProfile(null, emptyProfileDraft())),
    ["allergies", "dietaryRestrictions", "goals", "householdSize"]);
  const draft = {...emptyProfileDraft(), householdSize: 3, goals: ["muscle_gain"], dietaryRestrictions: ["vegan"],
    allergies: ["nuts"], dislikedFoodsText: "setas"};
  const result = buildOnboardingProfile(null, draft);
  assert.equal(result.ok, true);
  const row = profileToRow(result.profile, {userId: "u1"});
  assert.deepEqual([row.sex, row.birth_date, row.height_cm, row.weight_kg], [null, null, null, null]);
  assert.equal(row.weekly_training_days, 0);
  assert.deepEqual(row.training_types, []);
  assert.equal(row.household_size, 3);
  assert.deepEqual(row.confirmed_sections, ["household", "goals", "restrictions", "allergies"]);
  // On top of a saved profile it changes those sections only and keeps the rest.
  const again = buildOnboardingProfile(legacy(), {...draftFromProfile(legacy()), householdSize: 1});
  assert.equal(again.ok, true);
  assert.equal(again.profile.householdSize, 1);
  assert.equal(again.profile.heightCm, 165);
  assert.deepEqual(again.profile.trainingTypes, ["running"]);
  assert.deepEqual(again.profile.confirmedSections, ["household", "goals", "restrictions", "allergies"]);
});
