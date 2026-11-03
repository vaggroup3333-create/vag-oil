import type {State,Entry,Line,Product} from './ledger';
import {stockOrigins,stockBalance,oneSplit,q,emptySplit} from './stock-sources';
import type {StockOrigin,StockSplit} from './stock-sources';
import {consumePackages} from './packaging';
import {inventoryValue} from './draft-stock';
export type StockAdvance={saleId:string,productId:string,origin:StockOrigin,qty:number,remaining:number,estimate:number,settlements:{receiptId:string,qty:number,cost:number,date:string}[]};
const round=(n:number)=>Math.round((n+Number.EPSILON)*100)/100;
const pending=(s:State,id:string)=>(s.stockAdvances||[]).filter(x=>x.productId===id&&x.remaining>.000001);
const pendingValue=(s:State,id:string)=>pending(s,id).reduce((n,x)=>n+x.remaining*x.estimate,0);
const positiveQty=(s:State,id:string)=>stockOrigins.reduce((n,k)=>n+Math.max(0,stockBalance(s,id)[k]),0);
export function physicalSplit(s:State,id:string,split:StockSplit){const b=stockBalance(s,id);return {paid:Math.min(split.paid,Math.max(0,b.paid)),credit:Math.min(split.credit,Math.max(0,b.credit)),unknown:Math.min(split.unknown,Math.max(0,b.unknown))}}
export function receiptAverage(p:Product,qty:number,cost:number){const before=Math.max(0,p.qty);return (before*p.cost+qty*cost)/(before+qty)}
export function advanceGuard(s:State,a:any){
 if(a.type==='return'){
  const source=s.entries.find(e=>e.id===a.target);
  if(source?.type==='sale'&&(a.lines||[]).some((l:any)=>Number(l.qty)>0&&pending(s,l.id).some(x=>x.saleId===source.id)))throw Error('По этому товару ещё не проведён приход. Сначала проведите накладную, затем оформите возврат по чеку.');
 }
 if(['inventory','stock_origin_assign'].includes(a.type)){
  const ids=a.type==='inventory'?(a.lines||[]).map((l:any)=>l.id):[a.id];
  if(ids.some((id:string)=>pending(s,id).length))throw Error('Сначала проведите приход товаров, проданных в минус. Затем можно сверить остатки.');
 }
 if(a.type==='sale'&&a.allowDraftStock===true)for(const l of a.lines||[]){
  if(!l.stockSplit)continue;const b=stockBalance(s,l.id);
  if(stockOrigins.some(k=>l.stockSplit[k]>Math.max(0,b[k])+.000001)&&l.packaging)throw Error('Для продажи целой канистры или бочки сначала проведите её приход. До прихода доступна продажа в литрах.');
 }
}
function pendingReceiptUsed(s:State,id:string){return (s.stockAdvances||[]).some(x=>x.settlements.some(r=>r.receiptId===id))}
export function advanceReceiptReason(s:State,id:string){return pendingReceiptUsed(s,id)?'Этот приход уже закрыл продажи в минус. Используйте возврат поставщику вместо отмены прихода.':''}

// Positive goods and the estimated cost of unreceived goods are kept separately.
// This also handles +paid stock and -credit stock when their net quantity is zero.
export function finishAdvanceAction(before:State,next:State,a:any){
 const oldEntries=new Map(before.entries.map(e=>[e.id,e]));
 const added=next.entries.filter(e=>e.status==='posted'&&oldEntries.get(e.id)?.status!=='posted');
 const changed=new Set<string>();
 const values=new Map<string,number>();
 const value=(id:string)=>{if(!values.has(id)){const p=before.products.find(p=>p.id===id);values.set(id,p?inventoryValue(p)+pendingValue(before,id):0)}return values.get(id)!};
 const setValue=(id:string,n:number)=>{if(!Number.isFinite(n)||n<-.011)throw Error('Не удалось рассчитать стоимость остатка. Операция не сохранена.');values.set(id,Math.max(0,n));changed.add(id)};
 const active=(id:string)=>before.products.find(p=>p.id===id)?.stockValue!==undefined||pending(before,id).length>0||changed.has(id);
 function receive(e:Entry,l:Line){
  const previous=oldEntries.get(e.id);
  if(previous?.type==='purchase'&&previous.status==='draft'){
   const planned=previous.total>0&&Number(previous.draftPaid||0)>=previous.total?'paid':'credit';
   if(e.stockOrigin!==planned&&pending(before,l.id).some(x=>x.origin===planned))throw Error('По товару «'+l.name+'» уже есть продажи до прихода из '+(planned==='paid'?'оплаченного остатка':'остатка в долг')+'. Проведите приход с тем же источником. Оплату долга можно внести отдельно.');
  }
  let outstanding=emptySplit();
  for(const x of pending(next,l.id))outstanding[x.origin]=q(outstanding[x.origin]+x.remaining);
  const split=l.stockSplit||oneSplit('unknown',l.qty),physical=stockOrigins.reduce((n,k)=>n+Math.max(0,split[k]-outstanding[k]),0);
  setValue(l.id,value(l.id)+physical*l.cost);
  for(const origin of stockOrigins){
   let left=split[origin],settled=0;
   for(const item of pending(next,l.id).filter(x=>x.origin===origin)){
    if(left<=.000001)break;
    const take=q(Math.min(left,item.remaining)),sale=next.entries.find(x=>x.id===item.saleId&&x.type==='sale'&&x.status==='posted'),line=sale?.lines.find(x=>x.id===item.productId);
    if(!sale||!line||line.qty<=0)throw Error('Не найден чек продажи до прихода');
    line.cost=(line.qty*line.cost+take*(l.cost-item.estimate))/line.qty;
    if(!Number.isFinite(line.cost)||line.cost<-.000001)throw Error('Не удалось уточнить себестоимость чека');
    sale.cost=round(sale.lines.reduce((n,x)=>n+x.qty*x.cost,0));
    item.remaining=q(item.remaining-take);item.settlements.push({receiptId:e.id,qty:take,cost:l.cost,date:e.createdAt});
    left=q(left-take);settled=q(settled+take);
   }
   // Newly received packages cover previous bulk sales before becoming available.
   if(settled>0&&(next.packageLots||[]).some(x=>x.productId===l.id&&x.stockOrigin===origin)){
    const p=next.products.find(x=>x.id===l.id)!;
    const view={...next,packageLots:(next.packageLots||[]).filter(x=>x.stockOrigin===origin),stockSources:{schema:1 as const,balances:{[l.id]:oneSplit(origin,split[origin])}}};
    consumePackages(view,{...p,qty:split[origin]},settled,undefined,oneSplit(origin,settled));
   }
  }
 }
 for(const e of added)for(const l of e.lines.filter(x=>x.kind!=='service')){
  const old=before.products.find(p=>p.id===l.id),b=stockBalance(before,l.id);
  if(e.type==='sale'){
   const split=l.stockSplit||emptySplit(),short=emptySplit();
   for(const k of stockOrigins)short[k]=q(Math.max(0,split[k]-Math.max(0,b[k])));
   const missing=stockOrigins.reduce((n,k)=>n+short[k],0);
   if(missing>0){
    if(a.allowDraftStock!==true)throw Error('Подтвердите продажу до проведения прихода');
    next.stockAdvances??=[];
    for(const origin of stockOrigins)if(short[origin]>0)next.stockAdvances.push({saleId:e.id,productId:l.id,origin,qty:short[origin],remaining:short[origin],estimate:l.cost,settlements:[]});
   }
   if(active(l.id)||missing>0)setValue(l.id,value(l.id)-(l.qty-missing)*l.cost);
  }else if(active(l.id)){
   if(['purchase','opening_stock','sale_return','purchase_return_reversal'].includes(e.type))receive(e,l);
   else if(['purchase_return','opening_stock_reversal'].includes(e.type))setValue(l.id,value(l.id)-l.qty*l.cost);
   else if(['inventory','writeoff'].includes(e.type))setValue(l.id,value(l.id)+l.qty*l.cost);
  }
 }
 // A receipt may only be removed when it has never settled a negative sale.
 for(const e of before.entries)if(e.type==='purchase'&&e.status==='posted'&&next.entries.find(x=>x.id===e.id)?.status!=='posted'){
  if(pendingReceiptUsed(before,e.id))throw Error(advanceReceiptReason(before,e.id));
  for(const l of e.lines)if(active(l.id))setValue(l.id,value(l.id)-l.qty*l.cost);
 }
 for(const id of changed){
  const p=next.products.find(p=>p.id===id)!;
  const positive=positiveQty(next,id),v=value(id);
  if(positive<.000001&&v>.011)throw Error('Стоимость положительного остатка не совпала с количеством');
  p.stockValue=(positive<.000001?0:v)-pendingValue(next,id);
  p.cost=positive>.000001?v/positive:(before.products.find(x=>x.id===id)?.cost||added.flatMap(e=>e.lines).find(l=>l.id===id)?.cost||0);
  // Snapshot values must reflect the final calculation used by future cancellation guards.
  for(const e of added){const snapshot=e.openingStockSnapshots?.find(x=>x.productId===id)||(e.openingStockSnapshot?.productId===id?e.openingStockSnapshot:undefined);if(snapshot)snapshot.afterCost=p.cost;}
 }
 for(const p of next.products){
  const b=stockBalance(next,p.id);
  for(const k of stockOrigins){const missing=q(pending(next,p.id).filter(x=>x.origin===k).reduce((n,x)=>n+x.remaining,0));if(Math.abs(Math.min(0,b[k])+missing)>.000001)throw Error('Продажи до прихода не совпали с отрицательным остатком: '+p.name)}
 }
 for(const e of next.entries)if(e.type==='sale'){
  const has=(next.stockAdvances||[]).some(x=>x.saleId===e.id&&x.remaining>.000001);
  if(has)e.costPending=true;else if(e.costPending)delete e.costPending;
 }
}
