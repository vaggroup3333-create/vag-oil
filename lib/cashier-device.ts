import type {SaleActor} from './sale-actor';
import {CashierCache} from './cashier-protocol';
export type OfflineGrant={workspaceKey:string,role:'director'|'cashier',login:string,actor?:SaleActor};
let database:Promise<IDBDatabase>|null=null;
function open(){
 if(!database)database=new Promise((resolve,reject)=>{
  const request=indexedDB.open('vag-cashier-device',1);
  request.onupgradeneeded=()=>request.result.createObjectStore('records');
  request.onsuccess=()=>resolve(request.result);request.onerror=()=>{database=null;reject(Error('Не удалось открыть хранилище кассы на устройстве'))};
 });return database;
}
export async function deviceRead<T>(key:string):Promise<T|undefined>{const db=await open();return new Promise((resolve,reject)=>{const transaction=db.transaction('records','readonly'),request=transaction.objectStore('records').get(key);request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error)})}
// The callback is synchronous: concurrent tabs cannot overwrite each other's queued receipts.
export async function deviceUpdate<T>(key:string,change:(value:T|undefined)=>T|undefined):Promise<T|undefined>{
 const db=await open();return new Promise((resolve,reject)=>{
  const transaction=db.transaction('records','readwrite'),store=transaction.objectStore('records'),request=store.get(key);let result:T|undefined;
  request.onsuccess=()=>{try{result=change(request.result);if(result===undefined)store.delete(key);else store.put(result,key)}catch(e){transaction.abort();reject(e)}};
  transaction.oncomplete=()=>resolve(result);transaction.onerror=()=>reject(Error('Чек не сохранён: проверьте свободное место на устройстве'));transaction.onabort=()=>reject(Error('Не удалось сохранить чек на устройстве'));
 });
}
export const cacheKey=(scope:string,mode:string)=>'cashier:'+scope+':'+mode;
export const readCashierCache=(key:string)=>deviceRead<CashierCache>(key);
