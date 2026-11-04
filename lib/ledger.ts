import type {SaleActor} from './sale-actor';
import {finishAdvanceAction,advanceGuard,advanceReceiptReason,receiptAverage,physicalSplit} from './stock-advances';
import type {StockAdvance} from './stock-advances';
import {inventoryValue,pendingStockCount} from './draft-stock';
import {initializeStockSources,prepareSourceAction,finishSourceAction,verifyStockSources,assignUnknownStock} from './stock-sources';
import type {StockOrigin,StockSplit,StockSources} from './stock-sources';
import {applyPaidStockDraft} from './paid-stock';
import {invoiceDuplicate} from './invoice-duplicates';
import {applyOpeningStock} from './opening-stock';
import {initial as oldInitial} from './legacy-ledger';
import {packageSpec,receivePackages,consumePackages,removePurchasePackages,returnPackages,restoreReturnPackages} from './packaging';
import type {PackSpec,PackLot} from './packaging';
export type Product={stockValue?:number,id:string,code:string,name:string,article:string,barcode:string,qrCode?:string,category:string,unit:string,qty:number,cost:number,price:number,wholesale:number,location:string,min:number,favorite:boolean,imageKey?:string,wholeOnly?:boolean};
export type Party={id:string,name:string,phone:string,kind:string,note:string};
export type Line={stockOrigin?:StockOrigin|'split',stockSplit?:StockSplit,packaging?:PackSpec,saleMode?:'sealed'|'bulk',returnSealed?:boolean,id:string,name:string,qty:number,price:number,cost:number,unit?:string,kind?:string,returnCostAmount?:number,discount?:number,expense?:number,retail?:number,wholesale?:number};
export type OpeningSnapshot={productId:string,beforeQty:number,beforeCost:number,afterQty:number,afterCost:number};
export type PaidStockRow={key:string,productId?:string,unit?:string,product?:{name:string,article:string,barcode:string,qrCode:string,category:string,unit:string,price:string,wholesale:string},qty:string,cost:string,packaging?:PackSpec};
export type PaidStockDraft={additionalExpense?:string,expenseAllocation?:'value'|'quantity',id:string,title?:string,revision:number,createdAt:string,updatedAt:string,date:string,owner?:''|'self'|'partner',note:string,rows:PaidStockRow[]};
export type Entry={cashier?:SaleActor,costPending?:boolean,expenseAllocation?:'value'|'quantity',stockOrigin?:StockOrigin,id:string,number:string,title?:string,date:string,createdAt:string,type:string,status:string,party:string,partyId?:string,car?:string,mileage?:string,phone?:string,lines:Line[],total:number,paid:number,credit:number,cost:number,service:number,discount:number,discountMode?:string,discountValue?:number,expenses?:number,expenseAccount?:string,note:string,target?:string,account?:string,paymentMethod?:string,received?:number,change?:number,draftPaid?:number,initialPaid?:number,refund?:number,returnCostRounding?:number,variance?:number,openingKind?:'initial'|'addition',openingOwner?:'self'|'partner',openingStockSnapshots?:OpeningSnapshot[],openingStockSnapshot?:{productId:string,beforeQty:number,beforeCost:number,afterQty:number,afterCost:number},requestId?:string,cancelledAt?:string,cancelledBy?:string,reversalId?:string,reversalOf?:string,returnPackageChanges?:{productId:string,before:PackLot[],after:PackLot[]}[],deletedAt?:string,deletedStatus?:string,deletionStock?:{id:string,beforeQty:number,beforeCost:number,afterQty:number,afterCost:number}[],deletedPackageLots?:PackLot[],deletedPayments?:State['payments']};
export type Payment={id:string,date:string,amount:number,account:string,kind:string,party:string,target?:string,note:string,operationId?:string,cancelledAt?:string,cancelledBy?:string,cancellationReason?:string,reversalId?:string,reversalOf?:string};
export type State={stockAdvances?:StockAdvance[],cashierIncomingStock?:Record<string,StockSplit>,stockSources?:StockSources,stockSourceNotes?:{id:string,date:string,productId:string,qty:number,paid:number,credit:number,actor:string}[],paidStockDrafts?:PaidStockDraft[],packageLots?:PackLot[],categories?:string[],products:Product[],entries:Entry[],parties:Party[],services:{id:string,name:string,price:number}[],accounts:{id:string,name:string}[],payments:Payment[],shifts:{id:string,opened:string,closed?:string,expected?:number,actual?:number,note?:string}[],settings:{name:string},schema:number;priceHistory?:{id:string,date:string,productId:string,oldRetail:number,retail:number,oldWholesale:number,wholesale:number,source:string}[]};
export const round=(x:number)=>Math.round((x+Number.EPSILON)*100)/100+0;
const qround=(x:number)=>Math.round(x*1000)/1000;
export function normalize(raw:any):State{
 const s=structuredClone(raw);s.parties??=[];s.services??=[];s.accounts??=[{id:'cash',name:'Наличная касса'},{id:'city',name:'Душанбе Сити'},{id:'alif',name:'Алиф Моби'}];s.shifts??=[];s.priceHistory??=[];s.settings??={name:'VAG Oil'};
 s.products=s.products.map((p:any,i:number)=>({code:String(100001+i),article:'',barcode:'',wholesale:p.price,location:'',min:5,favorite:false,wholeOnly:p.unit==='шт',...p}));
 const legacy=!s.payments;s.payments??=[];
 s.entries=s.entries.map((e:any,i:number)=>({number:String(i+1).padStart(6,'0'),createdAt:e.date,status:'posted',lines:[],credit:0,discount:0,note:'',service:0,...e}));
 if(legacy){for(const e of s.entries){if(['sale','purchase'].includes(e.type)){const add=s.entries.filter((p:any)=>p.target===e.id&&['receipt','payout'].includes(p.type)).reduce((n:number,p:any)=>n+p.total,0);e.initialPaid=round(e.paid-add);if(e.initialPaid)s.payments.push({id:e.id+'-init',date:e.date,amount:e.type==='sale'?e.initialPaid:-e.initialPaid,account:'cash',kind:e.type==='sale'?'receipt':'payout',party:e.party,target:e.id,note:'Оплата при оформлении'});}else if(['receipt','payout','expense'].includes(e.type))s.payments.push({id:e.id,date:e.date,amount:e.type==='receipt'?e.total:-e.total,account:'cash',kind:e.type,party:e.party,target:e.target,note:e.note});}}
 for(const e of s.entries.filter((e:any)=>!e.partyId&&['sale','purchase'].includes(e.type))){const kind=e.type==='purchase'?'supplier':'client';let p=s.parties.find((p:Party)=>p.name===e.party&&p.kind===kind);if(!p){p={id:'legacy-'+e.id,name:e.party,kind,phone:e.phone||'',note:''};s.parties.push(p)}e.partyId??=p.id;}
 s.categories=Array.from(new Map([...['Масло','Фильтры','Антифриз','Жидкости','Другое'],...(s.categories||[]),...s.products.map((p:Product)=>p.category)].map((name:string)=>[name.trim().toLocaleLowerCase('ru'),name.trim()])).values()).filter(Boolean);
 s.schema=2;initializeStockSources(s);return s;
}
export function initial(demo:boolean):State{return normalize(oldInitial(demo));}
export const posted=(e:Entry)=>e.status==='posted';
export const activeReturn=(e:Entry)=>posted(e)&&!e.cancelledAt;
function restoreSupplierReturnStock(s:State,e:Entry,source:Entry){
 const seen=new Set<string>();
 for(const line of e.lines){
  const p=s.products.find(p=>p.id===line.id),original=source.lines.find(l=>l.id===line.id&&l.kind!=='service');
  if(!p||!original||seen.has(line.id)||!Number.isFinite(line.qty)||line.qty<=0||line.qty>original.qty||!Number.isFinite(line.cost)||line.cost<0||!Number.isFinite(line.price)||line.price<0)throw Error('Не удалось восстановить строки возврата. Нужна проверка документа');
  seen.add(line.id);
  if(!Number.isFinite(p.qty)||(p.qty<0&&p.stockValue===undefined)||!Number.isFinite(p.cost)||p.cost<0||p.wholeOnly&&!Number.isInteger(line.qty))throw Error('Сначала исправьте остаток или единицу учёта товара «'+p.name+'»');
  restoreReturnPackages(s,p,source,original,line.qty,e.returnPackageChanges);
  const qty=qround(p.qty+line.qty);if(qty>1e9)throw Error('Превышен допустимый остаток товара');
  p.cost=receiptAverage(p,line.qty,line.cost);p.qty=qty;
 }
}

// Round cumulative returns once, then deduct amounts already returned.
// This prevents repeated partial returns from creating or losing kopecks.
export function returnQuote(s:State,source:Entry,requests:{id:string,qty:number,cost?:number}[]){
 const allocate=(total:number,weights:number[])=>{
  const sum=weights.reduce((n,v)=>n+v,0),cents=Math.round(total*100);
  if(!sum)return weights.map((_,i)=>i===0?cents/100:0);
  const raw=weights.map(w=>cents*w/sum),parts=raw.map(Math.floor);
  const order=raw.map((v,i)=>({i,fraction:v-parts[i]})).sort((a,b)=>b.fraction-a.fraction||a.i-b.i);
  for(let n=cents-parts.reduce((a,b)=>a+b,0),i=0;n>0;n--,i++)parts[order[i%order.length].i]++;
  return parts.map(v=>v/100);
 };
 const previous=s.entries.filter(e=>activeReturn(e)&&e.target===source.id&&['sale_return','purchase_return'].includes(e.type));
 const budgets=allocate(source.total,[...source.lines.map(l=>Math.max(0,l.qty*l.price-(l.discount||0))),...(source.type==='sale'&&source.service?[source.service]:[])]);
 const costBudgets=allocate(source.cost,source.lines.map(l=>Math.max(0,l.qty*l.cost)));
 const prior=new Map<string,{qty:number,amount:number,cost:number,rawCost:number}>();
 for(const e of previous){
  const amounts=allocate(e.total,e.lines.map(l=>Math.max(0,l.qty*l.price)));
  const costs=allocate(e.cost,e.lines.map(l=>Math.max(0,l.qty*l.cost)));
  e.lines.forEach((line,i)=>{const p=prior.get(line.id)||{qty:0,amount:0,cost:0,rawCost:0};p.qty+=line.qty;p.amount+=amounts[i];p.cost+=line.returnCostAmount??costs[i];p.rawCost+=line.qty*line.cost;prior.set(line.id,p)});
 }
 const lines=requests.filter(l=>Number.isFinite(l.qty)&&l.qty>0&&source.lines.some(v=>v.id===l.id&&v.kind!=='service')).map(line=>{
  const i=source.lines.findIndex(l=>l.id===line.id),original=source.lines[i],p=prior.get(line.id)||{qty:0,amount:0,cost:0,rawCost:0};
  const fraction=Math.min(1,qround(p.qty+line.qty)/original.qty);
  const amount=round(Math.max(0,round(budgets[i]*fraction)-round(p.amount)));
  const rawCost=line.qty*(line.cost??(source.type==='sale'?original.cost:s.products.find(p=>p.id===line.id)?.cost)??0);
  const targetCost=source.type==='sale'?round(costBudgets[i]*fraction):round(p.rawCost+rawCost);
  const costAmount=round(Math.max(0,targetCost-round(p.cost)));
  return {id:line.id,amount,costAmount};
 });
 return {total:round(lines.reduce((n,l)=>n+l.amount,0)),cost:round(lines.reduce((n,l)=>n+l.costAmount,0)),lines};
}

export function supplierReturnCancellationReason(s:State,returnId:string):string{
 const e=s.entries.find(e=>e.id===returnId&&e.type==='purchase_return');
 if(!e||!posted(e))return 'Возврат не проведён';
 if(e.cancelledAt||e.reversalId||s.entries.some(r=>r.reversalOf===e.id))return 'Этот возврат уже отменён';
 const source=s.entries.find(x=>x.id===e.target&&x.type==='purchase'&&posted(x));
 if(!source)return 'Исходная накладная не проведена';
 const refund=Number(e.refund||0);
 if(!e.lines.length||!Number.isFinite(e.total)||e.total<0||!Number.isFinite(e.cost)||!Number.isFinite(refund)||refund<0||refund>e.total||!Number.isFinite(Date.parse(e.date)))return 'В возврате не хватает данных. Нужна проверка';
 if(Math.abs(round(e.lines.reduce((n,l)=>n+l.qty*l.price,0))-e.total)>.01||Math.abs(round(e.lines.reduce((n,l)=>n+l.qty*l.cost,0)+(e.returnCostRounding||0))-e.cost)>.011)return 'Суммы строк возврата не совпадают с документом';
 if(!Number.isFinite(source.credit)||!Number.isFinite(source.total)||!Number.isFinite(source.paid)||round(source.credit-e.total)<0)return 'Сумма возвратов не совпадает с накладной';
 const active=s.entries.filter(x=>activeReturn(x)&&x.type==='purchase_return'&&x.target===source.id);
 if(Math.abs(round(active.reduce((n,x)=>n+x.total,0))-source.credit)>.01)return 'Сумма возвратов не совпадает с накладной';
 const restoredDebt=round(debt({...source,credit:round(source.credit-e.total)})-debt(source));
 if(restoredDebt!==round(e.total-refund))return 'Сначала отмените более поздний возврат по этой накладной, по которому поставщик вернул деньги';
 const payments=s.payments.filter(p=>p.target===e.id);
 if(payments.some(p=>p.kind!=='purchase_return'||p.amount<=0||p.cancelledAt||p.reversalId||!s.accounts.some(a=>a.id===p.account)||!Number.isFinite(Date.parse(p.date)))||round(payments.reduce((n,p)=>n+p.amount,0))!==refund)return 'Поступление денег по возврату не совпадает с документом. Нужна проверка';
 try{restoreSupplierReturnStock(structuredClone(s),e,source)}catch(error){return (error as Error).message}
 return '';
}
export function productUnitChangeReason(s:State,id:string):string{
 const p=s.products.find(p=>p.id===id);if(!p)return '';
 if(s.entries.some(e=>(posted(e)||(e.status==='deleted'&&e.deletedStatus==='posted'))&&e.lines.some(l=>l.id===id&&l.kind!=='service')))return 'Единицу учёта нельзя изменить: по товару есть проведённые операции.';
 if(p.qty!==0)return 'Единицу учёта нельзя изменить: у товара есть остаток.';
 return '';
}
export const debt=(e:Entry)=>Math.max(0,round(e.total-e.credit-e.paid));
export const balance=(s:State,id?:string)=>round(s.payments.filter(p=>!id||p.account===id).reduce((n,p)=>n+p.amount,0));
// Keep original payments and append a dated reversal so historical cash stays intact.
export function supplierPaymentGroup(s:State,paymentId:string):Payment[]{
 const payment=s.payments.find(p=>p.id===paymentId&&p.kind==='payout');
 if(!payment)return [];
 return payment.operationId?s.payments.filter(p=>p.kind==='payout'&&p.operationId===payment.operationId):[payment];
}
export function supplierPaymentCancellationReason(s:State,paymentId:string):string{
 const group=supplierPaymentGroup(s,paymentId);
 if(!group.length)return 'Оплата поставщику не найдена';
 if(group.some(p=>p.cancelledAt||p.reversalId||s.payments.some(r=>r.reversalOf===p.id)))return 'Эта оплата уже отменена';
 if(new Set(group.map(p=>p.id)).size!==group.length)return 'В истории есть повторяющиеся платежи. Нужна проверка данных';
 const byDocument=new Map<string,number>();
 for(const p of group){
  if(!Number.isFinite(p.amount)||p.amount>=0||!p.target||!Number.isFinite(Date.parse(p.date)))return 'Не удалось определить сумму или документ оплаты';
  if(!s.accounts.some(a=>a.id===p.account))return 'Касса этой оплаты не найдена';
  byDocument.set(p.target,round((byDocument.get(p.target)||0)-p.amount));
 }
 for(const [target,amount] of byDocument){
  const entry=s.entries.find(e=>e.id===target&&e.type==='purchase'&&posted(e));
  if(!entry)return 'Исходная накладная не проведена. Откройте её и проверьте статус';
  if(!Number.isFinite(entry.paid)||round(entry.paid-amount)<0)return 'Сумма оплаты не совпадает с накладной. Нужна проверка данных';
  if(round(debt({...entry,paid:round(entry.paid-amount)})-debt(entry))!==amount)return 'По накладной уже возвращались деньги от поставщика. Простая отмена этой оплаты недоступна';
 }
 return '';
}
function num(x:any,min=0){const n=Number(x??0);if(!Number.isFinite(n)||n<min||n>1e9)throw Error('Проверьте сумму или количество');return n;}
function str(x:any,required=false){const s=String(x??'').trim().slice(0,300);if(required&&!s)throw Error('Заполните обязательные поля');return s;}
function eventDate(v:any,now:string){if(!v)return now;const s=String(v),parsed=Date.parse(s);if(!/^\d{4}-\d{2}-\d{2}$/.test(s)||Number.isNaN(parsed)||new Date(parsed).toISOString().slice(0,10)!==s)throw Error('Некорректная дата');const currentDay=new Date(Date.parse(now)+5*3600000).toISOString().slice(0,10);return s===currentDay?now:s+'T12:00:00+05:00';}
export function purchaseDeletionReason(s:State,e:Entry):string{
 if(e.type!=='purchase'||!['draft','cancelled','posted'].includes(e.status))return 'Накладная не найдена или уже удалена';
 const advanceReason=advanceReceiptReason(s,e.id);if(advanceReason)return advanceReason;
 if(e.status!=='posted')return '';
 if(s.payments.some(p=>p.target===e.id&&(p.cancelledAt||p.kind==='payout_reversal')))return 'У накладной есть отменённые оплаты. Накладная сохраняется для истории';
 if(!e.lines.length)return 'В старой накладной нет строк товаров. Удаление без проверки остатков недоступно';
 if(s.entries.some(x=>posted(x)&&x.target===e.id))return 'У накладной есть возврат или связанный документ. Удаление недоступно';
 const ids=new Set(e.lines.map(l=>l.id));
 if(s.entries.some(x=>x.id!==e.id&&posted(x)&&x.lines.some(l=>ids.has(l.id))))return 'По товарам накладной есть другие проведённые документы. Используйте возврат поставщику';
 if(s.payments.some(p=>p.target===e.id&&!['payout','purchase_expense'].includes(p.kind)))return 'У накладной есть связанные операции, которые нельзя отменить удалением';
 if(s.payments.some(p=>p.target===e.id&&s.shifts.some(x=>x.closed&&Date.parse(p.date)>=Date.parse(x.opened)&&Date.parse(p.date)<=Date.parse(x.closed!))))return 'Оплаты накладной входят в закрытую смену. Удаление недоступно';
 for(const l of e.lines){const p=s.products.find(p=>p.id===l.id);if(!p||!Number.isFinite(l.cost)||p.qty<l.qty||p.qty*p.cost-l.qty*l.cost<-.01)return 'Текущие остатки не позволяют отменить эту закупку';}
 return '';
}
export function canUndoReturnedPurchase(s:State,e:Entry):boolean{
 if(e.type!=='purchase'||!posted(e)||!e.lines.length||e.paid!==0||Math.abs(e.total-e.credit)>.01)return false;
 const linked=s.entries.filter(x=>posted(x)&&x.target===e.id);
 if(!linked.length||linked.some(x=>x.type!=='purchase_return'||x.paid!==0||Number(x.refund||0)!==0))return false;
 const ids=new Set([e.id,...linked.map(x=>x.id)]);
 if(s.payments.some(p=>ids.has(p.target||'')&&p.amount!==0))return false;
 if(Math.abs(round(linked.reduce((n,x)=>n+x.total,0))-e.total)>.01)return false;
 const returned=linked.flatMap(x=>x.lines);
 if(returned.some(l=>!e.lines.some(x=>x.id===l.id)))return false;
 return e.lines.every(l=>{
  const matches=returned.filter(x=>x.id===l.id);
  return !!s.products.find(p=>p.id===l.id)&&Math.abs(matches.reduce((n,x)=>n+x.qty,0)-l.qty)<.000001&&Math.abs(matches.reduce((n,x)=>n+x.qty*x.cost,0)-l.qty*l.cost)<.000001;
 });
}
export function purchaseUnpostReason(s:State,e:Entry):string{
 if(e.type!=='purchase'||!['posted','cancelled'].includes(e.status))return 'Можно вернуть в черновик проведённую или отменённую накладную';
 if(e.status==='cancelled')return '';
 if(canUndoReturnedPurchase(s,e))return '';
 const reason=purchaseDeletionReason(s,e);if(reason)return reason.replace('Удаление','Отмена проведения').replace('удалением','отменой проведения');
 const payouts=s.payments.filter(p=>p.target===e.id&&p.kind==='payout');
 if(Math.abs(round(payouts.reduce((n,p)=>n-p.amount,0))-Number(e.initialPaid??e.paid))>.01)return 'По накладной есть дополнительные оплаты. Отмена проведения недоступна';
 return '';
}
export type ApplyContext={cashier?:SaleActor,skipStockSources?:boolean,id?:string,now?:string,number?:string,allowNegativeStock?:boolean,role?:string,actor?:string};
export function apply(raw:State,a:any,context:ApplyContext={}):State{
 if(context.skipStockSources)return applyCore(raw,a,context);
 const before=normalize(raw);
 if(a?.type==='stock_origin_assign'){advanceGuard(before,a);return assignUnknownStock(before,a,context);}
 const action=prepareSourceAction(before,a);
 advanceGuard(before,action);
 const next=applyCore(before,action,{...context,allowNegativeStock:action.type==='sale'&&action.allowDraftStock===true,skipStockSources:true});
 finishSourceAction(before,next,action);finishAdvanceAction(before,next,action);verifyStockSources(next);return next;
}
function applyCore(raw:State,a:any,context:ApplyContext={}):State{
 const s=normalize(raw),now=context.now||new Date().toISOString(),id=context.id||crypto.randomUUID(),date=eventDate(a.date,now);
 const doc=()=>({id,number:context.number||String(s.entries.length+1).padStart(6,'0'),date,createdAt:now,type:a.type,status:'posted',party:str(a.party),lines:[],total:0,paid:0,credit:0,cost:0,service:0,discount:0,note:str(a.note),...(context.cashier&&['sale','return'].includes(a.type)?{cashier:{...context.cashier}}:{})} as Entry);
 const account=(v:any)=>{if(!s.accounts.some(p=>p.id===v))throw Error('Выберите кассу');return v;};
 const cash=(amount:number,kind:string,party:string,target?:string,acc=a.account,note=str(a.note))=>{if(!amount)return;account(acc);s.payments.push({id:crypto.randomUUID(),date,amount:round(amount),account:acc,kind,party,target,note,...(kind==='payout'?{operationId:id}:{})});};
 if(['paid_stock_title','paid_stock_draft_new','paid_stock_draft_save','paid_stock_draft_delete','paid_stock_draft_post'].includes(a.type))return applyPaidStockDraft(s,a,context);
 if(['opening_stock','paid_stock_add','cancel_opening_stock'].includes(a.type))return applyOpeningStock(s,a,context);
 if(a.type==='category'){const name=str(a.name,true);if(name.length>100)throw Error('Название категории должно быть не длиннее 100 символов');if(!s.categories!.some(c=>c.toLocaleLowerCase('ru')===name.toLocaleLowerCase('ru')))s.categories!.push(name);return s;}
 if(a.type==='settings'){s.settings.name=str(a.name,true);return s;}
 if(a.type==='account'){const name=str(a.name,true);if(s.accounts.some(p=>p.name.toLowerCase()===name.toLowerCase()))throw Error('Такая касса уже есть');s.accounts.push({id,name});return s;}
 if(a.type==='party'){const name=str(a.name,true),kind=a.kind==='supplier'?'supplier':'client';if(s.parties.some(p=>p.id!==a.id&&p.kind===kind&&p.name.toLowerCase()===name.toLowerCase()))throw Error('Контрагент с таким именем уже есть');const old=s.parties.find(p=>p.id===a.id);if(old){old.name=name;old.phone=str(a.phone);old.note=str(a.note);}else s.parties.push({id,name,kind,phone:str(a.phone),note:str(a.note)});return s;}
 if(a.type==='service'){const v={id:a.id||id,name:str(a.name,true),price:round(num(a.price))};const i=s.services.findIndex(p=>p.id===a.id);if(i>=0)s.services[i]=v;else s.services.push(v);return s;}
 if(a.type==='favorite'){const p=s.products.find(p=>p.id===a.id);if(!p)throw Error('Товар не найден');p.favorite=!p.favorite;return s;}
 if(a.type==='product'){
 const old=s.products.find(p=>p.id===a.id);const barcode=str(a.barcode),qrCode=String(a.qrCode===undefined?old?.qrCode||'':a.qrCode??'').trim();if(qrCode.length>300)throw Error('QR-код слишком длинный: максимум 300 символов');if(barcode&&s.products.some(p=>p.id!==a.id&&(p.barcode===barcode||p.qrCode===barcode)))throw Error('Этот штрихкод уже используется у другого товара');if(qrCode&&s.products.some(p=>p.id!==a.id&&(p.qrCode===qrCode||p.barcode===qrCode)))throw Error('Этот QR-код уже используется у другого товара');
 const unit=a.unit===undefined?(old?.unit||'шт'):a.unit;if(!['л','шт'].includes(unit))throw Error('Выберите единицу учёта');if(old&&unit!==old.unit){const reason=productUnitChangeReason(s,old.id);if(reason)throw Error(reason);}
 const p={...old,id:old?.id||id,code:old?.code||String(100001+s.products.length),name:str(a.name,true),article:str(a.article),barcode,qrCode,category:str(a.category,true),unit,qty:old?.qty||0,cost:old?.cost||0,price:round(num(a.price)),wholesale:round(num(a.wholesale??a.price)),location:str(a.location),min:num(a.min??5),favorite:old?.favorite||false,wholeOnly:typeof a.wholeOnly==='boolean'?a.wholeOnly:old?.wholeOnly??(a.unit==='шт'),imageKey:a.imageKey===undefined?old?.imageKey:String(a.imageKey||'')};if((s.packageLots||[]).some(l=>l.productId===p.id)&&(p.unit!=='л'||p.wholeOnly))throw Error('Для учёта упаковок сохраните дробный учёт в литрах');if(p.wholeOnly&&!Number.isInteger(p.qty))throw Error('У товара дробный остаток: штучный режим пока включить нельзя');if(p.imageKey&&!/^[a-f0-9-]{36}\.(jpg|png|webp|gif)$/.test(p.imageKey))throw Error('Неверная ссылка на фото');if(old&&(old.price!==p.price||old.wholesale!==p.wholesale))s.priceHistory!.push({id:crypto.randomUUID(),date:now,productId:p.id,oldRetail:old.price,retail:p.price,oldWholesale:old.wholesale,wholesale:p.wholesale,source:'Карточка товара'});if(old&&unit!==old.unit)for(const e of s.entries){if(e.status==='draft'||(e.status==='deleted'&&e.deletedStatus==='draft'))for(const l of e.lines)if(l.id===old.id&&l.kind!=='service')l.unit=unit;}if(a.initialPurchase&&(old||p.unit!=='л'))throw Error('Приход из карточки доступен только для нового литрового товара');if(old)s.products[s.products.indexOf(old)]=p;else s.products.push(p);return a.initialPurchase?saveInitialPurchase(s,p,a.initialPurchase,now):s;
 }
 if(a.type==='shift_open'){if(s.shifts.some(x=>!x.closed))throw Error('Смена уже открыта');s.shifts.push({id,opened:now,note:str(a.note)});return s;}
 if(a.type==='shift_close'){const shift=s.shifts.find(x=>!x.closed);if(!shift)throw Error('Нет открытой смены');shift.closed=now;shift.expected=balance(s,'cash');shift.actual=round(num(a.actual));shift.note=str(a.note);return s;}
 if(a.type==='cash_in'||a.type==='cash_out'||a.type==='income'||a.type==='expense'){
 const total=round(num(a.total,0.01)),party=str(a.party,true);cash(['cash_in','income'].includes(a.type)?total:-total,a.type,party,id);
 const e=doc();Object.assign(e,{party,total,paid:total,account:a.account});s.entries.push(e);return s;
 }
 if(a.type==='transfer'){const total=round(num(a.total,0.01));account(a.to);account(a.account);if(a.to===a.account)throw Error('Выберите разные кассы');cash(-total,'transfer','Между своими счетами',id);cash(total,'transfer','Между своими счетами',id,a.to);s.entries.push({...doc(),party:'Между своими счетами',total,paid:total,account:a.account,note:s.accounts.find(x=>x.id===a.account)!.name+' → '+s.accounts.find(x=>x.id===a.to)!.name});return s;}
 if(a.type==='cancel_supplier_payment'){
  if(context.role!=='director')throw Error('Отменять оплату может только директор');
  const reason=supplierPaymentCancellationReason(s,a.id);if(reason)throw Error(reason);
  const group=supplierPaymentGroup(s,a.id),amount=round(group.reduce((sum,p)=>sum-p.amount,0));
  if(round(num(a.amount,0.01))!==amount)throw Error('Сумма оплаты изменилась. Обновите страницу');
  const note=str(a.reason,true),actor=context.actor||'director';
  for(const payment of group){
   const entry=s.entries.find(e=>e.id===payment.target)!;
   const reversalId=crypto.randomUUID();
   entry.paid=round(entry.paid+payment.amount);
   payment.cancelledAt=now;payment.cancelledBy=actor;payment.cancellationReason=note;payment.reversalId=reversalId;
   // A future-dated payment and its reversal take effect on the same future date.
   const reversalDate=Date.parse(payment.date)>Date.parse(now)?payment.date:now;
   s.payments.push({id:reversalId,date:reversalDate,amount:-payment.amount,account:payment.account,kind:'payout_reversal',party:payment.party,target:payment.target,operationId:id,reversalOf:payment.id,note:'Отмена оплаты · накладная № '+entry.number+' · '+note+' · Директор: '+actor});
  }
  return s;
 }
 if(a.type==='cancel_supplier_return'){
  if(context.role!=='director')throw Error('Отменять возврат может только директор');
  const reason=supplierReturnCancellationReason(s,a.id);if(reason)throw Error(reason);
  const e=s.entries.find(e=>e.id===a.id)!,source=s.entries.find(x=>x.id===e.target)!;
  if(round(num(a.amount))!==e.total)throw Error('Сумма возврата изменилась. Обновите страницу');
  const actor=context.actor||'director',reversalDate=Date.parse(e.date)>Date.parse(now)?e.date:now;
  restoreSupplierReturnStock(s,e,source);source.credit=round(source.credit-e.total);
  e.cancelledAt=now;e.cancelledBy=actor;e.reversalId=id;
  for(const payment of s.payments.filter(p=>p.target===e.id)){
   const reversalId=crypto.randomUUID();payment.cancelledAt=now;payment.cancelledBy=actor;payment.cancellationReason='Отмена ошибочного возврата';payment.reversalId=reversalId;
   s.payments.push({id:reversalId,date:Date.parse(payment.date)>Date.parse(reversalDate)?payment.date:reversalDate,amount:-payment.amount,account:payment.account,kind:'purchase_return_reversal',party:source.party,target:id,reversalOf:payment.id,note:'Отмена возврата № '+e.number+' · накладная № '+source.number+' · Директор: '+actor});
  }
  s.entries.push({...doc(),date:reversalDate,type:'purchase_return_reversal',party:source.party,partyId:source.partyId,target:source.id,reversalOf:e.id,lines:structuredClone(e.lines),total:e.total,cost:e.cost,paid:e.refund||0,refund:e.refund||0,note:'Отменён возврат № '+e.number+' · Директор: '+actor});
  return s;
 }
 if(a.type==='payment_party'){

 const party=s.parties.find(p=>p.id===a.partyId);if(!party)throw Error('Выберите контрагента');
 const kind=party.kind==='supplier'?'purchase':'sale';const docs=s.entries.filter(e=>posted(e)&&e.type===kind&&e.partyId===party.id&&debt(e)>0).sort((x,y)=>Date.parse(x.date)-Date.parse(y.date)||Date.parse(x.createdAt)-Date.parse(y.createdAt));
 const amount=round(num(a.amount,0.01)),remaining=round(docs.reduce((n,e)=>n+debt(e),0));if(amount>remaining)throw Error('Сумма оплаты больше общего долга');account(a.account);let left=amount;
 for(const e of docs){const part=Math.min(left,debt(e));if(part<=0)break;e.paid=round(e.paid+part);cash(kind==='sale'?part:-part,kind==='sale'?'receipt':'payout',party.name,e.id,a.account,str(a.note)||'Оплата контрагента · накладная '+e.number);left=round(left-part);}return s;
 }
 if(a.type==='unpost_purchase'){
 const e=s.entries.find(e=>e.id===a.id);if(!e)throw Error('Накладная не найдена');const reason=purchaseUnpostReason(s,e);if(reason)throw Error(reason);
 if(canUndoReturnedPurchase(s,e)){
  removePurchasePackages(s,e);
  for(const linked of s.entries.filter(x=>posted(x)&&x.target===e.id))linked.status='cancelled';
 }else if(posted(e)){
  removePurchasePackages(s,e);
  for(const l of e.lines){const p=s.products.find(p=>p.id===l.id)!;const qty=qround(p.qty-l.qty),value=p.qty*p.cost-l.qty*l.cost;p.qty=qty;p.cost=qty>0?Math.max(0,value/qty):0;}
  s.payments=s.payments.filter(p=>p.target!==e.id);
 }
 e.draftPaid=e.status==='cancelled'?(e.draftPaid??0):(e.initialPaid??e.paid);e.paid=0;e.initialPaid=0;e.credit=0;e.status='draft';return s;
 }
 if(a.type==='delete_purchase'){
 const e=s.entries.find(e=>e.id===a.id);if(!e)throw Error('Накладная не найдена');const reason=purchaseDeletionReason(s,e);if(reason)throw Error(reason);
 const stock:NonNullable<Entry['deletionStock']>=[];
 if(posted(e)&&s.packageLots?.some(l=>l.sourceId===e.id)){e.deletedPackageLots=structuredClone(s.packageLots.filter(l=>l.sourceId===e.id));removePurchasePackages(s,e);}
 if(posted(e))for(const l of e.lines){const p=s.products.find(p=>p.id===l.id)!;const qty=qround(p.qty-l.qty),value=p.qty*p.cost-l.qty*l.cost;const cost=qty>0?Math.max(0,value/qty):0;stock.push({id:p.id,beforeQty:p.qty,beforeCost:p.cost,afterQty:qty,afterCost:cost});p.qty=qty;p.cost=cost;}
 e.deletedPayments=s.payments.filter(p=>p.target===e.id);s.payments=s.payments.filter(p=>p.target!==e.id);e.deletionStock=stock;e.deletedStatus=e.status;e.status='deleted';e.deletedAt=now;return s;
 }
 if(a.type==='restore_purchase'){
 const e=s.entries.find(e=>e.id===a.id&&e.type==='purchase'&&e.status==='deleted');if(!e)throw Error('Удалённая накладная не найдена');
 if((e.deletionStock||[]).some(v=>s.entries.some(x=>x.id!==e.id&&posted(x)&&x.lines.some(l=>l.id===v.id))))throw Error('После удаления по товарам появились новые документы. Восстановление сейчас недоступно');
 for(const snapshot of e.deletionStock||[]){const p=s.products.find(p=>p.id===snapshot.id);if(!p||Math.abs(p.qty-snapshot.afterQty)>.000001||Math.abs(p.cost-snapshot.afterCost)>.000001)throw Error('После удаления остатки или себестоимость товаров изменились. Восстановление сейчас недоступно');}
 if((e.deletedPayments||[]).some(p=>s.payments.some(x=>x.id===p.id)))throw Error('Оплаты накладной уже восстановлены');
 for(const snapshot of e.deletionStock||[]){const p=s.products.find(p=>p.id===snapshot.id)!;p.qty=snapshot.beforeQty;p.cost=snapshot.beforeCost;}
 if(e.deletedPackageLots){s.packageLots??=[];s.packageLots.push(...e.deletedPackageLots);delete e.deletedPackageLots;}
 s.payments.push(...(e.deletedPayments||[]));e.status=e.deletedStatus||'draft';delete e.deletedAt;delete e.deletedStatus;delete e.deletionStock;delete e.deletedPayments;return s;
 }
 if(a.type==='draft_duplicate')throw Error('Дублирование накладных отключено. Создайте новое поступление.');
 if(a.type==='payment'){
 const e=s.entries.find(e=>e.id===a.target&&posted(e)&&['sale','purchase'].includes(e.type));if(!e)throw Error('Проведённый документ не найден');const amount=round(num(a.amount,0.01));if(amount>debt(e))throw Error('Платёж больше остатка долга');e.paid=round(e.paid+amount);cash(e.type==='sale'?amount:-amount,e.type==='sale'?'receipt':'payout',e.party,e.id);return s;
 }
 if(a.type==='cancel_draft'){const e=s.entries.find(e=>e.id===a.id&&e.status==='draft');if(!e)throw Error('Можно отменить только черновик');e.status='cancelled';return s;}
 if(a.type==='draft_new'){const party=s.parties.find(p=>p.id===a.partyId&&p.kind==='supplier');if(!party)throw Error('Выберите поставщика');s.entries.push({...doc(),type:'purchase',status:'draft',party:party.name,partyId:party.id});return s;}
 if(a.type==='return'){
 const source=s.entries.find(e=>e.id===a.target&&posted(e)&&['sale','purchase'].includes(e.type));if(!source)throw Error('Выберите исходный документ');
 const e:Entry={...doc(),type:source.type==='sale'?'sale_return':'purchase_return',party:source.party,partyId:source.partyId,target:source.id,...(source.type==='purchase'?{returnPackageChanges:[]}: {})};const seen=new Set();
 e.lines=(a.lines||[]).map((l:any)=>{const orig=source.lines.find(x=>x.id===l.id&&x.kind!=='service'),p=s.products.find(x=>x.id===l.id);if(!orig||!p||seen.has(p.id))throw Error('Проверьте строки возврата');seen.add(p.id);const qty=num(l.qty,0.001);if(p.wholeOnly&&!Number.isInteger(qty))throw Error('Штучный товар возвращается целиком');const returned=s.entries.filter(x=>activeReturn(x)&&x.target===source.id&&['sale_return','purchase_return'].includes(x.type)).reduce((n,x)=>n+x.lines.filter(v=>v.id===p.id).reduce((v,l)=>v+l.qty,0),0);if(qty>qround(orig.qty-returned))throw Error('Возврат превышает количество в документе');const rawTotal=source.total+source.discount;const price=(orig.price-(orig.discount||0)/orig.qty)*(rawTotal?source.total/rawTotal:1);let cost=orig.cost;if((s.packageLots||[]).some(x=>x.productId===p.id)||orig.packaging){const before=source.type==='purchase'&&!orig.packaging?structuredClone((s.packageLots||[]).filter(l=>l.productId===p.id)):[];returnPackages(s,p,source,orig,qty,l.returnSealed===true,l.stockSplit);if(source.type==='purchase'&&!orig.packaging){const after=(s.packageLots||[]).filter(l=>l.productId===p.id);const changed=before.filter(b=>JSON.stringify(b)!==JSON.stringify(after.find(v=>v.id===b.id)));e.returnPackageChanges!.push({productId:p.id,before:changed,after:structuredClone(after.filter(v=>changed.some(b=>b.id===v.id)))});}}
 if(source.type==='sale'){p.cost=receiptAverage(p,qty,cost);p.qty=qround(p.qty+qty);}else{if(qty>Math.max(0,p.qty)&&p.stockValue===undefined)throw Error('Недостаточно товара на складе');cost=p.cost;p.qty=qround(p.qty-qty);}return {stockSplit:l.stockSplit,id:p.id,name:p.name,qty,price,cost,unit:p.unit,returnSealed:l.returnSealed===true};});
 if(!e.lines.length)throw Error('Добавьте товары для возврата');const quote=returnQuote(s,source,e.lines);for(const line of e.lines){const values=quote.lines.find(l=>l.id===line.id)!;line.price=values.amount/line.qty;line.returnCostAmount=values.costAmount;}e.total=quote.total;e.cost=quote.cost;const costRounding=round(e.cost-round(e.lines.reduce((n,l)=>n+l.qty*l.cost,0)));if(costRounding)e.returnCostRounding=costRounding;const unpaid=debt(source);e.refund=Math.max(0,round(e.total-unpaid));source.credit=round(source.credit+e.total);e.paid=e.refund;cash(source.type==='sale'?-e.refund:e.refund,e.type,source.party,e.id);s.entries.push(e);return s;
 }
 if(a.type==='writeoff'||a.type==='inventory'){
 const e=doc();e.party=a.type==='inventory'?'Инвентаризация':'Списание';e.note=str(a.note,true);const seen=new Set();
 e.lines=(a.lines||[]).map((l:any)=>{const p=s.products.find(p=>p.id===l.id);if(!p||seen.has(p.id))throw Error('Проверьте товары');seen.add(p.id);const value=num(l.qty,a.type==='writeoff'?0.001:0);if(p.wholeOnly&&!Number.isInteger(value))throw Error('Штучный товар учитывается целиком');const delta=a.type==='inventory'?qround(value-p.qty):-value;if(a.type==='writeoff'&&value>p.qty&&p.stockValue===undefined)throw Error('Недостаточно товара');if(delta>0&&p.cost===0)throw Error('Сначала задайте себестоимость через закупку');if(delta<0&&(s.packageLots||[]).some(l=>l.productId===p.id))consumePackages(s,p,-delta,undefined,l.stockSplit);p.qty=qround(p.qty+delta);return {stockSplit:l.stockSplit,id:p.id,name:p.name,qty:delta,price:p.cost,cost:p.cost,unit:p.unit};});if(!e.lines.length)throw Error('Добавьте товары');e.variance=round(e.lines.reduce((n,l)=>n+l.qty*l.cost,0));e.total=Math.abs(e.variance);s.entries.push(e);return s;
 }
 if(!['sale','purchase','draft_save','draft_post'].includes(a.type))throw Error('Неизвестная операция');
 const draft=a.type.startsWith('draft_')?s.entries.find(e=>e.id===a.id&&e.status==='draft'):undefined;
 if(a.type.startsWith('draft_')&&!draft)throw Error('Черновик не найден или уже проведён');
 const type=draft?'purchase':a.type;const post=a.type!=='draft_save';if(type==='sale'&&a.walkIn&&!a.partyId){let walkIn=s.parties.find(p=>p.kind==='client'&&p.name==='Наличный клиент');if(!walkIn){walkIn={id:crypto.randomUUID(),name:'Наличный клиент',kind:'client',phone:'',note:''};s.parties.push(walkIn)}a={...a,partyId:walkIn.id};}const party=s.parties.find(p=>p.id===(a.partyId||draft?.partyId)&&p.kind===(type==='purchase'?'supplier':'client'));if(!party)throw Error('Выберите '+(type==='purchase'?'поставщика':'клиента'));
 if(type==='purchase'){const duplicate=invoiceDuplicate((a.lines||[]).map((l:any)=>({productId:l.id})),s.products);if(duplicate)throw Error(duplicate.message);}
 const seen=new Set();const lines:Line[]=(a.lines||[]).map((l:any)=>{const svc=type==='sale'&&l.kind==='service'?s.services.find(x=>x.id===l.id):null;const p=svc||s.products.find(p=>p.id===l.id);if(!p||seen.has(p.id))throw Error('Проверьте товары');seen.add(p.id);if(l.packaging&&svc)throw Error('Услуга не может быть упаковкой');if(type==='sale'&&l.packaging&&l.saleMode!=='sealed')throw Error('Для упаковки выберите продажу целиком');const pack=svc?undefined:packageSpec(l.packaging,p as Product);if(type==='sale'&&l.saleMode==='sealed'&&!pack)throw Error('Выберите объём запечатанной упаковки');const qty=pack?qround(pack.volume*pack.count):num(l.qty,0.001);if(!svc&&(p as Product).wholeOnly&&!Number.isInteger(qty))throw Error('Штучный товар учитывается целиком');const price=pack?pack.unitPrice/pack.volume:round(num(l.price));if(post&&type==='sale'&&!svc&&!context.allowNegativeStock&&qty>(p as Product).qty)throw Error('Недостаточно товара: '+p.name);const discount=round(num(l.discount));if(discount>round(qty*price))throw Error('Скидка строки превышает сумму товара');return {stockSplit:post&&type==='sale'?l.stockSplit:undefined,id:p.id,name:p.name,qty,price,discount,...(pack?{packaging:pack}:{}),...(type==='sale'&&(l.saleMode||(!svc&&(s.packageLots||[]).some(x=>x.productId===p.id)))?{saleMode:pack?'sealed' as const:'bulk' as const}:{}),retail:type==='purchase'?round(num(l.retail??(p as Product).price)):undefined,wholesale:type==='purchase'?round(num(l.wholesale??(p as Product).wholesale)):undefined,expense:type==='purchase'?num(l.expense):0,cost:svc?0:(p as Product).cost,unit:svc?'усл':(p as Product).unit,kind:svc?'service':'product'};});
 const service=type==='sale'?round(num(a.service)):0;const rawTotal=round(lines.reduce((n,l)=>n+l.qty*l.price-(l.discount||0),0)+service),discountMode=a.discountMode==='percent'?'percent':'amount',discountValue=round(num(a.discountValue??a.discount)),discount=discountMode==='percent'?round(rawTotal*discountValue/100):discountValue;if(discountMode==='percent'&&discountValue>100)throw Error('Скидка не может превышать 100%');if(discount>rawTotal)throw Error('Скидка превышает сумму');const total=round(rawTotal-discount),expenses=type==='purchase'?round(lines.reduce((n,l)=>n+l.qty*(l.expense||0),0)):0,expenseAccount=a.expenseAccount||a.account,paid=post?round(num(a.paid)):0;if(paid>total)throw Error('Оплата больше суммы документа');if(type==='sale'&&a.walkIn&&paid<total)throw Error('Для продажи в долг выберите клиента');const paymentMethod=type==='sale'&&a.paymentMethod?str(a.paymentMethod):undefined;let received:number|undefined,change:number|undefined;if(paymentMethod){if(!['cash','cashless','debt'].includes(paymentMethod))throw Error('Выберите способ оплаты');received=round(num(a.received));if(paymentMethod==='debt'){if(paid!==0||received!==0||a.walkIn)throw Error('Для продажи в долг выберите клиента и укажите нулевую оплату');}else if(paymentMethod==='cashless'){if(a.account==='cash'||received>total||paid!==received)throw Error('Проверьте безналичную кассу и сумму оплаты');}else{if(a.account!=='cash'||paid!==Math.min(total,received))throw Error('Проверьте наличную оплату');change=round(Math.max(0,received-total));}}if(post&&!lines.length&&!service)throw Error('Добавьте товары или услуги');
 if(post){for(const l of lines){if(l.kind==='service')continue;const p=s.products.find(p=>p.id===l.id)!;if(type==='purchase'){l.cost=(l.price-(l.discount||0)/l.qty)*(rawTotal?total/rawTotal:1)+(l.expense||0);const retail=l.retail??p.price,wholesale=l.wholesale??p.wholesale;if(p.price!==retail||p.wholesale!==wholesale)s.priceHistory!.push({id:crypto.randomUUID(),date:now,productId:p.id,oldRetail:p.price,retail,oldWholesale:p.wholesale,wholesale,source:'Покупка'});p.price=retail;p.wholesale=wholesale;p.cost=receiptAverage(p,l.qty,l.cost);p.qty=qround(p.qty+l.qty);receivePackages(s,p,l,draft?.id||id);}else {if(l.packaging||(s.packageLots||[]).some(x=>x.productId===p.id)){const physical=context.allowNegativeStock&&l.stockSplit?physicalSplit(s,p.id,l.stockSplit):l.stockSplit;consumePackages(s,p,physical?Object.values(physical).reduce((n,v)=>n+v,0):l.qty,l.packaging,physical);}p.qty=qround(p.qty-l.qty);}}}
 const e:Entry={...(draft||doc()),...(post&&type==='purchase'?{stockOrigin:paid>=total?'paid' as const:'credit' as const}:{}),type,date,party:party.name,partyId:party.id,status:post?'posted':'draft',draftPaid:post?undefined:round(num(a.paid)),phone:party.phone,car:str(a.car),mileage:str(a.mileage),lines,total,paid,initialPaid:paid,cost:round(lines.reduce((n,l)=>n+l.qty*l.cost,0)),service,discount,discountMode,discountValue,expenses,expenseAccount,paymentMethod,received,change,note:str(a.note),account:a.account};
 if(draft)s.entries[s.entries.indexOf(draft)]=e;else s.entries.push(e);if(post){cash(type==='sale'?paid:-paid,type==='sale'?'receipt':'payout',party.name,e.id);if(expenses)cash(-expenses,'purchase_expense',party.name,e.id,expenseAccount,'Расходы закупки · накладная '+e.number);}return s;
}
// Product and its initial purchase draft are returned in one state update.
// Nothing is posted, paid or received into stock by this operation.
function saveInitialPurchase(s:State,p:Product,input:any,now:string):State{
 let state=s;
 let draft=input.draftId?s.entries.find(e=>e.id===input.draftId&&e.type==='purchase'&&e.status==='draft'):undefined;
 if(input.draftId&&!draft)throw Error('Черновик не найден или уже проведён');
 if(!draft){
  state=apply(s,{type:'draft_new',partyId:input.partyId,date:input.date},{now});
  draft=state.entries.at(-1)!;
 }
 const line={id:p.id,kind:'product',qty:input.line?.qty,price:input.line?.price,packaging:input.line?.packaging,discount:0,expense:0,retail:p.price,wholesale:p.wholesale};
 const date=new Date(Date.parse(draft.date)+5*3600000).toISOString().slice(0,10);
 const result=apply(state,{...draft,type:'draft_save',date,paid:draft.draftPaid??0,lines:[...draft.lines,line]},{now});
 // Editing the draft must not change its original timestamp.
 result.entries.find(e=>e.id===draft!.id)!.date=draft.date;
 return result;
}
export function totals(s:State,from='',to=''){
 const within=(date:string)=>{const d=new Date(new Date(date).getTime()+5*3600000).toISOString().slice(0,10);return (!from||d>=from)&&(!to||d<=to)};
 const es=s.entries.filter(e=>posted(e)&&within(e.date));const sum=(type:string,key:keyof Entry='total')=>round(es.filter(e=>e.type===type).reduce((n,e)=>n+Number(e[key]||0),0));
 const revenue=round(sum('sale')-sum('sale_return'));const cost=round(sum('sale','cost')-sum('sale_return','cost'));const expenses=sum('expense'),income=sum('income');const adjustments=round(sum('inventory','variance')+sum('writeoff','variance')+sum('purchase_return')-sum('purchase_return','cost')-sum('purchase_return_reversal')+sum('purchase_return_reversal','cost'));
 const count=es.filter(e=>e.type==='sale').length,grossRevenue=sum('sale');
 return {pendingStockSales:pendingStockCount(s),revenue,cost,expenses,income,adjustments,grossRevenue,averageSale:count?round(grossRevenue/count):0,profit:round(revenue-cost-expenses+income+adjustments),count,customerDebt:round(s.entries.filter(e=>posted(e)&&e.type==='sale').reduce((n,e)=>n+debt(e),0)),supplierDebt:round(s.entries.filter(e=>posted(e)&&e.type==='purchase').reduce((n,e)=>n+debt(e),0)),stock:round(s.products.reduce((n,p)=>n+inventoryValue(p),0)),cash:balance(s)};
}
