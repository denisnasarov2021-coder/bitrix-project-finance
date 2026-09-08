import assert from 'node:assert/strict';
import test from 'node:test';
test('built Worker renders Russian application and accepts Bitrix launch POST',async()=>{
  const {default:worker}=await import('../dist/server/index.js');
  const env={ASSETS:{fetch:async()=>new Response('Not found',{status:404})},APP_MODE:'demo'};
  const ctx={waitUntil(){},passThroughOnException(){}};
  const response=await worker.fetch(new Request('http://localhost/',{headers:{accept:'text/html'}}),env,ctx);
  assert.equal(response.status,200);const html=await response.text();
  assert.match(html,/lang="ru"/);assert.match(html,/Финансы проектов/);assert.doesNotMatch(html,/Starter Project|codex-preview/);
  const launch=await worker.fetch(new Request('https://finance.example/bitrix?DOMAIN=fixture.bitrix24.ru&APP_SID=fixture',{method:'POST',body:'AUTH_ID=must-never-leak&REFRESH_ID=must-never-leak'}),env,ctx);
  assert.equal(launch.status,303);assert.equal(launch.headers.get('Location'),'https://finance.example/?DOMAIN=fixture.bitrix24.ru&APP_SID=fixture');assert.doesNotMatch(launch.headers.get('Location'),/must-never-leak/);
});
