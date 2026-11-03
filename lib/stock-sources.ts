import {saleStock} from './draft-stock';
import type {State,Entry,Line,ApplyContext,Product} from './ledger';

export const stockOrigins=['paid','credit','unknown'] as const;
export type StockOrigin=typeof stockOrigins[number];
export type StockSplit=Record<StockOrigin,number>;
export type StockSources={schema:1,balances:Record<string,StockSplit>};
export const originLabels:Record<StockOrigin,string>={paid:'Оплаченный',credit:'Получен в долг',unknown:'Нужно уточнить'};
export const q=(n:number)=>Math.round(n*1000)/1000;
export const emptySplit=():StockSplit=>({paid:0,credit:0,unknown:0});
export const splitTotal=(b:StockSplit)=>q(stockOrigins.reduce((n,k)=>n+b[k],0));
export const oneSplit=(origin:StockOrigin,qty:number):StockSplit=>({...emptySplit(),[origin]:q(qty)});
export function receiptOrigin(e:Entry):StockOrigin{
 if(e.type==='opening_stock')return 'paid';
 if(e.stockOrigin)return e.stockOrigin;
 if(e.type!=='purchase'||!Number.isFinite(e.initialPaid))return 'unknown';
 // Origin describes receipt conditions, never the invoice's current debt.
 return Math.round((e.initialPaid||0)*100)>=Math.round(e.total*100)?'paid':'credit';
}
const lotQty=(l:NonNullable<State['packageLots']>[number])=>q(l.sealed*l.volume+l.opened.reduce((n,x)=>n+x,0));
export function stockBalance(s:State,id:string):StockSplit{return s.stockSources?.balances[id]||emptySplit()}

/** Legacy documents did not record which source was sold. Keep only quantities
 * that are provable from receipts and outflows; never assign ambiguous sales FIFO. */
export function initializeStockSources(s:State){
 if(s.stockSources?.schema===1)return;
 const incoming=new Map<string,StockSplit>(),spent=new Map<string,number>(),history=new Map<string,Set<StockOrigin>>();
 const add=(id:string,k:StockOrigin,n:number)=>{const b=incoming.get(id)||emptySplit();b[k]=q(b[k]+n);incoming.set(id,b)};
 const active=s.entries.filter(e=>e.status==='posted');
 for(const e of active){
  if(!['purchase','opening_stock'].includes(e.type)||e.cancelledAt)continue;
  const k=receiptOrigin(e);e.stockOrigin=k;
  for(const l of e.lines.filter(l=>l.kind!=='service')){add(l.id,k,l.qty);const h=history.get(l.id)||new Set<StockOrigin>();h.add(k);history.set(l.id,h)}
 }
 for(const e of active){
  if(e.type==='purchase_return'&&!e.cancelledAt){const source=s.entries.find(x=>x.id===e.target);for(const l of e.lines)add(l.id,source?receiptOrigin(source):'unknown',-l.qty)}
  if(['sale','sale_return','inventory','writeoff'].includes(e.type))for(const l of e.lines.filter(l=>l.kind!=='service')){
   if(['inventory','writeoff'].includes(e.type)&&l.qty>0){add(l.id,'unknown',l.qty);const h=history.get(l.id)||new Set<StockOrigin>();h.add('unknown');history.set(l.id,h)}
   else spent.set(l.id,q((spent.get(l.id)||0)+(e.type==='sale'?l.qty:e.type==='sale_return'?-l.qty:-l.qty)));
  }
 }
 // Unrecorded opening quantities also make historic sales ambiguous.
 for(const p of s.products){const inc=incoming.get(p.id)||emptySplit(),out=spent.get(p.id)||0;if(out<0||stockOrigins.some(k=>inc[k]<0)||Math.abs(splitTotal(inc)-out-p.qty)>.000001){const h=history.get(p.id)||new Set<StockOrigin>();h.add('unknown');history.set(p.id,h)}}
 // A historic sale can be classified only if that product had one receipt origin.
 for(const e of active)if(e.type==='sale')for(const l of e.lines.filter(l=>l.kind!=='service')){
  const h=history.get(l.id);l.stockSplit=oneSplit(h?.size===1?[...h][0]:'unknown',l.qty);
 }
 for(const lot of s.packageLots||[]){
  if(lot.stockOrigin)continue;
  const source=s.entries.find(e=>e.id===lot.sourceId);
  const line=source?.lines.find(l=>l.id===lot.productId);
  const keys=line?.stockSplit?stockOrigins.filter(k=>line.stockSplit![k]>0):[];
  lot.stockOrigin=source&&['purchase','opening_stock'].includes(source.type)?receiptOrigin(source):keys.length===1?keys[0]:'unknown';
 }
 const balances:Record<string,StockSplit>={};
 for(const p of s.products){
  const inc=incoming.get(p.id)||emptySplit(),out=spent.get(p.id)||0,b=emptySplit();
  const fits=p.qty>=0&&out>=0&&stockOrigins.every(k=>inc[k]>=0)&&Math.abs(splitTotal(inc)-out-p.qty)<.001;
  if(fits)for(const k of ['paid','credit'] as const)b[k]=q(Math.max(0,inc[k]-out));
  // Sealed/open packages still carry their receipt source, even in old records.
  for(const k of ['paid','credit'] as const)b[k]=q(Math.max(b[k],(s.packageLots||[]).filter(l=>l.productId===p.id&&l.stockOrigin===k).reduce((n,l)=>n+lotQty(l),0)));
  if(b.paid+b.credit>p.qty+.000001){b.paid=0;b.credit=0;for(const l of s.packageLots||[])if(l.productId===p.id)l.stockOrigin='unknown'}
  b.unknown=q(p.qty-b.paid-b.credit);balances[p.id]=b;
 }
 s.stockSources={schema:1,balances};
}

export function resolveSplit(input:any,qty:number,available:StockSplit,p:Pick<Product,'name'|'wholeOnly'>):StockSplit{
 let result:StockSplit;
 if(stockOrigins.includes(input?.stockOrigin))result=oneSplit(input.stockOrigin,qty);
 else if(input?.stockOrigin==='split'&&input?.stockSplit)result={paid:Number(input.stockSplit.paid??0),credit:Number(input.stockSplit.credit??0),unknown:Number(input.stockSplit.unknown??0)};
 else {
  const keys=stockOrigins.filter(k=>available[k]>0);
  if(keys.length!==1)throw Error('Выберите остаток для «'+p.name+'»: оплаченный или полученный в долг. Если выбора нет, обновите кассу');
  result=oneSplit(keys[0],qty);
 }
 if(stockOrigins.some(k=>!Number.isFinite(result[k])||result[k]<0||result[k]>1e9||Math.abs(result[k]-q(result[k]))>1e-8||p.wholeOnly&&!Number.isInteger(result[k]))||Math.abs(splitTotal(result)-q(qty))>.000001)throw Error('Количество по источникам должно совпадать с количеством «'+p.name+'»');
 for(const k of stockOrigins)if(result[k]>available[k]+.000001)throw Error('Недостаточно остатка «'+originLabels[k]+'»: '+p.name);
 return result;
}
export function returnSourceBalance(s:State,source:Entry,line:Line):StockSplit{
 const b=structuredClone(line.stockSplit||oneSplit('unknown',line.qty));
 for(const e of s.entries)if(e.type==='sale_return'&&e.status==='posted'&&!e.cancelledAt&&e.target===source.id)for(const l of e.lines.filter(l=>l.id===line.id)){
  const used=l.stockSplit;
  if(used)for(const k of stockOrigins)b[k]=q(b[k]-used[k]);
  else {
   // Old returns are unambiguous only for an original single-source sale.
   const keys=stockOrigins.filter(k=>b[k]>0);if(keys.length===1)b[keys[0]]=q(b[keys[0]]-l.qty);
   else {const left=q(splitTotal(b)-l.qty);return oneSplit('unknown',Math.max(0,left))}
  }
 }
 return b;
}

export function prepareSourceAction(s:State,a:any):any{
 if(!['sale','return','writeoff','inventory'].includes(a?.type)||!Array.isArray(a.lines))return a;
 const source=a.type==='return'?s.entries.find(e=>e.id===a.target):undefined;
 return {...a,lines:a.lines.map((line:any)=>{
  const p=s.products.find(p=>p.id===line.id);if(!p||line.kind==='service')return line;
  const qty=q(a.type==='sale'&&line.packaging?Number(line.packaging.volume)*Number(line.packaging.count):Number(line.qty));
  if(!Number.isFinite(qty)||qty<0)return line; // Core validation reports malformed quantities.
  const change=a.type==='inventory'?q(qty-p.qty):a.type==='writeoff'?-qty:a.type==='return'&&source?.type==='sale'?qty:-qty;
  let split:StockSplit;
  if(a.type==='inventory'&&change>=0)split=oneSplit('unknown',change);
  else if(a.type==='return'&&source?.type==='purchase')split=resolveSplit({stockOrigin:receiptOrigin(source)},qty,stockBalance(s,p.id),p);
  else if(a.type==='return'&&source?.type==='sale'){
   const original=source.lines.find(l=>l.id===p.id);if(!original)return line;
   split=resolveSplit(line,qty,returnSourceBalance(s,source,original),p);
  }else split=resolveSplit(line,Math.abs(change),a.type==='sale'&&a.allowDraftStock===true?saleStock(s,p.id):Object.fromEntries(stockOrigins.map(k=>[k,Math.max(0,stockBalance(s,p.id)[k])])) as StockSplit,p);
  return {...line,stockSplit:split};
 })};
}

function applyBalance(s:State,id:string,split:StockSplit,sign:number,allowNegative=false){
 const b=s.stockSources!.balances[id]??=emptySplit();
 for(const k of stockOrigins){const previous=b[k];b[k]=q(b[k]+sign*split[k]);if(!allowNegative&&b[k]<-.000001&&b[k]<previous-.000001)throw Error('Не хватает остатка «'+originLabels[k]+'». Уточните происхождение товара перед отменой документа')}
}
export function finishSourceAction(before:State,next:State,a:any){
 // Nested product/draft helpers must never initialize their own partial receipt.
 next.stockSources=structuredClone(before.stockSources!);
 const oldEntries=new Map(before.entries.map(e=>[e.id,e]));
 for(const e of next.entries){
  const old=oldEntries.get(e.id);
  if(e.status!=='posted'||old?.status==='posted')continue;
  if(['purchase','opening_stock'].includes(e.type)){
   e.stockOrigin=receiptOrigin(e);
   for(const l of e.lines.filter(l=>l.kind!=='service')){l.stockSplit=oneSplit(e.stockOrigin,l.qty);applyBalance(next,l.id,l.stockSplit,1)}
  }else if(['sale','sale_return','purchase_return','inventory','writeoff','opening_stock_reversal','purchase_return_reversal'].includes(e.type)){
   for(const l of e.lines.filter(l=>l.kind!=='service')){
    const input=a.lines?.find((x:any)=>x.id===l.id);
    let split=input?.stockSplit||l.stockSplit;
    if(!split&&e.type==='opening_stock_reversal')split=oneSplit('paid',l.qty);
    if(!split&&e.type==='purchase_return_reversal'){const src=next.entries.find(x=>x.id===e.target);split=oneSplit(src?receiptOrigin(src):'unknown',l.qty)}
    if(!split)throw Error('Не определено происхождение товара в документе');
    l.stockSplit=structuredClone(split);
    const sign=['sale_return','purchase_return_reversal'].includes(e.type)||['inventory','writeoff'].includes(e.type)&&l.qty>=0?1:-1;
    applyBalance(next,l.id,split,sign,e.type==='sale'&&a.allowDraftStock===true);
   }
  }
 }
 for(const old of before.entries)if(old.type==='purchase'&&old.status==='posted'){
  const current=next.entries.find(e=>e.id===old.id);
  if(current?.status==='posted')continue;
  const fullReturned=a.type==='unpost_purchase'&&before.entries.some(e=>e.target===old.id&&e.type==='purchase_return'&&e.status==='posted')&&old.lines.every(l=>Math.abs(l.qty-before.entries.filter(e=>e.target===old.id&&e.type==='purchase_return'&&e.status==='posted'&&!e.cancelledAt).flatMap(e=>e.lines).filter(x=>x.id===l.id).reduce((n,x)=>n+x.qty,0))<.000001);
  if(!fullReturned)for(const l of old.lines)applyBalance(next,l.id,oneSplit(receiptOrigin(old),l.qty),-1);
 }
 for(const p of next.products){next.stockSources.balances[p.id]??=emptySplit();if(Math.abs(splitTotal(stockBalance(next,p.id))-p.qty)>.000001)throw Error('Расхождение остатков по источникам: '+p.name)}
 for(const lot of next.packageLots||[])if(!lot.stockOrigin){
  const receipt=next.entries.find(e=>e.id===lot.sourceId);
  if(receipt&&['purchase','opening_stock'].includes(receipt.type))lot.stockOrigin=receiptOrigin(receipt);
  else lot.stockOrigin='unknown';
 }
}
export function verifyStockSources(next:State){
 for(const p of next.products)for(const k of stockOrigins){const packaged=(next.packageLots||[]).filter(l=>l.productId===p.id&&l.stockOrigin===k).reduce((n,l)=>n+lotQty(l),0);if(packaged>Math.max(0,stockBalance(next,p.id)[k])+.000001)throw Error('Количество упаковок превышает остаток «'+originLabels[k]+'»: '+p.name)}
}

export function assignUnknownStock(s:State,a:any,context:ApplyContext):State{
 if(context.role!=='director')throw Error('Уточнять происхождение может только директор');
 const p=s.products.find(p=>p.id===a.id);if(!p)throw Error('Товар не найден');
 const b=stockBalance(s,p.id),paid=Number(a.paid),credit=Number(a.credit);
 if(Number(a.beforeUnknown)!==b.unknown||b.unknown<=0)throw Error('Остаток изменился. Обновите страницу');
 if([paid,credit].some(n=>!Number.isFinite(n)||n<0||Math.abs(n-q(n))>1e-8||p.wholeOnly&&!Number.isInteger(n))||q(paid+credit)!==b.unknown)throw Error('Распределите весь неуточнённый остаток');
 const lots=(s.packageLots||[]).filter(l=>l.productId===p.id&&l.stockOrigin==='unknown'&&lotQty(l)>0);
 if(lots.length&&paid>0&&credit>0)throw Error('Есть упаковки с неизвестным происхождением. Их можно отнести целиком к одному источнику; для разделения нужна сверка упаковок');
 for(const lot of lots)lot.stockOrigin=paid>0?'paid':'credit';
 const amount=b.unknown;b.paid=q(b.paid+paid);b.credit=q(b.credit+credit);b.unknown=0;
 s.stockSourceNotes??=[];s.stockSourceNotes.push({id:context.id||crypto.randomUUID(),date:context.now||new Date().toISOString(),productId:p.id,qty:amount,paid,credit,actor:context.actor||'director'});
 return s;
}
