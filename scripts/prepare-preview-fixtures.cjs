// Prepare private artifacts only. Remote execution is a separate, reviewed MCP step.
// No known/public password is ever valid on the hosted project.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const {sql, verifiedContainer, ROOT} = require('./local-supabase.cjs');
const dir = path.join(ROOT,'.supabase-local/hosted-preview');
verifiedContainer();
fs.mkdirSync(dir,{recursive:true,mode:0o700});
const credentialsPath = path.join(dir,'credentials.json');
if (fs.existsSync(credentialsPath)) throw new Error('Private fixture credentials already exist; no rotation or overwrite allowed');
const users = [1,2].map(n => {
  const password = crypto.randomBytes(32).toString('hex');
  // The password travels through stdin to the verified LOCAL database, never argv/logs.
  const hash = sql("select extensions.crypt('" + password + "',extensions.gen_salt('bf'));").trim();
  if (!hash.startsWith('$2')) throw new Error('Password hash generation failed');
  return {id:'00000000-0000-4000-8000-00000000000'+n,email:'fixture-'+n+'@example.invalid',password,hash};
});
fs.writeFileSync(credentialsPath,JSON.stringify({project:'qdhpdhnpcsfhmygjofqb',users}),{mode:0o600,flag:'wx'});
let seed = fs.readFileSync(path.join(ROOT,'supabase/seed.sql'),'utf8');
seed = seed.slice(seed.indexOf('INSERT INTO auth.users'));
seed = seed.replace("extensions.crypt('Local-fixture-only-2026!', extensions.gen_salt('bf'))", "CASE n WHEN 1 THEN '"+users[0].hash+"' ELSE '"+users[1].hash+"' END");
// Refuse collisions rather than silently attaching synthetic data to an existing user.
const guard = `BEGIN;
DO $$ BEGIN
 IF EXISTS (SELECT FROM auth.users) OR EXISTS (SELECT FROM public.profiles)
 OR EXISTS (SELECT FROM public.weeks) OR EXISTS (SELECT FROM public.week_days)
 OR EXISTS (SELECT FROM public.shopping_lists) OR EXISTS (SELECT FROM public.shopping_items)
 OR EXISTS (SELECT FROM public.menu_generation_requests) OR EXISTS (SELECT FROM public.pantry_items)
 THEN RAISE EXCEPTION 'Hosted fixtures require empty users and application tables'; END IF;
 IF (SELECT count(*) FROM pg_constraint WHERE connamespace='public'::regnamespace
 AND conname LIKE '%_owner_fkey' AND convalidated) <> 6
 THEN RAISE EXCEPTION 'Ownership migration required'; END IF;
END $$;
`;
fs.writeFileSync(path.join(dir,'seed-private.sql'),guard+seed,{mode:0o600,flag:'wx'});
console.log('Prepared fictional fixture SQL and random credentials in ignored private directory. No remote writes.');
