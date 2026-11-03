import type {State,Product} from './ledger';
import type {StockSplit} from './stock-sources';
const empty=():StockSplit=>({paid:0,credit:0,unknown:0});
const q=(n:number)=>Math.round(n*1000)/1000;
const validQty=(v:unknown)=>Number.isFinite(Number(v))&&Number(v)>0&&Number(v)<=1e9?Number(v):0;

// The cashier receives quantities only. The server derives them from its own drafts.
export function draftStock(s:State):Record<string,StockSplit>{
 if(s.cashierIncomingStock)return structuredClone(s.cashierIncomingStock);
 const result:Record<string,StockSplit>={};
 const add=(id:string|undefined,origin:'paid'|'credit',qty:number)=>{if(!id||!s.products.some(p=>p.id===id))return;const b=result[id]??=empty();b[origin]=q(b[origin]+qty)};
 for(const e of s.entries)if(e.type==='purchase'&&e.status==='draft'){
  const origin=e.total>0&&Number(e.draftPaid||0)>=e.total?'paid':'credit';
  for(const l of e.lines)if(l.kind!=='service')add(l.id,origin,validQty(l.qty));
 }
 for(const d of s.paidStockDrafts||[])for(const r of d.rows)add(r.productId,'paid',r.packaging?validQty(r.packaging.volume)*validQty(r.packaging.count):validQty(r.qty));
 return result;
}
export function saleStock(s:State,id:string):StockSplit{
 const b=s.stockSources?.balances[id]||empty(),incoming=draftStock(s)[id]||empty();
 return {paid:q(Math.max(0,b.paid+incoming.paid)),credit:q(Math.max(0,b.credit+incoming.credit)),unknown:q(Math.max(0,b.unknown))};
}
export function saleStockQty(s:State,id:string){const b=saleStock(s,id);return q(b.paid+b.credit+b.unknown)}
export function inventoryValue(p:Product){return p.stockValue??p.qty*p.cost}
export function pendingStockCount(s:State){return new Set((s.stockAdvances||[]).filter(x=>x.remaining>.000001).map(x=>x.saleId)).size}
export function saleNeedsDraft(s:State,lines:any[]){return lines.some(l=>{
 if(l.kind==='service')return false;
 const available=saleStock(s,l.id),actual=s.stockSources?.balances[l.id]||empty();
 const keys=(['paid','credit','unknown'] as const).filter(k=>available[k]>0);
 const origin:string=String(l.stockOrigin||(keys.length===1?keys[0]:''));
 if(origin==='split')return (['paid','credit','unknown'] as const).some(k=>Number(l.stockSplit?.[k]||0)>Math.max(0,actual[k])+.000001);
 if(origin==='paid'||origin==='credit'||origin==='unknown')return Number(l.qty)>Math.max(0,actual[origin])+.000001;
 return Number(l.qty)>Object.values(actual).reduce((n,v)=>n+Math.max(0,v),0)+.000001;
})}
