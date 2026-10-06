const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {buildBootstrap} = require('../scripts/prepare-hosted-preview.cjs');
test('applied hosted migration sources retain their recorded hashes',()=>{
  const {createHash}=require('node:crypto');
  const manifest=require('../supabase/hosted/applied-preview.json');
  assert.equal(manifest.project,'qdhpdhnpcsfhmygjofqb');
  for(const migration of manifest.migrations){
    const content=fs.readFileSync(path.join(__dirname,'..',migration.source));
    assert.equal(createHash('sha256').update(content).digest('hex'),migration.sha256);
  }
});
test('hosted bootstrap is reproducible and excludes local/platform objects', () => {
  const sql = buildBootstrap();
  assert.equal(sql, fs.readFileSync(path.join(__dirname,'../supabase/hosted/20260924000100_preview_bootstrap.sql'),'utf8'));
  assert.match(sql, /Baseline requires an empty public schema/);
  assert.doesNotMatch(sql, /becook_local|rls_auto_enable|ensure_rls|CREATE OR REPLACE|INSERT INTO auth/);
  assert.doesNotMatch(sql, /GRANT (TRUNCATE|REFERENCES|TRIGGER).*TO "(anon|authenticated|service_role)"/);
  assert.equal((sql.match(/ENABLE ROW LEVEL SECURITY/g)||[]).length,7);
});
test('hosted metadata comparison continues to reject unexpected RLS and constraint drift',()=>{
  const {verify}=require('../scripts/verify-preview-metadata.cjs');
  const baseline=JSON.parse(fs.readFileSync(path.join(__dirname,'../supabase/baseline/remote-metadata.json'),'utf8'));
  const delta=JSON.parse(fs.readFileSync(path.join(__dirname,'../supabase/expectations/20260923194029_enforce_reference_ownership.json'),'utf8'));
  for(const k of ['constraints','indexes'])baseline[k].push(...delta[k]);
  baseline.grants=baseline.grants.filter(g=>!(['anon','authenticated','service_role'].includes(g.grantee)&&['TRUNCATE','REFERENCES','TRIGGER'].includes(g.privilege_type)));
  verify(baseline);
  const policyDrift=structuredClone(baseline);policyDrift.policies[0].qual='true';
  assert.throws(()=>verify(policyDrift));
  const constraintDrift=structuredClone(baseline);constraintDrift.constraints.pop();
  assert.throws(()=>verify(constraintDrift));
});
