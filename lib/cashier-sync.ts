import {CashierCache,CashierOperation,acceptCashierSnapshot} from './cashier-protocol';
import {State} from './ledger';
export type SyncReply={status:number,data?:State,version?:number,ackId?:string,error?:string};
export type SyncStore={read:()=>Promise<CashierCache|undefined>,update:(fn:(cache:CashierCache)=>CashierCache)=>Promise<CashierCache>};
export async function drainCashierQueue(store:SyncStore,send:(operation:CashierOperation)=>Promise<SyncReply>,retryBlocked=false){
 let count=0;
 while(true){
  const cache=await store.read(),operation=cache?.pending[0];if(!operation)return {count,blocked:false};
  if(operation.status==='blocked'&&!retryBlocked)return {count,blocked:true,error:operation.error};
  const reply=await send(operation);
  if(reply.status===401)return {count,blocked:false,unauthorized:true,error:reply.error};
  if(reply.status>=500||reply.status===429)throw Error(reply.error||'Сервер временно недоступен');
  if(reply.status!==200||!reply.data||typeof reply.version!=='number'||reply.ackId!==operation.id){
   const error=reply.error||'Не удалось подтвердить чек';
   await store.update(current=>({...current,pending:current.pending.map(op=>op.id===operation.id?{...op,status:'blocked',error}:op)}));
   return {count,blocked:true,error};
  }
  await store.update(current=>acceptCashierSnapshot(current,reply.data!,reply.version!,operation.id));count++;
 }
}
