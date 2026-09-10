const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const root = path.resolve(__dirname, '..');
const req = Module.createRequire(root + '/package.json');
req('dotenv').config({path: root + '/.env.local', quiet: true});
require('./register-typescript.cjs');
const profile = {sex:'male',birthDate:'1990-01-01',heightCm:175,weightKg:75,householdSize:2,weeklyTrainingDays:3,trainingTypes:['strength'],goals:['healthy_eating'],dietaryRestrictions:[],allergies:[],dislikedFoods:[]};
const base = {peopleCount:2,menuStyle:['healthy_balanced'],elaborationLevel:4,pantryItems:['arroz','garbanzos'],recentDishes:[],freeTextPrompt:'',profile};
const cases = [
 {id:'A',body:base},
 {id:'B',body:{...base,profile:{...profile,dietaryRestrictions:['vegetarian'],allergies:['nuts'],dislikedFoods:['berenjena']}}},
 {id:'C',body:{...base,profile:{...profile,dislikedFoods:['pasta','setas']},freeTextPrompt:'Esta semana quiero exactamente dos platos de pasta, uno de ellos espaguetis con setas. El resto variado.'}}
];
const nativeFetch = global.fetch;
let calls = [];
global.fetch = async (url, options) => {
 const start = performance.now();
 const body = JSON.parse(options.body);
 const call = {model:body.model,effort:body.reasoning_effort,inputChars:body.messages?.map(m=>m.content.length),start};
 calls.push(call);
 const response = await nativeFetch(url,options);
 const data = await response.clone().json();
 Object.assign(call,{ms:performance.now()-start,status:response.status,usage:data.usage});
 return response;
};
async function main(){
 const {POST} = req(root + '/src/app/api/generate-menu/route.ts');
 const results=[];
 for(const test of cases.filter(test => !process.env.BENCH_CASE || process.env.BENCH_CASE === test.id)){
  console.log('Starting case', test.id);
  calls=[]; const start=performance.now();
  const response=await POST(new Request('http://localhost/api/generate-menu',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(test.body)}));
  const data=await response.json();
  const result={id:test.id,totalMs:performance.now()-start,status:response.status,calls,data};
  results.push(result);
  fs.writeFileSync(process.argv[2] || path.join(require('node:os').tmpdir(), 'becook-menu-benchmark.json'), JSON.stringify(results,null,2));
  console.log(JSON.stringify(result));
 }
}
main().catch(e=>{console.error(e.name);process.exitCode=1;});
