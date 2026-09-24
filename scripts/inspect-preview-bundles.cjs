// Read only: inspect public HTML/JS, never query Supabase or invoke application APIs.
const targets=['https://becook-git-audit-opt-sikorsky1991.vercel.app','https://be-cook-git-audit-opt-sikorsky1991.vercel.app'];
async function inspect(origin){
  const response=await fetch(origin,{redirect:'manual'});
  if(response.status!==200){console.log(JSON.stringify({origin,status:response.status,verified:false}));process.exitCode=1;return;}
  const html=await response.text();
  const assets=[...new Set([...html.matchAll(/<script[^>]+src="([^"]+)"/g)].map(m=>m[1]))];
  const hosts=new Set(),refs=new Set(),roles=new Set();
  for(const asset of assets){
    const url=new URL(asset,origin);
    if(url.origin!==origin||!url.pathname.startsWith('/_next/'))continue;
    const res=await fetch(url,{redirect:'error'});if(!res.ok)throw new Error('Asset unavailable');
    const js=await res.text();
    for(const match of js.matchAll(/https:\/\/([a-z]{20}\.supabase\.co)/g))hosts.add(match[1]);
    for(const match of js.matchAll(/eyJ[A-Za-z0-9_-]+\.eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g)){
      try {const data=JSON.parse(Buffer.from(match[0].split('.')[1],'base64url').toString());if(data.ref)refs.add(data.ref);if(data.role)roles.add(data.role);}catch{}
    }
  }
  const expected='qdhpdhnpcsfhmygjofqb.supabase.co';
  const matches=hosts.size===1&&hosts.has(expected)&&[...refs].every(r=>r==='qdhpdhnpcsfhmygjofqb');
  console.log(JSON.stringify({origin,assets:assets.length,supabaseHosts:[...hosts],legacyKeyProjectRefs:[...refs],legacyKeyRoles:[...roles],publicBundleUsesOnlyPreview:matches}));
  if(!matches)process.exitCode=1;
}
(async()=>{for(const origin of targets)await inspect(origin);})().catch(()=>{console.error('Could not verify public Preview bundles. No credentials logged.');process.exitCode=1;});
