// Manual hosted integration only. Not an npm/CI target. No .env loading or arbitrary URL.
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const {randomUUID} = require('node:crypto');
const {createClient} = require('@supabase/supabase-js');
const root = path.resolve(__dirname,'..');
const dir = path.join(root,'.supabase-local/hosted-preview');
const PROJECT = 'qdhpdhnpcsfhmygjofqb';
const id = (prefix,n) => prefix+'0000000-0000-4000-8000-00000000000'+n;
async function main() {
  assert.equal(process.argv.length,2);
  const {url,key} = JSON.parse(fs.readFileSync(path.join(dir,'api.json'),'utf8'));
  const credentials = JSON.parse(fs.readFileSync(path.join(dir,'credentials.json'),'utf8'));
  assert.equal(url,'https://'+PROJECT+'.supabase.co');
  assert.equal(credentials.project,PROJECT);
  assert.equal(credentials.users.length,2);
  for(const [i,user] of credentials.users.entries()) {
    assert.equal(user.id,id('0',i+1));
    assert.equal(user.email,'fixture-'+(i+1)+'@example.invalid');
  }
  assert.match(key,/^sb_publishable_/); // Never accept a privileged/secret key.
  const restrictedFetch = (input,init) => {
    const target = new URL(typeof input==='string'?input:input.url);
    assert.equal(target.origin,url);
    return fetch(input,{...init,redirect:'error'});
  };
  process.env.NEXT_PUBLIC_SUPABASE_URL=url;
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY=key;
  require('./register-typescript.cjs');
  const {supabase} = require('../src/lib/supabase/client.ts');
  let passed=0;
  for (const [i,user] of credentials.users.entries()) {
    const n=i+1;
    const client=createClient(url,key,{auth:{persistSession:false,autoRefreshToken:false},global:{fetch:restrictedFetch}});
    const auth=await client.auth.signInWithPassword({email:user.email,password:user.password});
    assert.equal(auth.error,null); assert.equal(auth.data.user.id,user.id);
    assert.equal(auth.data.user.role,'authenticated');
    const verified=await client.auth.getUser();
    assert.equal(verified.error,null); assert.equal(verified.data.user.id,id('0',n)); passed++;
    for (const [table,prefix] of [['profiles','1'],['weeks','2'],['week_days','3'],['shopping_lists','4'],['shopping_items','5'],['menu_generation_requests','6'],['pantry_items','7']]) {
      const fixtureId=m=>['5','7'].includes(prefix)?prefix+'0000000-0000-4000-8000-0000000000'+m+'1':id(prefix,m);
      const own=await client.from(table).select('id').eq('id',fixtureId(n));
      const other=await client.from(table).select('id').eq('id',fixtureId(3-n));
      assert.equal(own.error,null); assert.equal(own.data.length,1);
      assert.equal(other.error,null); assert.equal(other.data.length,0); passed+=2;
    }
    for (const [table,column,prefix,parent] of [['weeks','profile_id','2','1'],['weeks','generation_request_id','2','6'],['pantry_items','profile_id','7','1'],['menu_generation_requests','profile_id','6','1'],['menu_generation_requests','created_week_id','6','2'],['profiles','active_week_id','1','2']]) {
      const rowId=prefix==='7'?'70000000-0000-4000-8000-0000000000'+n+'1':id(prefix,n);
      const before=await client.from(table).select('*').eq('id',rowId).single();
      assert.equal(before.error,null);
      const denied=await client.from(table).update({[column]:id(parent,3-n)}).eq('id',rowId);
      assert.equal(denied.error?.code,'23503');
      const after=await client.from(table).select('*').eq('id',rowId).single();
      assert.equal(after.error,null); assert.deepEqual(after.data,before.data); passed++;
    }
    // CRUD on a fresh synthetic row only. Never delete or replace seed/existing data.
    const scratch=randomUUID();
    let created=false;
    try {
      const insert=await client.from('weeks').insert({id:scratch,user_id:user.id,profile_id:id('1',n),generation_request_id:id('6',n),title:'Temporary synthetic API probe'}).select('id').single();
      assert.equal(insert.error,null); assert.equal(insert.data.id,scratch); created=true; passed++;
      const update=await client.from('weeks').update({title:'Updated synthetic API probe',generation_request_id:null}).eq('id',scratch).eq('user_id',user.id).select('title,generation_request_id').single();
      assert.equal(update.error,null); assert.equal(update.data.title,'Updated synthetic API probe'); assert.equal(update.data.generation_request_id,null); passed++;
    } finally {
      if(created){
        const cleanup=await client.from('weeks').delete().eq('id',scratch).eq('user_id',user.id).select('id');
        assert.equal(cleanup.error,null); assert.equal(cleanup.data.length,1); passed++;
      }
    }
    await supabase.auth.setSession({access_token:auth.data.session.access_token,refresh_token:auth.data.session.refresh_token});
    const week=await require('../src/lib/supabase/weeks.ts').getLatestWeekFromSupabase();
    assert.equal(week.title,'Semana sintética '+n); passed++;
    const profile=await require('../src/lib/supabase/profiles.ts').getLatestProfileFromSupabase();
    assert.equal(profile.id,id('1',n)); passed++;
    const pantry=await require('../src/lib/supabase/pantry.ts').getLatestPantryItemsFromSupabase(id('1',n));
    assert.equal(pantry.length,2); passed++;
    const shopping=await require('../src/lib/supabase/shopping-lists.ts').getLatestShoppingListForWeekFromSupabase(id('2',n));
    assert.equal(shopping.items.length,2); passed++;
    await client.auth.signOut({scope:'local'});
  }
  await supabase.auth.signOut({scope:'local'});
  const anon=createClient(url,key,{auth:{persistSession:false},global:{fetch:restrictedFetch}});
  for(const table of ['profiles','weeks','week_days','shopping_lists','shopping_items','menu_generation_requests','pantry_items']) {
    const result=await anon.from(table).select('id');
    assert.equal(result.error,null); assert.equal(result.data.length,0); passed++;
  }
  console.log(passed+' hosted Auth/API/application checks passed. Target: '+PROJECT+'. No AI calls.');
}
main().catch(()=>{console.error('Hosted checks failed; credentials and row contents suppressed.');process.exitCode=1;});
