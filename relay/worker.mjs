// Only the Worker has the upstream credential. The client cannot change the
// destination, model, tools, candidate count, generation settings or headers.
const upstream='https://generativelanguage.googleapis.com/v1beta/openai/chat/completions';
const model='gemini-flash-lite-latest';
const response=(status,body={},headers={})=>Response.json(body,{status,headers:{'Cache-Control':'no-store',...headers}});
export async function codeHash(code){
  const digest=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(code));
  return Array.from(new Uint8Array(digest),v=>v.toString(16).padStart(2,'0')).join('');
}
async function limitedJson(stream,max){
  if(!stream)throw new Error();
  const reader=stream.getReader(), decoder=new TextDecoder();let count=0,text='';
  try{while(true){
    const {value,done}=await reader.read();if(done)break;
    count+=value.byteLength;if(count>max){await reader.cancel();throw new Error();}
    text+=decoder.decode(value,{stream:true});
  }}finally{reader.releaseLock();}
  return JSON.parse(text+decoder.decode());
}
export const budgets={day:400,person:40,minute:12,personMinute:4};
export function reserve(entries,id,now,limits=budgets){
  const day=86400000, live=entries.filter(([t])=>t>now-day);
  const personal=live.filter(([,p])=>p===id), waits=[];
  for(const [list,window,limit] of [[live,day,limits.day],[personal,day,limits.person],[live,60000,limits.minute],[personal,60000,limits.personMinute]]){
    const subset=list.filter(([t])=>t>now-window);
    if(subset.length>=limit)waits.push(Math.ceil((subset[subset.length-limit][0]+window-now)/1000));
  }
  return waits.length?{wait:Math.max(...waits)}:{entries:[...live,[now,id]]};
}
// All regions reserve against the same Durable Object, before upstream I/O.
export class Quota{
  constructor(ctx){this.storage=ctx.storage;}
  async fetch(req){
    const id=await req.text();
    const wait=await this.storage.transaction(async tx=>{
      const decision=reserve(await tx.get('window')??[],id,Date.now());
      if(decision.wait)return decision.wait;
      await tx.put('window',decision.entries);return 0;
    });
    return wait?response(429,{}, {'Retry-After':String(wait)}):response(200);
  }
}
export async function handleChat(req,env,forward=fetch){
  if(new URL(req.url).pathname!=='/v1/chat/completions')return response(404);
  if(req.method!=='POST')return response(405,{}, {Allow:'POST'});
  if(!env.GEMINI_API_KEY||!env.COCO_CODE_HASHES||!env.QUOTA)return response(503);
  const code=/^Bearer (coco_[A-Za-z0-9_-]{22,80})$/.exec(req.headers.get('Authorization')??'')?.[1];
  if(!code)return response(401);
  const id=await codeHash(code);
  if(!env.COCO_CODE_HASHES.split(/[\s,]+/).includes(id))return response(403);
  let messages;
  try{
    const body=await limitedJson(req.body,32768);
    if(!Array.isArray(body.messages)||body.messages.length<2||body.messages.length>26||body.messages.at(-1)?.role!=='user')throw new Error();
    messages=body.messages.map((m,i)=>{
      if(m?.role!==(i===0?'system':i%2?'user':'assistant')||typeof m.content!=='string'||!m.content.trim()||m.content.length>2400)throw new Error();
      return {role:m.role,content:m.content};
    });
  }catch{return response(400);}
  try{
    const quota=env.QUOTA.get(env.QUOTA.idFromName('coco-global-v1'));
    const grant=await quota.fetch('https://quota.internal/reserve',{method:'POST',body:id});
    if(!grant.ok)return grant.status===429?response(429,{}, {'Retry-After':grant.headers.get('Retry-After')||'60'}):response(503);
    const res=await forward(upstream,{method:'POST',redirect:'manual',
      signal:AbortSignal.any([req.signal,AbortSignal.timeout(25000)]),
      headers:{Authorization:'Bearer '+env.GEMINI_API_KEY,'Content-Type':'application/json'},
      body:JSON.stringify({model,messages,stream:false,max_tokens:512})});
    if(!res.ok){
      await res.body?.cancel();
      return res.status===429?response(429,{}, {'Retry-After':res.headers.get('Retry-After')||'60'}):response(502);
    }
    const reply=(await limitedJson(res.body,131072)).choices?.[0]?.message?.content;
    if(typeof reply!=='string'||!reply.trim()||reply.length>8000)return response(502);
    return response(200,{choices:[{message:{role:'assistant',content:reply}}]});
  }catch{return response(503);}
}
export default {fetch:(req,env)=>handleChat(req,env)};
