const {test} = require("node:test");
const assert = require("node:assert/strict");
const OpenAI = require("openai").default;
const {readMenuProfile, buildMenuInput} = require("../src/lib/menu-generation/prompt.ts");
const {selectionToMenu, visibleFoodConflict, dayNames} = require("../src/lib/menu-generation/validation.ts");
const {createMenuCompletion} = require("../src/lib/menu-generation/runtime.ts");
const {isImportedMenuResponse, importedMenuToWeekDays} = require("../src/lib/importMenu.ts");
const {weekDaysToSupabaseWeek, withWeekDates} = require("../src/lib/weekStorage.ts");
const {estimateOpenAICostUsd} = require("../src/lib/openai/cost.ts");
const profile = readMenuProfile(null);
const selection = {
 lunches: ["Pollo asado con batata", "Lentejas estofadas", "Arroz meloso de sepia", "Espaguetis con setas", "Garbanzos con espinacas", "Merluza al horno", "Paella de pollo"],
 dinners: ["Tortilla de patata", "Ensalada de tomate y queso fresco", "Salmón a la plancha", "Crema de calabaza", "Revuelto de champiñones", "Bacalao al pilpil", "Tosta de aguacate"],
};
test("maps exactly seven ordered days and planned slots into existing storage contract", () => {
 const menu = selectionToMenu(selection, profile);
 assert.ok(isImportedMenuResponse(menu));
 assert.deepEqual(menu.days.map(d => d.dayName), dayNames);
 assert.equal(weekDaysToSupabaseWeek(withWeekDates(importedMenuToWeekDays(menu.days), {isoYear:2026,isoWeek:38})).days.length, 7);
 assert.equal(menu.days[6].dinner.status, "planned");
});
test("rejects incomplete, blank, duplicate and generic output", () => {
 for(const value of [null, {lunches:[],dinners:[]}, {...selection,lunches:["",...selection.lunches.slice(1)]}, {...selection,lunches:[selection.dinners[0],...selection.lunches.slice(1)]}, {...selection,lunches:["Pescado con verduras",...selection.lunches.slice(1)]}]) assert.throws(() => selectionToMenu(value,profile));
 assert.throws(() => selectionToMenu({...selection,lunches:[" SALMÓN A LA PLANCHA ",...selection.lunches.slice(1)]},profile), /duplicate/);
});
test("blocks visible dietary/allergen conflicts including accents and compound dishes", () => {
 for (const [key, restriction, dish] of [["allergies","nuts","Espaguetis al pesto"],["allergies","shellfish","Arroz de gambas"],["allergies","egg","Tortilla de patata"],["allergies","lactose","Ensalada con feta"],["allergies","gluten","Tosta de tomate"],["dietaryRestrictions","vegan","Crema con nata"],["dietaryRestrictions","vegetarian","Espaguetis a la boloñesa"],["dietaryRestrictions","pescatarian","Pollo al limón"],["dietaryRestrictions","no_pork","Alcachofas con jamón"],["dietaryRestrictions","no_alcohol","Pollo al vino"]]) assert.ok(visibleFoodConflict(dish, readMenuProfile({[key]:[restriction]})),dish);
 assert.equal(visibleFoodConflict("Garbanzos con espinacas",readMenuProfile({dietaryRestrictions:["vegan"]})), false);
 assert.throws(() => selectionToMenu(selection,readMenuProfile({dietaryRestrictions:["vegetarian"]})), /restriction/);
});
test("keeps weekly requests and safety constraints distinct; filters examples without claiming ingredient safety", () => {
 const input = buildMenuInput({peopleCount:2,freeTextPrompt:"Quiero pasta con setas",profile:{id:"private-id",birthDate:"1990-01-01",dislikedFoods:["pasta"],allergies:["nuts"],otherAllergies:"sésamo"}});
 const data = JSON.parse(input.userPrompt);
 assert.equal(data.weeklyRequest,"Quiero pasta con setas");
 assert.deepEqual(data.preferences.dislikedFoods,["pasta"]);
 assert.equal(data.mandatory.otherAllergies,"sésamo");
 assert.ok(data.nutritionistExamples.every(n => !/pesto/.test(n)));
 assert.ok(!input.userPrompt.includes("private-id"));
 assert.throws(() => readMenuProfile({allergies:"nuts"}));
 assert.throws(() => readMenuProfile({otherAllergies:"a".repeat(1001)}));
 assert.throws(() => buildMenuInput({peopleCount:7}));
});
test("cost includes cache reads and cache write surcharge at current standard prices", () => {
 assert.equal(estimateOpenAICostUsd({model:"gpt-5.6-sol",promptTokens:2000,cachedPromptTokens:1000,cacheWriteTokens:1000,completionTokens:100}),0.0074);
 assert.equal(estimateOpenAICostUsd({model:"unknown",promptTokens:1,completionTokens:1}),null);
});
test("transport: one call normally, one fallback on 503, none on 429/400; SDK retries disabled", async () => {
 for(const statuses of [[200],[503,200],[429],[400],[503,503]]) {
  let count=0; const attempts=[];
  const client = new OpenAI({apiKey:"synthetic-test-key",maxRetries:0,fetch:async (_url, options) => {
   const body=JSON.parse(options.body);
   assert.equal(body.reasoning_effort,"none");
   assert.equal(body.max_completion_tokens,1200);
   const status=statuses[count++];
   assert.ok(status,"unexpected retry");
   return new Response(JSON.stringify(status===200 ? {choices:[],usage:{}} : {error:{message:"synthetic",code:"test"}}),{status,headers:{"Content-Type":"application/json"}});
  }});
  if(statuses.at(-1)===200) await createMenuCompletion(client,"synthetic",attempts);
  else await assert.rejects(createMenuCompletion(client,"synthetic",attempts));
  assert.equal(count,statuses.length);
  assert.equal(attempts.length,statuses.length);
 }
});
test("HTTP route rejects invalid input before billing and invalid output without regeneration", async () => {
 const previousEnv = {OPENAI_API_KEY: process.env.OPENAI_API_KEY, NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY};
 const previousFetch = global.fetch;
 process.env.OPENAI_API_KEY = "synthetic-test-key";
 process.env.NEXT_PUBLIC_SUPABASE_URL = "http://supabase.test";
 process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "synthetic-anon-key";
 let calls = 0;
 let responseSelection = selection;
 global.fetch = async (url) => {
  // Synthetic verified session (A3): the route only bills after Auth accepts the token.
  if (String(url).startsWith("http://supabase.test/auth/v1/user")) return Response.json({id:"00000000-0000-4000-8000-000000000001",aud:"authenticated",role:"authenticated",app_metadata:{},user_metadata:{},created_at:"2026-01-01T00:00:00Z"});
  calls++;
  return Response.json({choices:[{finish_reason:"stop",message:{content:JSON.stringify(responseSelection)}}],usage:{prompt_tokens:100,completion_tokens:100,total_tokens:200}});
 };
 try {
  const {POST} = require("../src/app/api/generate-menu/route.ts");
  const request = body => new Request("http://localhost/api/generate-menu",{method:"POST",headers:{"content-type":"application/json",authorization:"Bearer header.synthetic-valid.signature"},body:JSON.stringify(body)});
  assert.equal((await POST(request({peopleCount:8}))).status,400);
  assert.equal((await POST(request({peopleCount:2,profile:{allergies:"nuts"}}))).status,400);
  assert.equal(calls,0);
  const success = await POST(request({peopleCount:2}));
  assert.equal(success.status,200);
  assert.ok(success.headers.get("Server-Timing"));
  assert.equal((await success.json()).days.length,7);
  responseSelection = {...selection,lunches:[]};
  assert.equal((await POST(request({peopleCount:2}))).status,422);
  assert.equal(calls,2);
  responseSelection = selection;
  assert.equal((await POST(request({peopleCount:2,profile:{dietaryRestrictions:["vegetarian"]}}))).status,422);
  assert.equal(calls,3);
 } finally {
  global.fetch = previousFetch;
  for (const [key, value] of Object.entries(previousEnv)) {
   if(value === undefined) delete process.env[key];
   else process.env[key] = value;
  }
 }
});
