// Exercise the real local workerd runtime and SQLite-backed Durable Object.
// All outbound traffic is intercepted; no upstream account or credentials required.
import {Miniflare,convertV4MiniflareOptions} from 'miniflare';
import {readFileSync} from 'node:fs';
import assert from 'node:assert/strict';
import {codeHash} from './worker.mjs';
const invite='coco_'+'fixture'.repeat(4);
let forwarded=0;
const script=readFileSync(new URL('./worker.mjs',import.meta.url),'utf8');
const mf=new Miniflare(convertV4MiniflareOptions({cf:false,modules:true,script,
  compatibilityDate:'2026-10-01',durableObjects:{QUOTA:{className:'Quota',useSQLite:true}},
  bindings:{GEMINI_API_KEY:'fixture-upstream',COCO_CODE_HASHES:await codeHash(invite)},
  outboundService:async req=>{
    assert.equal(new URL(req.url).hostname,'generativelanguage.googleapis.com');
    assert.equal(req.headers.get('Authorization'),'Bearer fixture-upstream');forwarded++;
    return Response.json({choices:[{message:{content:'收到'}}]});
  }}));
try{
  const statuses=await Promise.all(Array.from({length:8},async()=>{
    const res=await mf.dispatchFetch('https://relay.invalid/v1/chat/completions',{method:'POST',
      headers:{Authorization:'Bearer '+invite},body:JSON.stringify({messages:[{role:'system',content:'Coco'},{role:'user',content:'你好'}]})});
    await res.text();return res.status;
  }));
  assert.deepEqual(statuses.sort(),[200,200,200,200,429,429,429,429]);assert.equal(forwarded,4);
  console.log('PASS workerd + Durable Object: 8 concurrent requests, 4 forwarded and 4 limited');
}finally{await mf.dispose();}
