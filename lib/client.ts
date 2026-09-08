import type { BxSdk } from './types';
let init: Promise<void> | undefined;
export function initializeBitrix() {
  if (init) return init;
  init = new Promise<void>((resolve,reject)=> {
    if (window.parent===window) { reject(new Error('Откройте приложение через меню Битрикс24.')); return; }
    const timeout = window.setTimeout(()=>reject(new Error('Битрикс24 не ответил. Обновите страницу приложения.')),15000);
    const ready = () => window.BX24?.init(()=>{ clearTimeout(timeout); resolve(); });
    if (window.BX24) ready();
    else { const script=document.createElement('script'); script.src='https://api.bitrix24.com/api/v1/'; script.onload=ready; script.onerror=()=>{clearTimeout(timeout);reject(new Error('Не удалось загрузить библиотеку Битрикс24.'));}; document.head.appendChild(script); }
  }).catch(e=>{init=undefined;throw e;});
  return init;
}
async function authToken(refresh=false):Promise<string> {
  const bx=window.BX24 as BxSdk | undefined; if (!bx) throw new Error('Нет соединения с Битрикс24.');
  if (refresh || !bx.getAuth()) await new Promise<void>((resolve,reject)=>{const timer=window.setTimeout(()=>reject(new Error('Не удалось обновить авторизацию.')),15000);bx.refreshAuth(()=>{clearTimeout(timer);resolve();});});
  const auth=bx.getAuth(); if (!auth) throw new Error('Авторизация истекла. Откройте приложение заново.'); return auth.access_token;
}
export async function apiCall(path:string, appMode:'demo'|'bitrix', demoUser:string, method='GET', payload?:unknown, retry=true):Promise<any> {
  const headers:Record<string,string>={'Content-Type':'application/json'};
  if (appMode==='demo') headers['X-Demo-User']=demoUser;
  else headers.Authorization=`Bearer ${await authToken()}`;
  const response=await fetch(path,{method,headers,body:payload===undefined?undefined:JSON.stringify(payload),cache:'no-store',signal:AbortSignal.timeout(20000)});
  if (response.status===401 && appMode==='bitrix' && retry) {await authToken(true);return apiCall(path,appMode,demoUser,method,payload,false);}
  let data:any;try{data=await response.json();}catch{throw new Error('Сервер не ответил. Повторите действие.');}
  if (!response.ok) throw new Error(data.error || 'Не удалось выполнить действие.');
  return data;
}
