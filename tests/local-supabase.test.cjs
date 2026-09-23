const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const { ROOT, PROJECT, assertEndpoint, assertContainer, safeEnv } = require("../scripts/local-supabase.cjs");
test("remote and ambiguous Docker targets are rejected, irrespective of TEST_DATABASE_URL", () => {
  for (const endpoint of ["tcp://127.0.0.1:2375","ssh://host","unix:///tmp/proxy.sock","https://production.example",""]) assert.throws(() => assertEndpoint(endpoint));
  assert.doesNotThrow(() => assertEndpoint("unix:///var/run/docker.sock"));
});
test("local database identity requires name, label, running state and Postgres image", () => {
  const info = {Name:"/supabase_db_" + PROJECT,State:{Running:true},Config:{Image:"public.ecr.aws/supabase/postgres:17.6.1",Labels:{"com.supabase.cli.project":PROJECT}}};
  assert.doesNotThrow(() => assertContainer(info));
  for(const broken of [{...info,Name:"/other"},{...info,State:{Running:false}},{...info,Config:{...info.Config,Labels:{}}},{...info,Config:{...info.Config,Image:"postgres:17"}}]) assert.throws(() => assertContainer(broken));
});
test("provider credentials and target overrides are never inherited by local tooling", () => {
  for(const name of ["DATABASE_URL","TEST_DATABASE_URL","SUPABASE_ACCESS_TOKEN","SUPABASE_SERVICE_ROLE_KEY","NEXT_PUBLIC_SUPABASE_URL","OPENAI_API_KEY","DOCKER_HOST"]) assert.equal(safeEnv()[name],undefined);
});
test("every historical Supabase probe is disabled before loading environment or application code", () => {
  for (const file of fs.readdirSync(path.join(ROOT,"scripts")).filter(f => /^test-.*\.ts$/.test(f))) {
    const source=fs.readFileSync(path.join(ROOT,"scripts",file),"utf8");
    assert.ok(source.startsWith('import "./legacy-supabase-disabled";'),file);
    assert.ok(!source.includes("dotenv.config"),file);
  }
});
test("legacy write probe fails before network even with a production-shaped URL", () => {
  const result = spawnSync(process.execPath, ["--require", "./scripts/register-typescript.cjs", "-e",
    'global.fetch=()=>{process.exit(98)};require("./scripts/test-supabase-week.ts")'],
    {cwd:ROOT,encoding:"utf8",env:{...process.env,NEXT_PUBLIC_SUPABASE_URL:"https://production.example.invalid",NEXT_PUBLIC_SUPABASE_ANON_KEY:"synthetic"}});
  assert.equal(result.status,1);
  assert.ok(result.stderr.includes("Legacy Supabase probe disabled"));
});
test("reset rejects target overrides before reaching Docker", () => {
  for (const flag of ["--linked","--db-url","--project-ref"]) {
    const result=spawnSync(process.execPath,["scripts/local-supabase.cjs","reset",flag],{cwd:ROOT,encoding:"utf8"});
    assert.equal(result.status,1);
    assert.ok(result.stderr.includes("Exactly one local command is required"));
  }
});
