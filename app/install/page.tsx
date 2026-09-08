'use client';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { initializeBitrix, apiCall } from '@/lib/client';
export default function Install() {
  const [message,setMessage]=useState('Подтвердите установку приложения на этом портале.'),[busy,setBusy]=useState(false);
  async function install(){setBusy(true);try{await initializeBitrix();const response=await apiCall('/api/state','bitrix','','GET');if(response.mode!=='bitrix')throw new Error('Сначала отключите деморежим на сервере.');window.BX24?.installFinish();setMessage('Установка завершена. Откройте приложение из меню портала.');}catch(e){setMessage((e as Error).message);}finally{setBusy(false);}}
  return <main className="mx-auto max-w-xl p-8"><h1>Контур проектов</h1><p className="my-6" role="status">{message}</p><Button disabled={busy} onClick={install}>{busy?'Проверяем подключение…':'Завершить установку'}</Button></main>;
}
