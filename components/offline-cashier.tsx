'use client';
import {useEffect,useRef,useState} from 'react';
import {Cashier} from './cashier';
import {InstallAppButton} from './install-app';
import {CashierAccess,cashierLogout} from './cashier-access';
import {OfflineGrant,cacheKey,readCashierCache,deviceUpdate} from '../lib/cashier-device';
import {CashierCache,acceptCashierSnapshot,refreshAfterReset,enqueueCashier,localCashierState,projectCashierCache} from '../lib/cashier-protocol';
import {drainCashierQueue} from '../lib/cashier-sync';
import {initial,State} from '../lib/ledger';
export default function CashierApp(){return <CashierAccess>{grant=><CashierDevice key={grant.workspaceKey+grant.login} grant={grant}/>}</CashierAccess>}
function CashierDevice({grant}:{grant:OfflineGrant}){
 const mode='live';
 const [cache,setCache]=useState<CashierCache|null>(null),[busy,setBusy]=useState(false),[error,setError]=useState(''),[connection,setConnection]=useState('Подключение…'),[offlineReady,setOfflineReady]=useState(false);
 const syncing=useRef(false),mounted=useRef(true),currentKey=useRef('');const key=cacheKey(grant.workspaceKey,mode);currentKey.current=key;
 const projection=cache?projectCashierCache(cache):{state:initial(false),error:''},state=projection.state,pending=cache?.pending.length||0,blocked=cache?.pending.find(op=>op.status==='blocked');
 const update=async(change:(value:CashierCache)=>CashierCache)=>{
  const value=await deviceUpdate<CashierCache>(key,old=>{if(!old)throw Error('Сначала загрузите товары через интернет');return change(old)});
  if(mounted.current&&key===currentKey.current)setCache(value!);broadcast();return value!;
 };
 function broadcast(){if(typeof BroadcastChannel==='undefined')return;const channel=new BroadcastChannel('vag-cashier-local');channel.postMessage({key});channel.close()}
 async function sync(retry=false){
  if(syncing.current)return;if(!navigator.onLine){setConnection('Без интернета');return}syncing.current=true;setConnection('Синхронизация…');
  const work=async()=>{
   // Learn the ledger generation before submitting any saved checks.
   const first=await fetch('/vag-oil/api/cashier?mode='+mode,{cache:'no-store',signal:AbortSignal.timeout(15000)});const snapshot:any=await first.json();
   if(first.status===401){window.dispatchEvent(new Event('pos-session-expired'));return}if(!first.ok)throw Error(snapshot.error||'Ошибка связи');
   const prepared=await deviceUpdate<CashierCache>(key,old=>refreshAfterReset(old,snapshot.data,snapshot.version,snapshot.resetAt||''));
   if(mounted.current&&key===currentKey.current)setCache(prepared!);broadcast();
   const result=await drainCashierQueue({read:()=>readCashierCache(key),update},async operation=>{
    const response=await fetch('/vag-oil/api/cashier?mode='+mode,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({resetAt:prepared?.resetAt||'',operation:{id:operation.id,createdAt:operation.createdAt,action:operation.action}}),signal:AbortSignal.timeout(15000)});const data:any=await response.json();return {...data,status:response.status};
   },retry);
   if(result.unauthorized){window.dispatchEvent(new Event('pos-session-expired'));return}
   const response=await fetch('/vag-oil/api/cashier?mode='+mode,{cache:'no-store',signal:AbortSignal.timeout(15000)});const data:any=await response.json();
   if(response.status===401){window.dispatchEvent(new Event('pos-session-expired'));return}if(!response.ok)throw Error(data.error||'Ошибка связи');
   const fresh=await deviceUpdate<CashierCache>(key,old=>refreshAfterReset(old,data.data,data.version,data.resetAt||''));
   if(mounted.current&&key===currentKey.current){setCache(fresh!);setConnection(result.blocked?'Требуется проверка':'Онлайн');setError(result.blocked?(result.error||'Чек ожидает проверки руководителем'):'')};broadcast();
  };
  try{if(navigator.locks)await navigator.locks.request('vag-cashier-sync:'+key,work);else await work()}catch{if(mounted.current)setConnection('Без связи — чеки на устройстве')}finally{syncing.current=false}
 }
 useEffect(()=>{mounted.current=true;return()=>{mounted.current=false}},[]);
 useEffect(()=>{setCache(null);setError('');void readCashierCache(key).then(saved=>{if(key===currentKey.current&&saved)setCache(saved)}).catch(e=>setError(e.message));void sync();
  const online=()=>void sync(),offline=()=>setConnection('Без интернета'),visible=()=>{if(!document.hidden)void sync()};window.addEventListener('online',online);window.addEventListener('offline',offline);window.addEventListener('focus',visible);document.addEventListener('visibilitychange',visible);const director=typeof BroadcastChannel==='undefined'?null:new BroadcastChannel('vag-pos-store');if(director)director.onmessage=e=>{if(e.data?.mode===mode)void sync()};const timer=setInterval(()=>{if(!document.hidden)void sync()},15000);
  const channel=typeof BroadcastChannel==='undefined'?null:new BroadcastChannel('vag-cashier-local');if(channel)channel.onmessage=e=>{if(e.data?.key===key)void readCashierCache(key).then(saved=>{if(key===currentKey.current&&saved)setCache(saved)})};
  return()=>{clearInterval(timer);window.removeEventListener('online',online);window.removeEventListener('offline',offline);window.removeEventListener('focus',visible);document.removeEventListener('visibilitychange',visible);director?.close();channel?.close()};
 },[key]);
 useEffect(()=>{
  if(!('serviceWorker' in navigator)){setError('Этот браузер не поддерживает запуск кассы без интернета');return}
  let active=true;navigator.serviceWorker.register('/vag-oil/cashier-sw.js',{scope:'/vag-oil/cashier'}).then(()=>navigator.serviceWorker.ready).then(()=>{if(active)setOfflineReady(true)}).catch(()=>{if(active)setError('Не удалось подготовить запуск без интернета. Проверьте связь и обновите кассу.')});
  void navigator.storage?.persist?.().catch(()=>false);
  return()=>{active=false};
 },[]);
 async function mutate(action:any):Promise<State|null>{
  if(busy||!cache)return null;setBusy(true);setError('');try{const next=await update(current=>enqueueCashier(current,action));void sync();return localCashierState(next)}catch(e){setError((e as Error).message);return null}finally{setBusy(false)}
 }
 function backup(){if(!cache?.pending.length)return;const url=URL.createObjectURL(new Blob([JSON.stringify({workspaceKey:grant.workspaceKey,mode,pending:cache.pending},null,2)],{type:'application/json'}));const link=document.createElement('a');link.href=url;link.download='vag-offline-checks-'+new Date().toISOString().slice(0,10)+'.json';link.click();setTimeout(()=>URL.revokeObjectURL(url),1000)}
 return <Cashier s={state} ready={!!cache&&!blocked&&!projection.error&&cache.base.stockSources?.schema===1} busy={busy} error={error||projection.error||(cache&&!cache.base.stockSources?'Нужно загрузить раздельные остатки. Подключите интернет и нажмите «Синхронизировать».':'')} mode={mode} mutate={mutate} refresh={()=>void sync(true)} restricted onLogout={()=>void cashierLogout()} connectionLabel={connection} pendingIds={cache?.pending.map(op=>op.id)||[]} tools={<details className="cashSyncDetails"><summary><span>{offlineReady&&cache?'Готова без интернета':'Подготовка кассы…'}</span><b>{pending?'К отправке: '+pending:'Все чеки переданы'}</b><span className="cashSyncMore">⌄</span></summary><div className="cashsyncbar"><span>{offlineReady&&cache?'Касса готова без интернета':'Подготовка кассы…'} · {pending?'Ждут отправки: '+pending:'Все чеки переданы'}{cache?.lastSync&&' · Обновлено '+new Date(cache.lastSync).toLocaleTimeString('ru-RU',{timeZone:'Asia/Dushanbe',hour:'2-digit',minute:'2-digit'})}</span><button disabled={busy} onClick={()=>void sync(true)}>Синхронизировать</button>{pending>0&&<button onClick={backup}>Скачать ожидающие чеки</button>}<a href="/vag-oil/administrator">Кабинет администратора</a><InstallAppButton cashier/></div></details>}/>;
}
