import {apply,normalize} from './ledger';
import {capturePaidStockSaveRecovery} from './paid-stock-save-recovery';

// Draft revisions protect this invoice; unrelated sales must not block saving it.
// Every retry re-reads the complete store before its compare-and-swap update.
export async function savePaidStockDraft(db:any,key:string,action:any,actor:string){
 for(let attempt=0;attempt<4;attempt++){
  const row=await db.prepare('SELECT data,version FROM ledgers WHERE id=?').bind(key).first();
  if(!row)throw Error('Не удалось открыть учёт');
  const current=normalize(JSON.parse(row.data));let data;
  try{data=apply(current,action,{role:'director',actor})}catch(error){
   const draft=current.paidStockDrafts?.find(d=>d.id===action.id);
   if(action.type==='paid_stock_draft_save'&&draft&&action.revision!==draft.revision){
    let captured=false;try{captured=await capturePaidStockSaveRecovery(db,key,action,draft.revision)}catch{}
    if(captured&&!action.base)throw Error('В открытом окне старая версия черновика. Введённые поля сохранены отдельно для восстановления. Не обновляйте страницу до восстановления.');
   }
   throw error;
  }
  if(JSON.stringify(data)===JSON.stringify(current))return {data,version:row.version};
  const result=await db.prepare('UPDATE ledgers SET data=?,version=version+1 WHERE id=? AND version=?').bind(JSON.stringify(data),key,row.version).run();
  if(result.meta.changes)return {data,version:row.version+1};
 }
 throw Error('Сейчас сохраняется другая операция. Нажмите «Сохранить и закрыть» ещё раз. Ваши поля сохранены в этом окне.');
}
