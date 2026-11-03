import type {PaidStockDraft,PaidStockRow} from './ledger';

export type PaidDraftForm={title:string;date:string;note:string;rows:PaidStockRow[];additionalExpense:string;expenseAllocation:'quantity'|'value'};
export function paidDraftForm(draft:Pick<PaidStockDraft,'date'|'note'|'rows'|'title'|'additionalExpense'|'expenseAllocation'>):PaidDraftForm{
 return {title:draft.title||'',date:draft.date,note:draft.note||'',rows:structuredClone(draft.rows),additionalExpense:draft.additionalExpense||'',expenseAllocation:draft.expenseAllocation||'quantity'};
}
const canonical=(value:any):any=>Array.isArray(value)?value.map(canonical):value&&typeof value==='object'?Object.fromEntries(Object.keys(value).filter(k=>value[k]!==undefined).sort().map(k=>[k,canonical(value[k])])):value;
export const samePaidDraftValue=(a:unknown,b:unknown)=>JSON.stringify(canonical(a))===JSON.stringify(canonical(b));
export const samePaidDraftTitle=(a:unknown,b:unknown)=>String(a??'').trim().replace(/\s+/g,' ')===String(b??'').trim().replace(/\s+/g,' ');
export class PaidDraftConflictError extends Error{code='PAID_DRAFT_CONFLICT'}
const labels:Record<string,string>={title:'название накладной',date:'дата',note:'примечание',additionalExpense:'общий расход',expenseAllocation:'распределение расхода',qty:'количество',cost:'закупочная цена',name:'название товара',article:'артикул',barcode:'штрихкод',qrCode:'QR-код',price:'розничная цена',wholesale:'оптовая цена',category:'категория',unit:'единица измерения',packaging:'упаковка',productId:'товар'};
export function mergePaidDraftForm(base:PaidDraftForm,local:PaidDraftForm,remote:PaidDraftForm):PaidDraftForm{
 function merge(b:any,l:any,r:any,path:string):any{
  const same=path===labels.title?samePaidDraftTitle:samePaidDraftValue;
  if(same(l,r)||same(r,b))return structuredClone(l);
  if(same(l,b))return structuredClone(r);
  if(b&&l&&r&&[b,l,r].every(v=>typeof v==='object'&&!Array.isArray(v))){
   const result:Record<string,unknown>={};
   for(const key of new Set([...Object.keys(b),...Object.keys(l),...Object.keys(r)])){
    const value=merge(b[key],l[key],r[key],path+(labels[key]?' · '+labels[key]:''));if(value!==undefined)result[key]=value;
   }
   return result;
  }
  throw new PaidDraftConflictError('В другом окне изменено то же поле: '+path+'. Ваши данные остались в открытой накладной. Согласуйте изменения перед сохранением.');
 }
 const result={} as PaidDraftForm;
 for(const key of ['title','date','note','additionalExpense','expenseAllocation'] as const)(result as any)[key]=merge(base[key],local[key],remote[key],labels[key]);
 const bm=new Map(base.rows.map(r=>[r.key,r])),lm=new Map(local.rows.map(r=>[r.key,r])),rm=new Map(remote.rows.map(r=>[r.key,r]));
 result.rows=[];
 for(const key of new Set([...remote.rows.map(r=>r.key),...local.rows.map(r=>r.key)])){
  const index=local.rows.findIndex(r=>r.key===key),row=merge(bm.get(key),lm.get(key),rm.get(key),'товар '+(index>=0?index+1:remote.rows.findIndex(r=>r.key===key)+1));
  if(row)result.rows.push(row);
 }
 return result;
}
export function paidDraftTitleConflict(base:PaidDraftForm,local:PaidDraftForm,remote:PaidDraftForm){return !samePaidDraftTitle(local.title,remote.title)&&!samePaidDraftTitle(local.title,base.title)&&!samePaidDraftTitle(remote.title,base.title)}
export function resolvePaidDraftTitle(base:PaidDraftForm,local:PaidDraftForm,remote:PaidDraftForm,choice:'local'|'remote'){
 return mergePaidDraftForm({...base,title:remote.title},{...local,title:choice==='local'?local.title:remote.title},remote);
}
