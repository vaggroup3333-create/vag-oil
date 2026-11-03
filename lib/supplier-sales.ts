import type {State, Entry, Line} from './ledger';
import {debt, posted, round} from './ledger';
import {inPeriod, saleLineAmounts, stockMovement} from './reporting';
import {q, receiptOrigin, stockOrigins} from './stock-sources';
import type {StockOrigin} from './stock-sources';

export const UNKNOWN_SUPPLIER='@unknown';
export const OWN_STOCK='@opening';
export type SupplierSaleRow={
 id:string;supplierId:string;supplierName:string;productId:string;name:string;article:string;unit:string;
 entryId:string;number:string;date:string;type:string;receiptId:string;receiptNumber:string;
 sold:number;returned:number;qty:number;revenue:number;cost:number;receiptDebt:number;receiptPaid:number;
 receiptTotal:number;reason:string;sources:string[];pending:boolean;
};
export type SupplierSalesGroup={id:string;name:string;currentDebt:number;rows:SupplierSaleRow[]};
type Candidate={id:string;name:string;receipt:Entry;origin:StockOrigin};

// Allocate cents, rather than rounded unit costs, so source rows sum to the saved receipt.
function splitMoney(total:number,weights:number[]){
 const sum=weights.reduce((a,b)=>a+b,0),sign=total<0?-1:1,cents=Math.round(Math.abs(total)*100);
 if(!sum)return weights.map((_,i)=>i?0:total);
 const raw=weights.map(w=>cents*w/sum),out=raw.map(Math.floor);
 const order=raw.map((n,i)=>({i,rest:n-out[i]})).sort((a,b)=>b.rest-a.rest||a.i-b.i);
 for(let n=cents-out.reduce((a,b)=>a+b,0),i=0;i<n;i++)out[order[i%order.length].i]++;
 return out.map(n=>sign*n/100);
}
function parts(line:Line):{origin:StockOrigin;qty:number}[]{
 const split=line.stockSplit;
 if(split&&stockOrigins.every(k=>Number.isFinite(split[k])&&split[k]>=0)&&Math.abs(stockOrigins.reduce((n,k)=>n+split[k],0)-line.qty)<.000001)
  return stockOrigins.filter(k=>split[k]>0).map(origin=>({origin,qty:split[origin]}));
 return [{origin:stockOrigins.includes(line.stockOrigin as StockOrigin)?line.stockOrigin as StockOrigin:'unknown',qty:line.qty}];
}
export function supplierSales(s:State,from='',to=''){
 const entries=new Map(s.entries.map(e=>[e.id,e])),products=new Map(s.products.map(p=>[p.id,p]));
 const parties=new Map(s.parties.map(p=>[p.id,p])),services=new Set(s.services.map(p=>p.id));
 const incoming=new Map<string,Candidate[]>(),movement=new Map<string,number>();
 const groups=new Map<string,SupplierSalesGroup>();
 const addGroup=(id:string,name:string)=>{let g=groups.get(id);if(!g){g={id,name,currentDebt:0,rows:[]};groups.set(id,g)}return g};
 for(const p of s.parties.filter(p=>p.kind==='supplier'))addGroup(p.id,p.name);
 for(const e of s.entries.filter(posted)){
  for(const l of e.lines)if(l.kind!=='service')movement.set(l.id,q((movement.get(l.id)||0)+stockMovement(e,l.qty)));
  if(!['purchase','opening_stock'].includes(e.type)||e.cancelledAt)continue;
  const id=e.type==='opening_stock'?OWN_STOCK:e.partyId||UNKNOWN_SUPPLIER;
  const name=id===OWN_STOCK?'Начальные остатки без поставщика':id===UNKNOWN_SUPPLIER?'Поставщик не определён':parties.get(id)?.name||e.party||'Поставщик';
  const group=addGroup(id,name);if(e.type==='purchase')group.currentDebt=round(group.currentDebt+debt(e));
  for(const line of e.lines.filter(l=>l.kind!=='service'&&l.qty>0)){
   const list=incoming.get(line.id)||[];list.push({id,name,receipt:e,origin:receiptOrigin(e)});incoming.set(line.id,list);
  }
 }
 function resolve(sale:Entry|undefined,line:Line,origin:StockOrigin){
  if(!sale)return {id:UNKNOWN_SUPPLIER,name:'Поставщик не определён',reason:'Не найден исходный чек возврата.',sources:[]};
  const advances=(s.stockAdvances||[]).filter(a=>a.saleId===sale.id&&a.productId===line.id&&(origin==='unknown'||a.origin===origin));
  const linked=new Set(advances.flatMap(a=>a.settlements.map(x=>x.receiptId)));
  let candidates=(incoming.get(line.id)||[]).filter(c=>Date.parse(c.receipt.date)<=Date.parse(sale.date)||linked.has(c.receipt.id));
  // The cashier records paid/credit origin, but does not record a supplier batch.
  if(origin!=='unknown')candidates=candidates.filter(c=>c.origin===origin||c.origin==='unknown');
  const unique=new Map(candidates.map(c=>[c.id,c.name]));
  const sources=[...new Set(candidates.map(c=>c.name+' · накладная №'+c.receipt.number))];
  const p=products.get(line.id);
  const unexplained=!!p&&Math.abs(p.qty-(movement.get(line.id)||0))>.001;
  const adjustment=s.entries.some(e=>posted(e)&&['inventory','writeoff'].includes(e.type)&&Date.parse(e.date)<=Date.parse(sale.date)&&e.lines.some(l=>l.id===line.id&&l.qty>0));
  const pending=advances.some(a=>a.remaining>.000001);
  const uncertainOrigin=origin!=='unknown'&&candidates.some(c=>c.origin==='unknown');
  let reason='';
  if(pending)reason='Продажа до прихода: накладная ещё не проведена.';
  else if(unexplained||adjustment)reason='Есть остаток без подтверждённого поставщика.';
  else if(unique.size>1||uncertainOrigin)reason='Есть несколько возможных источников. В чеке конкретный поставщик не записан.';
  else if(!unique.size)reason='Не найден проведённый приход до продажи.';
  else if(unique.has(UNKNOWN_SUPPLIER))reason='В приходе не указан поставщик.';
  if(reason)return {id:UNKNOWN_SUPPLIER,name:'Поставщик не определён',reason,sources};
  const [id,name]=[...unique][0];
  return {id,name,reason:'',sources};
 }
 for(const entry of s.entries.filter(e=>posted(e)&&['sale','sale_return'].includes(e.type)&&inPeriod(e.date,from,to))){
  const sale=entry.type==='sale'?entry:entries.get(entry.target||'');
  for(const [index,amount] of saleLineAmounts(entry).entries()){
   const line=amount.line,p=products.get(line.id);
   if(line.kind==='service'||services.has(line.id))continue;
   let sourceParts=parts(line);
   if(entry.type==='sale_return'&&!line.stockSplit){
    const original=sale?.lines.find(l=>l.id===line.id),originalParts=original?parts(original):[];
    if(originalParts.length===1)sourceParts=[{origin:originalParts[0].origin,qty:line.qty}];
   }
   const revenues=splitMoney(amount.revenue,sourceParts.map(p=>p.qty)),costs=splitMoney(amount.cost,sourceParts.map(p=>p.qty));
   for(const [i,part] of sourceParts.entries()){
    const source=resolve(sale,line,part.origin),sign=entry.type==='sale'?1:-1;
    const row:SupplierSaleRow={id:entry.id+':'+index+':'+i,supplierId:source.id,supplierName:source.name,productId:line.id,
     name:line.name||p?.name||'Товар',article:p?.article||p?.code||'',unit:line.unit||p?.unit||'ед.',
     entryId:entry.id,number:entry.number,date:entry.date,type:entry.type,receiptId:sale?.id||'',receiptNumber:sale?.number||'',
     sold:sign>0?part.qty:0,returned:sign<0?part.qty:0,qty:q(sign*part.qty),revenue:round(sign*revenues[i]),cost:round(sign*costs[i]),
     receiptDebt:sale?debt(sale):0,receiptPaid:sale?.paid||0,receiptTotal:sale?.total||0,reason:source.reason,sources:source.sources,
     pending:!!sale?.costPending||(s.stockAdvances||[]).some(a=>a.saleId===sale?.id&&a.productId===line.id&&a.remaining>.000001)};
    addGroup(source.id,source.name).rows.push(row);
   }
  }
 }
 return [...groups.values()].sort((a,b)=>a.id===UNKNOWN_SUPPLIER?1:b.id===UNKNOWN_SUPPLIER?-1:a.name.localeCompare(b.name,'ru'));
}

export function supplierRowsSummary(rows:SupplierSaleRow[]){
 const sold:Record<string,number>={},returned:Record<string,number>={},net:Record<string,number>={};
 let cost=0,revenue=0;
 for(const row of rows){sold[row.unit]=q((sold[row.unit]||0)+row.sold);returned[row.unit]=q((returned[row.unit]||0)+row.returned);net[row.unit]=q((net[row.unit]||0)+row.qty);cost+=row.cost;revenue+=row.revenue}
 return {sold,returned,net,cost:round(cost),revenue:round(revenue),products:new Set(rows.map(r=>r.productId)).size};
}
