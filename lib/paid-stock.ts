import type {State,ApplyContext,Entry,OpeningSnapshot,PaidStockRow} from './ledger';
import {round} from './ledger';
import {applyOpeningStock} from './opening-stock';
import {paidStockExpenseAmount,paidStockExpensePlan} from './paid-stock-costs';
import {invoiceDuplicate} from './invoice-duplicates';
import {paidDraftForm,mergePaidDraftForm,samePaidDraftValue,type PaidDraftForm} from './paid-stock-draft';

const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const text=(v:unknown,max:number)=>String(v??'').slice(0,max);
function cleanTitle(value:unknown){
 if(typeof value!=='string')throw Error('Укажите название текстом');
 const title=value.trim().replace(/\s+/g,' ');
 if(title.length>150)throw Error('Название накладной должно быть не длиннее 150 символов');
 return title;
}
export const localDay=(now:string)=>new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Dushanbe',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(now));
function cleanRow(raw:any):PaidStockRow{
 if(!raw||!uuid.test(raw.key))throw Error('Обновите строку товара в накладной');
 const row:PaidStockRow={key:raw.key,qty:text(raw.qty,32),cost:text(raw.cost,32)};
 if(raw.productId){row.productId=text(raw.productId,100);row.unit=text(raw.unit,10);}
 else if(raw.product){const p=raw.product;row.product={name:text(p.name,300),article:text(p.article,100),barcode:text(p.barcode,300),qrCode:text(p.qrCode,300),category:text(p.category,100)||'Другое',unit:p.unit==='л'?'л':'шт',price:text(p.price,32),wholesale:text(p.wholesale,32)};}
 else throw Error('В строке не выбран товар');
 if(raw.packaging)row.packaging={kind:raw.packaging.kind==='barrel'?'barrel':'canister',volume:Number(raw.packaging.volume),count:Number(raw.packaging.count),unitPrice:Number(raw.packaging.unitPrice)};
 return row;
}
export function applyPaidStockDraft(s:State,a:any,context:ApplyContext):State{
 if(context.role!=='director')throw Error('Оплаченные товары вносит только директор');
 const now=context.now||new Date().toISOString();
 if(!uuid.test(String(a.id||'')))throw Error('Откройте накладную заново');
 if(a.type==='paid_stock_title'){
  const entry=s.entries.find(e=>e.id===a.id&&e.type==='opening_stock'&&e.status==='posted');
  if(!entry)throw Error('Накладная не найдена');
  if(a.beforeTitle!==(entry.title||''))throw Error('Название изменено в другом окне. Загрузите сохранённое название');
  entry.title=cleanTitle(a.title);return s;
 }
 const posted=s.entries.find(e=>e.type==='opening_stock'&&e.requestId===a.id);
 const drafts=s.paidStockDrafts??=[];
 const draft=drafts.find(d=>d.id===a.id);
 if(a.type==='paid_stock_draft_new'){
  if(draft||posted)return s;
  drafts.push({id:a.id,revision:0,createdAt:now,updatedAt:now,date:localDay(now),title:'',note:'',rows:[]});return s;
 }
 if(a.type==='paid_stock_draft_post'&&posted)return s;
 if(!draft)throw Error('Этот черновик уже проведён или удалён. Обновите список');
 if(a.type!=='paid_stock_draft_save'&&a.revision!==draft.revision)throw Error('Этот черновик изменён в другом окне. Откройте сохранённую версию');
 if(a.type==='paid_stock_draft_delete'){s.paidStockDrafts=drafts.filter(d=>d.id!==draft.id);return s;}
 if(a.type==='paid_stock_draft_save'){
  const current=paidDraftForm(draft);
  function cleanForm(value:any):PaidDraftForm{
   if(!value||!Array.isArray(value.rows)||value.rows.length>300)throw Error('В одной накладной можно сохранить до 300 товаров');
   const rows=value.rows.map(cleanRow);
   if(new Set(rows.map((r:PaidStockRow)=>r.key)).size!==rows.length)throw Error('Строки накладной повторяются');
   const duplicate=invoiceDuplicate(rows,s.products);if(duplicate)throw Error(duplicate.message);
   const additionalExpense=text(value.additionalExpense??current.additionalExpense,32);paidStockExpenseAmount(additionalExpense);
   const expenseAllocation=value.expenseAllocation??current.expenseAllocation;
   if(expenseAllocation!=='value'&&expenseAllocation!=='quantity')throw Error('Выберите способ распределения расходов');
   const title=value.title??current.title;cleanTitle(title);
   // Preserve the in-progress title exactly, including a trailing space.
   // Trimming an acknowledgement can conflict with the next word being typed.
   if(title.length>150)throw Error('Название накладной должно быть не длиннее 150 символов');
   return {rows,title,date:text(value.date,10),note:text(value.note,1000),additionalExpense,expenseAllocation};
  }
  let requested=cleanForm(a);
  // A committed save may lose its acknowledgement. Retrying must succeed
  // without changing the invoice again, including requests from older clients.
  if(samePaidDraftValue(requested,current))return s;
  if(a.revision!==draft.revision){
   if(!a.base)throw Error('Этот черновик изменён в другом окне. Ваши поля остались в открытой накладной.');
   requested=cleanForm(mergePaidDraftForm(cleanForm(a.base),requested,current));
  }
  if(samePaidDraftValue(requested,current))return s;
  Object.assign(draft,requested);draft.updatedAt=now;draft.revision++;return s;
 }
 if(a.type!=='paid_stock_draft_post')throw Error('Неизвестная операция с оплаченной накладной');
 if(!draft.rows.length)throw Error('Добавьте товары в накладную');
 const duplicate=invoiceDuplicate(draft.rows,s.products);if(duplicate)throw Error(duplicate.message);
 if(!/^\d{4}-\d{2}-\d{2}$/.test(draft.date)||!Number.isFinite(Date.parse(draft.date+'T12:00:00+05:00'))||new Date(draft.date+'T12:00:00Z').toISOString().slice(0,10)!==draft.date||draft.date>localDay(now))throw Error('Укажите действительную дату, не позднее сегодняшней');
 const expenseAmount=paidStockExpenseAmount(draft.additionalExpense),expenseAllocation=draft.expenseAllocation||'quantity';
 if(expenseAmount&&(a.expenseReview?.amount!==expenseAmount||a.expenseReview?.allocation!==expenseAllocation))throw Error('Откройте накладную в обновлённой программе и подтвердите общую сумму с расходами');
 const expensePlan=expenseAmount?paidStockExpensePlan(draft.rows,expenseAmount,expenseAllocation):null;
 const id=draft.id,lines:Entry['lines']=[],snapshots:OpeningSnapshot[]=[],seen=new Set<string>();
 const number=context.number||String(s.entries.length+1).padStart(6,'0');
 for(let index=0;index<draft.rows.length;index++){
  const row=draft.rows[index];
  try{
   if(row.productId&&row.unit&&s.products.find(p=>p.id===row.productId)?.unit!==row.unit)throw Error('Единица товара изменилась. Уберите строку и добавьте товар заново');
   if(!row.productId&&row.product?.article.trim()){
    const article=row.product.article.trim().toLocaleLowerCase('ru');
    const match=s.products.find(p=>p.article.trim().toLocaleLowerCase('ru')===article);
    if(match)throw Error('Артикул уже есть у «'+match.name+'». Выберите существующий товар');
   }
   s=applyOpeningStock(s,{type:row.productId?'paid_stock_add':'opening_stock',requestId:crypto.randomUUID(),productId:row.productId,product:row.product,qty:row.qty,cost:row.cost,packaging:row.packaging},{...context,id,number,now});
   // Intermediate rows exist only in memory; the store persists one complete invoice atomically.
   const entry=s.entries.pop()!;
   if(entry.id!==id||!entry.openingStockSnapshot)throw Error('Не удалось сформировать строку накладной');
   if(expensePlan){
    const line=entry.lines[0],allocation=expensePlan.lines[index],p=s.products.find(p=>p.id===line.id)!;
    if(Math.abs(allocation.qty-line.qty)>1e-8||Math.abs(allocation.price-line.price)>1e-8)throw Error('Количество или закупочная цена изменились при распределении расхода');
    line.expense=allocation.expensePerUnit;line.cost=line.price+line.expense;
    if(!Number.isFinite(line.cost)||line.cost>1e9)throw Error('Себестоимость с расходом слишком велика');
    const snapshot=entry.openingStockSnapshot;
    p.cost=(Math.max(0,snapshot.beforeQty)*snapshot.beforeCost+line.qty*line.price+allocation.expenseAmount)/(Math.max(0,snapshot.beforeQty)+line.qty);
    if(!Number.isFinite(p.cost)||p.cost>1e9)throw Error('Проверьте себестоимость товара с расходом');
    snapshot.afterCost=p.cost;
    // Opening-stock price retains its historical meaning: full inventory cost.
    line.price=line.cost;
   }
   if(seen.has(entry.lines[0].id))throw Error('Товар уже добавлен в эту накладную');
   seen.add(entry.lines[0].id);lines.push(entry.lines[0]);snapshots.push(entry.openingStockSnapshot);
  }catch(error){throw Error('Строка '+(index+1)+': '+(error as Error).message);}
 }
 const total=round(lines.reduce((n,l)=>n+l.qty*l.cost,0));
 if(!Number.isFinite(total)||total>1e9)throw Error('Проверьте общую стоимость накладной');
 if(expensePlan&&Math.abs(total-expensePlan.total)>.001)throw Error('Сумма с расходами не совпала. Проверьте товары');
 s.entries.push({id,number,title:draft.title||'',type:'opening_stock',status:'posted',date:draft.date===localDay(now)?now:draft.date+'T12:00:00+05:00',createdAt:now,party:'Свои оплаченные товары',lines,total,cost:total,paid:0,credit:0,discount:0,service:0,requestId:draft.id,openingKind:'addition',openingStockSnapshots:snapshots,...(expensePlan?{expenses:expenseAmount,expenseAllocation}:{}),note:draft.note});
 s.paidStockDrafts=(s.paidStockDrafts||[]).filter(d=>d.id!==draft.id);return s;
}
