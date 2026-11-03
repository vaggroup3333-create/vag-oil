import {inventoryValue,pendingStockCount} from './draft-stock';
import type {State,Entry,Payment} from './ledger';
import {posted,debt,round,totals} from './ledger';
export const localDay=(value:string)=>new Date(new Date(value).getTime()+5*3600000).toISOString().slice(0,10);
export const inPeriod=(value:string,from='',to='')=>{const d=localDay(value);return (!from||d>=from)&&(!to||d<=to)};
const quantity=(n:number)=>Math.round(n*1000)/1000;
// Allocate stored document totals in cents so visible rows reconcile with the document.
function allocate(total:number,weights:number[]){
 const sum=weights.reduce((a,b)=>a+b,0),cents=Math.round(total*100);
 if(!sum)return weights.map((_,i)=>i===0?cents/100:0);
 const raw=weights.map(w=>cents*w/sum),parts=raw.map(Math.floor);
 const remaining=cents-parts.reduce((a,b)=>a+b,0);
 const order=raw.map((v,i)=>({i,fraction:v-parts[i]})).sort((a,b)=>b.fraction-a.fraction||a.i-b.i);
 for(let i=0;i<remaining;i++)parts[order[i%order.length].i]++;
 return parts.map(v=>v/100);
}
export function saleLineAmounts(e:Entry){
 const weights=e.lines.map(l=>Math.max(0,l.qty*l.price-(e.type==='sale'?(l.discount||0):0)));
 const revenues=allocate(e.total,[...weights,...(e.type==='sale'&&e.service?[e.service]:[])]);
 const costs=allocate(e.cost,e.lines.map(l=>Math.max(0,l.qty*l.cost)));
 return e.lines.map((line,i)=>({line,revenue:revenues[i]||0,cost:e.type==='sale_return'&&line.returnCostAmount!==undefined?line.returnCostAmount:costs[i]||0}));
}
export function productSales(entries:Entry[],productId:string){
 let qty=0,revenue=0,cost=0,returned=0,sold=0;
 for(const e of entries.filter(e=>posted(e)&&['sale','sale_return'].includes(e.type)))for(const row of saleLineAmounts(e).filter(r=>r.line.id===productId)){
  const sign=e.type==='sale'?1:-1;qty+=sign*row.line.qty;revenue+=sign*row.revenue;cost+=sign*row.cost;
  if(sign<0)returned+=row.line.qty;else sold+=row.line.qty;
 }
 return {qty:quantity(qty),sold:quantity(sold),revenue:round(revenue),cost:round(cost),profit:round(revenue-cost),returned:quantity(returned)};
}
export function stockMovement(e:Entry,qty:number){
 if(!posted(e))return 0;
 if(['inventory','writeoff'].includes(e.type))return qty;
 return (['purchase','sale_return','purchase_return_reversal','opening_stock'].includes(e.type)?1:['sale','purchase_return','opening_stock_reversal'].includes(e.type)?-1:0)*qty;
}
export function balanceAt(s:State,day:string){
 if(!day){const t=totals(s);return {stock:t.stock,cash:t.cash,customerDebt:t.customerDebt,supplierDebt:t.supplierDebt,capital:round(t.stock+t.cash+t.customerDebt-t.supplierDebt)}}
 const before=(d:string)=>localDay(d)<=day;
 let stock=s.products.reduce((n,p)=>n+inventoryValue(p),0);
 for(const e of s.entries.filter(e=>posted(e)&&!before(e.date)))for(const l of e.lines)if(l.kind!=='service')stock-=stockMovement(e,l.qty)*l.cost;
 const due=(type:string)=>s.entries.filter(e=>posted(e)&&e.type===type&&before(e.date)).reduce((n,e)=>{
  const paid=s.payments.filter(p=>p.target===e.id&&(type==='purchase'?['payout','payout_reversal'].includes(p.kind):p.kind==='receipt')&&before(p.date)).reduce((v,p)=>v+(type==='purchase'?-p.amount:p.amount),0);
  const credit=s.entries.filter(r=>r.target===e.id&&['sale_return','purchase_return','purchase_return_reversal'].includes(r.type)&&posted(r)&&before(r.date)).reduce((v,r)=>v+(r.type==='purchase_return_reversal'?-r.total:r.total),0);
  return n+Math.max(0,round(e.total-paid-credit));
 },0);
 const cash=round(s.payments.filter(p=>before(p.date)).reduce((n,p)=>n+p.amount,0)),customerDebt=round(due('sale')),supplierDebt=round(due('purchase'));
 stock=round(stock);
 return {stock,cash,customerDebt,supplierDebt,capital:round(stock+cash+customerDebt-supplierDebt)};
}
export function documentPayments(s:State,e:Entry){
 const sign=e.type==='purchase'?-1:1;
 const linked=new Set(s.entries.filter(r=>posted(r)&&r.target===e.id&&['sale_return','purchase_return','purchase_return_reversal'].includes(r.type)).map(r=>r.id));
 const direct=s.payments.filter(p=>p.target===e.id&&(e.type==='purchase'?['payout','payout_reversal'].includes(p.kind):p.kind==='receipt'));
 const refunds=s.payments.filter(p=>p.target&&linked.has(p.target)&&['sale_return','purchase_return','purchase_return_reversal'].includes(p.kind));
 const received=round(direct.reduce((n,p)=>n+sign*p.amount,0)),refunded=round(refunds.reduce((n,p)=>n-sign*p.amount,0));
 const accounts=Object.fromEntries(s.accounts.map(a=>[a.id,round([...direct,...refunds].filter(p=>p.account===a.id).reduce((n,p)=>n+sign*p.amount,0))]));
 return {received,refunded,net:round(received-refunded),accounts};
}
export function debtReceipts(s:State):Payment[]{
 const output:Payment[]=[];
 for(const e of s.entries.filter(e=>posted(e)&&e.type==='sale')){
  let initial=Number(e.initialPaid??0);
  const receipts=s.payments.filter(p=>p.target===e.id&&p.kind==='receipt').slice().sort((a,b)=>Date.parse(a.date)-Date.parse(b.date));
  for(const p of receipts){
   const atSale=p.date===e.date||p.id===e.id+'-init',skip=atSale?Math.min(initial,Math.max(0,p.amount)):0;
   initial=round(initial-skip);const amount=round(p.amount-skip);if(amount>0)output.push({...p,amount});
  }
 }
 return output.sort((a,b)=>Date.parse(b.date)-Date.parse(a.date));
}
export type StatementRow={id:string,date:string,label:string,party:string,charge:number,settled:number,note:string,kind:'document'|'return'|'payment'|'refund',balance:number};
export function partyStatement(s:State,type:'sale'|'purchase',partyId='',from='',to=''){
 const docs=s.entries.filter(e=>posted(e)&&e.type===type&&(!partyId||e.partyId===partyId));
 const ids=new Set(docs.map(e=>e.id)),rows:StatementRow[]=[];
 const add=(id:string,date:string,label:string,party:string,delta:number,note:string,kind:StatementRow['kind'])=>rows.push({id,date,label,party,charge:Math.max(0,round(delta)),settled:Math.max(0,round(-delta)),note,kind,balance:0});
 for(const e of docs)add(e.id,e.date,(type==='purchase'?'Накладная № ':'Продажа № ')+e.number,e.party,e.total,e.note,'document');
 const returns=s.entries.filter(e=>posted(e)&&e.target&&ids.has(e.target)&&['sale_return','purchase_return','purchase_return_reversal'].includes(e.type));
 const returnIds=new Set(returns.map(e=>e.id));
 for(const e of returns)add(e.id,e.date,(e.type==='purchase_return_reversal'?'Отмена возврата № ':'Возврат № ')+e.number,e.party,e.type==='purchase_return_reversal'?e.total:-e.total,e.note,'return');
 for(const p of s.payments){
  if(p.target&&ids.has(p.target)&&(type==='purchase'?['payout','payout_reversal'].includes(p.kind):p.kind==='receipt'))add(p.id,p.date,p.kind==='payout_reversal'?'Отмена оплаты':'Оплата',p.party,type==='purchase'?p.amount:-p.amount,p.note,'payment');
  if(p.target&&returnIds.has(p.target)&&['sale_return','purchase_return','purchase_return_reversal'].includes(p.kind))add(p.id,p.date,p.kind==='purchase_return_reversal'?'Отмена возврата денег':'Возврат денег',p.party,type==='purchase'?p.amount:-p.amount,p.note,'refund');
 }
 rows.sort((a,b)=>Date.parse(a.date)-Date.parse(b.date));
 let running=0,opening=0;
 for(const row of rows){running=round(running+row.charge-row.settled);row.balance=running;if(from&&localDay(row.date)<from)opening=running;}
 const visible=rows.filter(r=>inPeriod(r.date,from,to));
 const charges=round(visible.reduce((n,r)=>n+r.charge,0)),settled=round(visible.reduce((n,r)=>n+r.settled,0));
 return {rows:visible,opening,charges,settled,closing:round(opening+charges-settled),currentDebt:round(docs.reduce((n,e)=>n+debt(e),0))};
}
export function abcxyz(s:State,entries:Entry[],from:string,to:string){
 const es=entries.filter(e=>posted(e)&&['sale','sale_return'].includes(e.type)&&inPeriod(e.date,from,to));
 const dates=es.map(e=>localDay(e.date)).sort(),today=localDay(new Date().toISOString());
 const start=from||dates[0]||today,end=to||[today,...dates].sort().at(-1)!;
 const monthIndex=(d:string)=>Number(d.slice(0,4))*12+Number(d.slice(5,7))-1;
 const months=Math.max(0,monthIndex(end)-monthIndex(start)+1);
 const data=s.products.map(p=>{
  const metrics=productSales(es,p.id),values=new Map<string,number>();
  for(const e of es){const month=localDay(e.date).slice(0,7),qty=e.lines.filter(l=>l.id===p.id).reduce((n,l)=>n+l.qty,0)*(e.type==='sale'?1:-1);values.set(month,(values.get(month)||0)+qty)}
  const sum=[...values.values()].reduce((a,b)=>a+b,0),mean=months?sum/months:0;
  const variance=months?[...values.values()].reduce((n,v)=>n+v*v,0)/months-mean*mean:0;
  const cv=months>=2&&mean>0?Math.sqrt(Math.max(0,variance))/mean*100:null;
  return {...p,...metrics,cv,xyz:cv===null?'—':cv<=10?'X':cv<=25?'Y':'Z'};
 }).sort((a,b)=>b.revenue-a.revenue);
 const total=data.reduce((n,p)=>n+Math.max(0,p.revenue),0);let cumulative=0;
 return data.map(p=>{const prior=total?cumulative/total*100:100;cumulative+=Math.max(0,p.revenue);return {...p,share:total?Math.max(0,p.revenue)/total*100:0,abc:total&&p.revenue>0?(prior<80?'A':prior<95?'B':'C'):'—'}});
}
