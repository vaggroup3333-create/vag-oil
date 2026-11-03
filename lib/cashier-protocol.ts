import {draftStock} from './draft-stock';
import type {State,Entry,ApplyContext} from './ledger';
import {initial,normalize,apply,round} from './ledger';
export type CashierOperation={id:string,createdAt:string,action:any,receipt:Entry,status?:'pending'|'blocked',error?:string};
export type CashierCache={base:State,version:number,pending:CashierOperation[],lastSync:string,resetAt?:string};
export const uuidPattern=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
// Only sales data goes to a cashier device. Supplier debt, cost and cash balances stay on the server.
export function cashierProjection(raw:State):State{
 const s=normalize(raw),base=initial(false);
 base.cashierIncomingStock=draftStock(s);base.stockAdvances=s.stockAdvances?.map(x=>({...x,estimate:0,settlements:x.settlements.map(r=>({...r,cost:0}))}));base.stockSources=structuredClone(s.stockSources);base.products=s.products.map(p=>({...p,cost:0,stockValue:p.stockValue===undefined?undefined:0}));base.parties=s.parties.filter(p=>p.kind==='client');base.accounts=s.accounts;
 base.entries=s.entries.filter(e=>(['sale','sale_return'].includes(e.type)||(e.type==='receipt'&&s.parties.some(p=>p.id===e.partyId&&p.kind==='client')))).map(e=>({...e,cost:0,returnCostRounding:undefined,lines:e.lines.map(l=>({...l,cost:0,returnCostAmount:l.returnCostAmount===undefined?undefined:0,expense:undefined})),deletedPayments:undefined,deletionStock:undefined}));
 if(s.packageLots)base.packageLots=structuredClone(s.packageLots);
 base.categories=s.categories;base.settings=s.settings;base.payments=[];base.shifts=[];base.services=[];base.priceHistory=[];return base;
}
export function validateCashierAction(state:State,action:any){
 if(action?.type==='payment_party'){if(!state.parties.some(p=>p.id===action.partyId&&p.kind==='client'))throw Error('Выберите клиента');return}
 if(!action||!['sale','return'].includes(action.type))throw Error('Кассиру доступны продажа и возврат клиента');
 if(!Array.isArray(action.lines)||!action.lines.length||action.lines.length>100)throw Error('Проверьте строки чека');
 if(action.lines.some((l:any)=>l.kind==='service'))throw Error('Услуги не поддерживаются в этой кассе');
 if(action.type==='return'&&!state.entries.some(e=>e.id===action.target&&e.type==='sale'&&e.status==='posted'))throw Error('Возврат доступен только по чеку продажи');
}
export function cleanCashierAction(action:any){
 if(action.type==='payment_party')return {type:'payment_party',partyId:action.partyId,amount:action.amount,account:action.account,note:action.note};
 const {type,partyId,walkIn,lines,discountMode,discountValue,paid,account,note,paymentMethod,received,target}=action;
 return {type,partyId,walkIn,allowDraftStock:action.allowDraftStock===true,lines:lines.map((l:any)=>({id:l.id,qty:l.qty,price:l.price,discount:l.discount,stockOrigin:l.stockOrigin,stockSplit:l.stockSplit?{paid:l.stockSplit.paid,credit:l.stockSplit.credit,unknown:l.stockSplit.unknown}:undefined,...(l.packaging?{packaging:{kind:l.packaging.kind,volume:l.packaging.volume,count:l.packaging.count,unitPrice:l.packaging.unitPrice}}:{}),...(l.saleMode?{saleMode:l.saleMode}:{}),...(l.returnSealed===true?{returnSealed:true}:{})})),discountMode,discountValue,paid,account,note,paymentMethod,received,target};
}
export function projectCashierCache(cache:CashierCache):{state:State,error:string}{
 let s=normalize(cache.base),error='',replayFailed=false;
 const confirmed=new Set(s.entries.map(e=>e.id));
 for(const operation of cache.pending){
  // A refreshed snapshot can include a committed check whose HTTP acknowledgement
  // was lost. Keep its queued request for acknowledgement, but show it only once.
  if(confirmed.has(operation.id))continue;
  if(operation.status==='blocked'&&!error)error=operation.error||'Чек требует проверки. Нажмите «Синхронизировать»';
  if(!replayFailed){
   try{s=applyCashierAction(s,operation.action,{id:operation.id,now:operation.createdAt,number:'К-'+operation.id.slice(0,8).toUpperCase()});continue}
   catch{replayFailed=true;if(!error)error='Остатки или долг изменились, пока касса была без связи. Сначала нажмите «Синхронизировать» и проверьте ожидающий чек';}
  }
  // Retain every unsent receipt for display/export, without applying dependent
  // returns or allowing new sales against a partially replayed inventory.
  if(!s.entries.some(e=>e.id===operation.id))s.entries.push(structuredClone(operation.receipt));
 }
 return {state:s,error};
}
export function localCashierState(cache:CashierCache):State{return projectCashierCache(cache).state}
export function enqueueCashier(cache:CashierCache,action:any,now=new Date().toISOString(),id=crypto.randomUUID()):CashierCache{
 if(cache.base.stockSources?.schema!==1)throw Error('Откройте кассу с интернетом и нажмите «Синхронизировать», чтобы загрузить раздельные остатки');
 const projection=projectCashierCache(cache);if(projection.error)throw Error(projection.error);
 const s=projection.state;validateCashierAction(s,action);const clean=cleanCashierAction(action);
 const next=applyCashierAction(s,clean,{id,now,number:'К-'+id.slice(0,8).toUpperCase()});
 return {...cache,pending:[...cache.pending,{id,createdAt:now,action:clean,receipt:next.entries.find(e=>e.id===id)!,status:'pending'}]};
}
export function acceptCashierSnapshot(cache:CashierCache,data:State,version:number,ackId?:string):CashierCache{
 return {...cache,base:version>=cache.version?data:cache.base,version:Math.max(version,cache.version),pending:cache.pending.filter(op=>op.id!==ackId),lastSync:new Date().toISOString()};
}

export function applyCashierAction(state:State,action:any,context:ApplyContext):State{
 const next=apply(state,action,context);
 if(action.type==='payment_party'){const party=next.parties.find(p=>p.id===action.partyId)!;const amount=round(Number(action.amount));next.entries.push({id:context.id!,number:context.number||String(next.entries.length+1).padStart(6,'0'),date:context.now!,createdAt:context.now!,type:'receipt',status:'posted',party:party.name,partyId:party.id,lines:[],total:amount,paid:amount,credit:0,cost:0,service:0,discount:0,note:String(action.note||'Погашение долга клиента'),account:action.account});}
 return next;
}

export function refreshAfterReset(cache:CashierCache|undefined,data:State,version:number,resetAt=''):CashierCache{
 if(!cache||(cache.resetAt||'')!==resetAt)return {base:data,version,pending:[],lastSync:new Date().toISOString(),resetAt};
 return {...acceptCashierSnapshot(cache,data,version),resetAt};
}
