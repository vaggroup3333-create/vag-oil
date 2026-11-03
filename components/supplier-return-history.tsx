'use client';
import {useEffect,useId,useRef,useState} from 'react';
import {CheckCircle2,PackageCheck,Undo2,X} from 'lucide-react';
import {debt,round,supplierReturnCancellationReason} from '../lib/ledger';
import type {Entry,State} from '../lib/ledger';

const money=(v:number)=>new Intl.NumberFormat('ru-RU',{minimumFractionDigits:2,maximumFractionDigits:2}).format(v)+' TJS';
const number=(v:number)=>new Intl.NumberFormat('ru-RU',{maximumFractionDigits:3}).format(v);
const date=(v:string)=>new Intl.DateTimeFormat('ru-RU',{timeZone:'Asia/Dushanbe',day:'2-digit',month:'2-digit',year:'numeric',hour:'2-digit',minute:'2-digit'}).format(new Date(v));
type Props={state:State;sourceId:string;returnId?:string;ready:boolean;busy:boolean;error:string;onClearError:()=>void;onCancel:(id:string,amount:number)=>Promise<State|null>;onCorrect:(productId:string)=>void};
function quantity(source:Entry|undefined,line:Entry['lines'][number]){
 const pack=source?.lines.find(l=>l.id===line.id)?.packaging;
 return pack?number(line.qty/pack.volume)+' шт. · '+number(pack.volume)+' л':number(line.qty)+' '+(line.unit||'шт');
}
export function SupplierReturnHistory(props:Props){
 const {state,sourceId,returnId,ready,busy,onClearError}=props;
 const [selected,setSelected]=useState('');
 const source=state.entries.find(e=>e.id===sourceId);
 const returns=state.entries.filter(e=>e.type==='purchase_return'&&e.target===sourceId&&(!returnId||e.id===returnId)).slice().reverse();
 if(!returns.length)return null;
 return <section className="supplierReturns" aria-label="Возвраты поставщику"><h3>Возвраты поставщику</h3><p>Ошиблись товаром или количеством? Отмените возврат и оформите его заново.</p>
  {returns.map(e=>{const cancelled=!!e.cancelledAt||e.status!=='posted',reason=cancelled?'':supplierReturnCancellationReason(state,e.id);return <article key={e.id} className={'supplierReturnItem'+(cancelled?' isCancelled':'')}>
   <div className="supplierReturnInfo"><strong>Возврат № {e.number}</strong><small>{date(e.date)}</small>{e.lines.map(l=><span key={l.id}>{l.name} <b>{quantity(source,l)}</b></span>)}</div>
   <div className="supplierReturnActions"><strong>{money(e.total)}</strong>{cancelled?<span className="supplierReturnCancelled"><CheckCircle2 size={16}/> Возврат отменён</span>:<button type="button" className="purchaseReturnButton" disabled={!ready||busy||!!reason} title={reason||'Восстановить товар и долг'} onClick={()=>{onClearError();setSelected(e.id)}}><Undo2 size={16}/> Отменить возврат</button>}{reason&&<small className="supplierReturnBlocked">{reason}</small>}</div>
   {e.cancelledAt&&<small className="supplierReturnAudit">Отменён {date(e.cancelledAt)} · Директор: {e.cancelledBy||'director'}</small>}
  </article>})}
  {selected&&<CancelReturnDialog key={selected} {...props} id={selected} onClose={()=>{setSelected('');onClearError()}}/>}
 </section>;
}
function CancelReturnDialog({state,sourceId,id,ready,busy,error,onCancel,onClose,onCorrect}:Props&{id:string;onClose:()=>void}){
 const dialog=useRef<HTMLDialogElement>(null),title=useId(),description=useId();
 const [sending,setSending]=useState(false),[localError,setLocalError]=useState(''),[done,setDone]=useState<{debt:number;refund:number}|null>(null);
 const entry=state.entries.find(e=>e.id===id),source=state.entries.find(e=>e.id===sourceId);
 const locked=busy||sending,blocked=done?'':supplierReturnCancellationReason(state,id);
 const debtIncrease=entry&&source?round(debt({...source,credit:round(source.credit-entry.total)})-debt(source)):0;
 const payments=state.payments.filter(p=>p.target===id&&p.kind==='purchase_return');
 useEffect(()=>{const el=dialog.current;el?.showModal();return()=>{if(el?.open)el.close()}},[]);
 async function submit(event:React.FormEvent){
  event.preventDefault();if(locked||!ready||blocked||!entry)return;setSending(true);setLocalError('');
  try{const next=await onCancel(id,entry.total);if(next){const original=next.entries.find(e=>e.id===id),updated=next.entries.find(e=>e.id===sourceId);if(original?.cancelledAt&&updated)setDone({debt:debt(updated),refund:entry.refund||0});}}
  catch{setLocalError('Не удалось получить подтверждение. Обновите накладную и проверьте историю возвратов.')}
  finally{setSending(false)}
 }
 return <dialog className="purchaseReturnDialog" ref={dialog} aria-labelledby={title} aria-describedby={description} onCancel={event=>{event.preventDefault();if(!locked)onClose()}}>
  <div className="purchaseReturnHeader"><h2 id={title}>{done?'Возврат отменён':'Отменить возврат?'}</h2><button type="button" aria-label="Закрыть" disabled={locked} onClick={onClose}><X size={21}/></button></div>
  {done?<div className="purchaseReturnBody"><div className="purchaseReturnSuccess"><PackageCheck size={42}/><strong>Товар восстановлен на складе</strong></div><p id={description}>Отмена сохранена в истории. Теперь можно оформить возврат с правильным количеством.</p><div className="purchaseReturnSummary"><div><span>Долг по накладной</span><b>{money(done.debt)}</b></div><small>{done.refund?'Поступление денег по ошибочному возврату также отменено.':'Деньги в кассе не изменились.'}</small></div><div className="purchaseReturnFooter"><button type="button" onClick={onClose}>Готово</button>{entry?.lines.length===1&&<button type="button" className="green" onClick={()=>{onClose();onCorrect(entry.lines[0].id)}}>Оформить правильный возврат</button>}</div></div>:<form className="purchaseReturnBody" onSubmit={submit}>
   <p className="purchaseReturnProduct">Возврат № {entry?.number}</p><p id={description}>Накладная № {source?.number} · {source?.party}</p>
   <div className="returnRestoreLines">{entry?.lines.map(line=><div key={line.id}><span>{line.name}</span><b>+{quantity(source,line)}</b></div>)}</div>
   <div className="purchaseReturnSummary"><div><span>Долг увеличится на</span><b>{money(debtIncrease)}</b></div>{payments.map(p=><div key={p.id}><span>Отмена поступления в «{state.accounts.find(a=>a.id===p.account)?.name}»</span><b>−{money(p.amount)}</b></div>)}{!payments.length&&<small>Деньги в кассе не изменятся.</small>}</div>
   <p>Отменяется весь выбранный возврат. Накладная останется проведённой.</p>{!!payments.length&&<small>Изменится учёт денег в кассе. Банковский перевод автоматически не выполняется.</small>}
   {(localError||error||blocked)&&<div className="error" role="alert">{localError||error||blocked}</div>}
   <div className="purchaseReturnFooter"><button type="button" disabled={locked} onClick={onClose}>Назад</button><button type="submit" className="green" disabled={locked||!ready||!!blocked}>{locked?'Сохраняю…':'Отменить возврат'}</button></div>
  </form>}
 </dialog>;
}
