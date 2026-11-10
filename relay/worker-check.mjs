import test from 'node:test';
import assert from 'node:assert/strict';
import {handleChat,codeHash,Quota,reserve} from './worker.mjs';
const invite='coco_'+'fake'.repeat(7), hash=await codeHash(invite);
const body={model:'untrusted',messages:[{role:'system',content:'Coco'},{role:'user',content:'你好'}]};
function request(code=invite,data=body){return new Request('https://relay.invalid/v1/chat/completions',{
  method:'POST',headers:{Authorization:'Bearer '+code},body:JSON.stringify(data) });}
function setup(){
  const data=new Map();
  const quota=new Quota({storage:{transaction:fn=>fn({get:k=>data.get(k),put:(k,v)=>data.set(k,v)})}});
  return {GEMINI_API_KEY:'upstream-test',COCO_CODE_HASHES:hash,QUOTA:{idFromName:n=>n,get:()=>({fetch:(u,i)=>quota.fetch(new Request(u,i))})}};
}
test('拒绝无权限、撤销、错误路径和超长请求，不触发上游',async()=>{
  const env=setup();let calls=0;const f=()=>{calls++;throw new Error();};
  assert.equal((await handleChat(request(''),env,f)).status,401);
  assert.equal((await handleChat(request('coco_'+'other'.repeat(6)),env,f)).status,403);
  assert.equal((await handleChat(request(invite,{messages:[...body.messages,{role:'user',content:'x'.repeat(40000)}]}),env,f)).status,400);
  assert.equal((await handleChat(new Request('https://relay.invalid/'),env,f)).status,404);
  env.COCO_CODE_HASHES='revoked';assert.equal((await handleChat(request(),env,f)).status,403);
  assert.equal(calls,0);
});
test('固定上游和模型、去除工具与凭据、脱敏上游错误',async()=>{
  const env=setup();const out=await handleChat(request(invite,{...body,tools:[{}],max_tokens:99999}),env,async(u,i)=>{
    assert.equal(u,'https://generativelanguage.googleapis.com/v1beta/openai/chat/completions');
    assert.equal(i.headers.Authorization,'Bearer upstream-test');assert.ok(!i.body.includes(invite));
    const b=JSON.parse(i.body);assert.equal(b.model,'gemini-flash-lite-latest');assert.equal(b.max_tokens,512);assert.ok(!b.tools);
    return Response.json({private:'secret',choices:[{message:{content:'收到'}}]});
  });
  assert.deepEqual(await out.json(),{choices:[{message:{role:'assistant',content:'收到'}}]});
  const bad=await handleChat(request(),env,async()=>new Response('private upstream details',{status:401}));
  assert.equal(bad.status,502);assert.ok(!(await bad.text()).includes('private'));
});
test('按访问码与全站共享限额，拒绝的请求不触达模型，窗口到期后恢复',async()=>{
  const env=setup();let calls=0;const f=async()=>{calls++;return Response.json({choices:[{message:{content:'好'}}]});};
  for(let i=0;i<4;i++)assert.equal((await handleChat(request(),env,f)).status,200);
  const stop=await handleChat(request(),env,f);assert.equal(stop.status,429);assert.ok(Number(stop.headers.get('Retry-After'))>0);assert.equal(calls,4);
  const limits={day:2,person:1,minute:2,personMinute:1},one=reserve([],'a',1000,limits).entries;
  assert.ok(reserve(one,'a',61001,limits).wait);
  const both=reserve(one,'b',61001,limits).entries;assert.ok(reserve(both,'c',62000,limits).wait);
  assert.ok(reserve(both,'c',86401000,limits).entries);
});
