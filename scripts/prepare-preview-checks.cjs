// Offline SQL probe generator. Execute only after verifying becook-preview via MCP.
const fs = require('node:fs');
const path = require('node:path');
const {probeSql,fingerprintSql} = require('./db-test-probe.cjs');
const id=(prefix,n)=>prefix+'0000000-0000-4000-8000-00000000000'+n;
const fixtureId=(p,n)=>['5','7'].includes(p)?p+'0000000-0000-4000-8000-0000000000'+n+'1':id(p,n);
const relations=[['weeks','profile_id','2','1'],['weeks','generation_request_id','2','6'],['pantry_items','profile_id','7','1'],['menu_generation_requests','profile_id','6','1'],['menu_generation_requests','created_week_id','6','2'],['profiles','active_week_id','1','2']];
const tables=[['profiles','1'],['weeks','2'],['week_days','3'],['shopping_lists','4'],['shopping_items','5'],['menu_generation_requests','6'],['pantry_items','7']];
const q=s=>"'"+s.replaceAll("'","''")+"'";
let sql='-- Authorized test project only: qdhpdhnpcsfhmygjofqb. Never production.\nBEGIN;\nSET LOCAL statement_timeout=\'60s\';\n'+probeSql+`
CREATE TEMP TABLE preview_checks(label text, passed boolean);
CREATE TEMP TABLE initial_state AS ${fingerprintSql};
GRANT SELECT, INSERT ON preview_checks TO authenticated, anon;
`;
function check(label,condition){sql+='INSERT INTO preview_checks VALUES ('+q(label)+',('+condition+'));\n';}
function probe(label,statement,expected,verification=null){
  sql+='INSERT INTO preview_checks SELECT '+q(label)+", (r->>'outcome')="+q(expected)+" AND (r->>'unchanged')::boolean FROM (SELECT pg_temp.probe("+q(statement)+','+(verification?q(verification):'NULL')+') AS r) p;\n';
}
for(const n of [1,2]){
  sql+="SET LOCAL ROLE authenticated; SELECT set_config('request.jwt.claims',"+q(JSON.stringify({sub:id('0',n),role:'authenticated'})) +",true);\n";
  check('identity '+n,"current_user='authenticated' AND auth.uid()="+q(id('0',n))+'::uuid');
  for(const [t,p] of tables){
    check(n+' reads own '+t,'SELECT count(*)=1 FROM public.'+t+' WHERE id='+q(fixtureId(p,n)));
    check(n+' cannot read other '+t,'SELECT count(*)=0 FROM public.'+t+' WHERE id='+q(fixtureId(p,3-n)));
    sql+='WITH changed AS (UPDATE public.'+t+' SET id=id WHERE id='+q(fixtureId(p,3-n))+' RETURNING id) INSERT INTO preview_checks SELECT '+q(n+' cannot update other '+t)+',count(*)=0 FROM changed;\n';
  }
  for(const [t,col,p,parent] of relations){
    const own=fixtureId(p,n),where=' WHERE id='+q(own),label=n+' '+t+'.'+col;
    const verify=(row,v)=>'SELECT count(*)=1 FROM public.'+t+' WHERE id='+q(row)+' AND user_id='+q(id('0',n))+' AND '+col+(v==='NULL'?' IS NULL':'='+v);
    for(const [kind,value,outcome] of [['own',q(id(parent,n)),'accepted'],['null','NULL','accepted'],['missing',q('ffffffff-ffff-4fff-8fff-ffffffffffff'),'constraint:23503'],['foreign',q(id(parent,3-n)),'constraint:23503']]){
      probe(label+' UPDATE '+kind,'UPDATE public.'+t+' SET '+col+'=NULL'+where+'; UPDATE public.'+t+' SET '+col+'='+value+where,outcome,outcome==='accepted'?verify(own,value):null);
      // Synthetic profile is removed/recreated ONLY inside the probe subtransaction;
      // both success and failure roll back. No persistent deletion or existing real data.
      const clone='CREATE TEMP TABLE insert_fixture AS SELECT * FROM public.'+t+where+';';
      const remove=t==='profiles'?'DELETE FROM public.profiles'+where+';':'';
      const calendar=t==='weeks'?",'iso_year',NULL,'iso_week',NULL":'';
      const insert='INSERT INTO public.'+t+' SELECT (jsonb_populate_record(NULL::public.'+t+",to_jsonb(r)||jsonb_build_object('id',"+q(id('8',n))+','+q(col)+','+value+calendar+'))).* FROM insert_fixture r;';
      probe(label+' INSERT '+kind,clone+remove+insert,outcome,outcome==='accepted'?verify(id('8',n),value):null);
    }
    probe(label+' forge owner','UPDATE public.'+t+' SET user_id='+q(id('0',3-n))+','+col+'='+q(id(parent,3-n))+where,'rls:42501');
  }
  sql+='RESET ROLE;\n';
}
sql+="SET LOCAL ROLE anon; SELECT set_config('request.jwt.claims','{}',true);\n";
for(const [t] of tables)check('anon '+t,'SELECT count(*)=0 FROM public.'+t);
sql+='RESET ROLE;\n';
check('all users fixtures unchanged','('+fingerprintSql+')=(SELECT md5 FROM initial_state)');
sql+="SELECT count(*) FILTER (WHERE passed) AS passed, count(*) FILTER (WHERE passed IS DISTINCT FROM true) AS failed, coalesce(json_agg(label) FILTER (WHERE passed IS DISTINCT FROM true),'[]') AS failed_checks FROM preview_checks;\nROLLBACK;\n";
const output=path.join(__dirname,'../.supabase-local/hosted-preview');
fs.mkdirSync(output,{recursive:true,mode:0o700});
fs.writeFileSync(path.join(output,'security-checks.sql'),sql,{mode:0o600});
console.log('Generated hosted SQL checks offline. All probes and temporary objects roll back.');
