import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import { Miniflare } from 'miniflare';
import { handleApi } from '../lib/server/api.ts';
import { metrics } from '../lib/finance.ts';
let mf, env;
before(async()=>{
  mf=new Miniflare({modules:true,script:'export default { fetch() { return new Response("ok") } }',compatibilityDate:'2026-05-01',d1Databases:['DB']});
  const DB=await mf.getD1Database('DB');env={DB,APP_MODE:'demo'};
  for(const file of (await readdir(new URL('../drizzle/',import.meta.url))).filter(n=>n.endsWith('.sql')).sort()){
    for(const sql of (await readFile(new URL('../drizzle/'+file,import.meta.url),'utf8')).split('--> statement-breakpoint').filter(s=>s.trim()))await DB.prepare(sql).run();
  }
});
after(async()=>{await mf?.dispose();});
async function call(path,method='GET',payload=undefined,user='demo:1',override={}){
  const response=await handleApi(new Request('https://finance.example'+path,{method,headers:{'Content-Type':'application/json','X-Demo-User':user,...override.headers},body:payload===undefined?undefined:JSON.stringify(payload)}),override.env||env);
  return {status:response.status,data:await response.json()};
}
const sample=(extra={})=>({id:crypto.randomUUID(),projectId:'demo:crm',categoryId:'demo:revenue',amount:'100.50',date:'2026-09-08',note:'API acceptance test',...extra});
test('seed is stable across visits and totals reconcile independently',async()=>{
  const a=await call('/api/state');const b=await call('/api/state');
  assert.equal(a.status,200);assert.equal(a.data.projects.length,3);assert.equal(a.data.entries.length,14);assert.equal(b.data.entries.length,14);
  const m=metrics(a.data.entries);assert.equal(m.income,50000000);assert.equal(m.expenses,33000000);assert.equal(m.profit,17000000);assert.equal(m.margin,34);
});
test('each role receives only permitted projects and cannot spoof write access',async()=>{
  const view=await call('/api/state','GET',undefined,'demo:3');
  assert.deepEqual(view.data.projects.map(p=>p.id).sort(),['demo:crm','demo:integration']);
  assert.equal((await call('/api/entries','POST',sample(),'demo:3')).status,403);
  assert.equal((await call('/api/entries','POST',sample({projectId:'demo:support'}),'demo:3')).status,404);
  assert.equal((await call('/api/projects/demo:support/audit','GET',undefined,'demo:3')).status,404);
  assert.equal((await call('/api/categories','POST',{kind:'expense',name:'Forbidden'},'demo:3')).status,403);
});
test('project creation, custom income/expense articles and duplicate validation',async()=>{
  const p=await call('/api/projects','POST',{name:'Проверка проекта',client:'Тест',description:''},'demo:4');assert.equal(p.status,200);
  const current=await call('/api/state','GET',undefined,'demo:4');assert.equal(current.data.projects.find(x=>x.id===p.data.id).role,'manager');
  for(const kind of ['income','expense'])assert.equal((await call('/api/categories','POST',{kind,name:'Лицензия'},'demo:4')).status,200);
  assert.equal((await call('/api/categories','POST',{kind:'expense',name:'  лицензия  '},'demo:4')).status,409);
  assert.equal((await call('/api/categories','POST',{kind:'unknown',name:'Error'})).status,422);
});
test('creation is shared, idempotent under simultaneous retries, and audited once',async()=>{
  const payload=sample();const result=await Promise.all([call('/api/entries','POST',payload,'demo:2'),call('/api/entries','POST',payload,'demo:2')]);
  assert.deepEqual(result.map(r=>r.status),[200,200]);
  const state=await call('/api/state','GET',undefined,'demo:3');const entries=state.data.entries.filter(e=>e.id===payload.id);assert.equal(entries.length,1);assert.equal(entries[0].amount,10050);
  const audit=await call('/api/projects/demo:crm/audit');assert.equal(audit.data.events.filter(e=>e.entity_id===payload.id).length,1);
  assert.equal((await call('/api/entries','POST',{...payload,amount:'200'},'demo:2')).status,409);
});
test('optimistic lock: one of two concurrent editors wins; loser receives conflict',async()=>{
  const payload=sample();await call('/api/entries','POST',payload);
  const writes=await Promise.all([call(`/api/entries/${payload.id}`,'PATCH',{...payload,version:1,amount:'201.25'}),call(`/api/entries/${payload.id}`,'PATCH',{...payload,version:1,amount:'202.50'},'demo:2')]);
  assert.deepEqual(writes.map(r=>r.status).sort(),[200,409]);
  const state=await call('/api/state');assert.equal(state.data.entries.find(e=>e.id===payload.id).version,2);
  const audit=await call('/api/projects/demo:crm/audit');const event=audit.data.events.filter(e=>e.entity_id===payload.id);assert.equal(event.length,2);assert.equal(JSON.parse(event[0].before_json).amount,10050);
});
test('soft delete removes value from totals and retains its audit trail',async()=>{
  const payload=sample({amount:'0.01'});await call('/api/entries','POST',payload);
  const before=metrics((await call('/api/state')).data.entries).income;
  assert.equal((await call(`/api/entries/${payload.id}`,'DELETE',{version:1})).status,200);
  const afterState=(await call('/api/state')).data;
  assert.equal(metrics(afterState.entries).income,before-1);assert.ok(!afterState.entries.some(e=>e.id===payload.id));
  const history=await call('/api/projects/demo:crm/audit');assert.equal(history.data.events.find(e=>e.entity_id===payload.id).action,'entry_delete');
  assert.equal((await call(`/api/entries/${payload.id}`,'PATCH',{...payload,version:1})).status,409);
});
test('manager adds employee; revoked access stops subsequent reads and writes',async()=>{
  const path='/api/projects/demo:support/members';
  assert.equal((await call(path,'POST',{userId:'demo:3',role:'viewer'},'demo:2')).status,200);
  assert.ok((await call('/api/state','GET',undefined,'demo:3')).data.projects.some(p=>p.id==='demo:support'));
  assert.equal((await call(path,'POST',{userId:'demo:4',role:'manager'},'demo:3')).status,403);
  assert.equal((await call(path,'DELETE',{userId:'demo:3'},'demo:2')).status,200);
  assert.ok(!(await call('/api/state','GET',undefined,'demo:3')).data.projects.some(p=>p.id==='demo:support'));
  assert.equal((await call(path,'DELETE',{userId:'demo:2'},'demo:2')).status,422);
});
test('server rejects malformed financial input and cross-origin mutations',async()=>{
  for(const extra of [{amount:'0'},{amount:'1.001'},{amount:'-2'},{date:'2026-02-30'},{categoryId:'missing'},{note:'x'.repeat(1001)}])assert.equal((await call('/api/entries','POST',sample(extra))).status,422);
  assert.equal((await call('/api/entries','POST',sample(),'demo:1',{headers:{Origin:'https://evil.example'}})).status,403);
  const wrong=await handleApi(new Request('https://finance.example/api/projects',{method:'POST',body:'not-json',headers:{'Content-Type':'application/json'}}),env);assert.equal(wrong.status,400);
});
test('SQLite enforces amount constraints even outside API',async()=>{
  await assert.rejects(()=>env.DB.prepare("UPDATE entries SET amount=0 WHERE id='demo:entry:1'").run());
  await assert.rejects(()=>env.DB.prepare("UPDATE entries SET amount=1.25 WHERE id='demo:entry:1'").run());
});
test('Bitrix mode requires token, ignores demo identity, verifies only configured portal',async()=>{
  const production={...env,APP_MODE:'bitrix',BITRIX_DOMAIN:'fixture.bitrix24.ru',BITRIX_ADMIN_IDS:'99'};
  assert.equal((await call('/api/state','GET',undefined,'demo:1',{env:production})).status,401);
  const original=globalThis.fetch;const destinations=[];
  globalThis.fetch=async(url,options)=>{destinations.push(String(url));assert.equal(new URLSearchParams(options.body).get('auth'),'verified-fixture-token');return Response.json({result:{ID:'7',NAME:'Тест',LAST_NAME:'Пользователь',ACTIVE:true}});};
  try{
    const result=await call('/api/state','GET',undefined,'demo:1',{env:production,headers:{Authorization:'Bearer verified-fixture-token','X-Bitrix-Domain':'evil.example','X-User-Id':'99'}});
    assert.equal(result.status,200);assert.equal(result.data.user.id,'fixture.bitrix24.ru:7');assert.equal(result.data.user.global_role,'member');assert.equal(result.data.projects.length,0);
    assert.deepEqual(destinations,['https://fixture.bitrix24.ru/rest/user.current.json']);
  }finally{globalThis.fetch=original;}
  assert.equal((await call('/api/state','GET',undefined,'demo:1',{env:{...production,APP_MODE:'demo'}})).status,503);
});
