// Read-only comparison of a metadata export obtained from the verified test project.
const fs=require('node:fs');
const path=require('node:path');
const assert=require('node:assert/strict');
const root=path.resolve(__dirname,'..');
function verify(actual){
  const expected=JSON.parse(fs.readFileSync(path.join(root,'supabase/baseline/remote-metadata.json'),'utf8'));
  const delta=JSON.parse(fs.readFileSync(path.join(root,'supabase/expectations/20260923194029_enforce_reference_ownership.json'),'utf8'));
  for(const key of ['constraints','indexes'])expected[key].push(...delta[key]);
  expected.grants=expected.grants.filter(g=>!(['anon','authenticated','service_role'].includes(g.grantee)&&['TRUNCATE','REFERENCES','TRIGGER'].includes(g.privilege_type)));
  // PostgreSQL 17.6 deparses this associative AND with one fewer pair of brackets.
  // Accept exactly the observed equivalent form, not arbitrary normalization/differences.
  const equivalent="CHECK ((((iso_year IS NULL) AND (iso_week IS NULL)) OR ((iso_year >= 2000) AND (iso_year <= 2100) AND ((iso_week >= 1) AND (iso_week <= 53)))))";
  const canonical=expected.constraints.find(c=>c.conname==='weeks_iso_week_range_chk').definition;
  const copy=structuredClone(actual);
  for(const c of copy.constraints)if(c.conname==='weeks_iso_week_range_chk'&&c.definition===equivalent)c.definition=canonical;
  const sorted=rows=>(rows||[]).map(r=>JSON.stringify(r)).sort();
  for(const key of ['columns','tables','constraints','indexes','policies','triggers','grants','other_relations','enums'])assert.deepEqual(sorted(copy[key]),sorted(expected[key]),key);
  // The platform's rls_auto_enable remains owned/managed by Supabase.
  assert.deepEqual(sorted(copy.functions.filter(f=>f.proname!=='rls_auto_enable')),sorted(expected.functions.filter(f=>f.proname!=='rls_auto_enable')));
}
if(require.main===module){
  try{verify(JSON.parse(fs.readFileSync(path.join(root,'.supabase-local/hosted-preview/metadata.json'),'utf8')));console.log('Hosted application metadata matches baseline + integrity migration + explicit grant restriction.');}
  catch{console.error('Hosted metadata mismatch or missing export. Details suppressed.');process.exitCode=1;}
}
module.exports={verify};
