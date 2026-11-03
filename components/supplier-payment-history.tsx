'use client';
import {useEffect,useId,useRef,useState} from 'react';
import {CheckCircle2,Undo2,Wallet,X} from 'lucide-react';
import {round,supplierPaymentGroup,supplierPaymentCancellationReason} from '../lib/ledger';
import type {Payment,State} from '../lib/ledger';

const money=(value:number)=>new Intl.NumberFormat('ru-RU',{minimumFractionDigits:2,maximumFractionDigits:2}).format(value)+' TJS';
const date=(value:string)=>new Intl.DateTimeFormat('ru-RU',{timeZone:'Asia/Dushanbe',day:'2-digit',month:'2-digit',year:'numeric',hour:'2-digit',minute:'2-digit'}).format(new Date(value));
const groupKey=(p:Payment)=>p.operationId||'single:'+p.id;
const groupAmount=(group:Payment[])=>round(group.reduce((sum,p)=>sum-p.amount,0));
type Props={state:State;payments:Payment[];canCancel:boolean;ready:boolean;busy:boolean;error:string;onClearError:()=>void;onCancel:(id:string,amount:number,reason:string)=>Promise<State|null>;onRepay:(partyId:string,account:string)=>void};

export function SupplierPaymentHistory(props:Props){
 const {state,payments,canCancel,ready,busy,onClearError}=props;
 const [selected,setSelected]=useState('');
 const originals=new Map(state.payments.filter(p=>p.kind==='payout').map(p=>[p.id,p]));
 const visible=new Set(payments.flatMap(p=>{const original=p.reversalOf?originals.get(p.reversalOf):p.kind==='payout'?p:undefined;return original?[groupKey(original)]:[]}));
 const grouped=new Map<string,Payment[]>();
 for(const p of originals.values()){const key=groupKey(p);if(visible.has(key))grouped.set(key,[...(grouped.get(key)||[]),p]);}
 const groups=[...grouped.values()].sort((a,b)=>Date.parse(b[0].cancelledAt||b[0].date)-Date.parse(a[0].cancelledAt||a[0].date));
 return <div className="supplierPayments">
  {!groups.length?<div className="supplierPaymentsEmpty">Оплат за выбранный период нет.</div>:<div className="supplierPaymentsList">{groups.map(group=>{
   const first=group[0],cancelled=group.some(p=>p.cancelledAt),reason=canCancel&&!cancelled?supplierPaymentCancellationReason(state,first.id):'';
   const documents=[...new Set(group.map(p=>state.entries.find(e=>e.id===p.target)?.number).filter(Boolean))];
   const accounts=[...new Set(group.map(p=>state.accounts.find(a=>a.id===p.account)?.name||'Касса'))];
   return <article className={'supplierPayment'+(cancelled?' isCancelled':'')} key={groupKey(first)}>
    <div className="supplierPaymentMain"><span className="supplierPaymentIcon"><Wallet size={22}/></span><div><strong>{first.party}</strong><span>{date(first.date)} · {accounts.join(', ')}</span><span>{documents.length===1?'Накладная':'Накладные'} № {documents.join(', ')||'—'}</span>{first.note&&<span className="supplierPaymentNote">{first.note}</span>}</div></div>
    <div className="supplierPaymentAction"><b>{money(groupAmount(group))}</b>{cancelled?<span className="supplierPaymentStatus"><CheckCircle2 size={15}/> Отменена</span>:canCancel&&<button type="button" className="cancelPaymentButton" disabled={busy||!ready||!!reason} title={reason||'Восстановить долг и сумму в кассе'} onClick={()=>{onClearError();setSelected(first.id)}}><Undo2 size={16}/> Отменить оплату</button>}{reason&&<small className="supplierPaymentBlocked">{reason}</small>}</div>
    {cancelled&&<div className="supplierPaymentAudit">В кассу восстановлено {money(groupAmount(group))} · {first.cancelledAt?date(first.cancelledAt):''}<span>{first.cancellationReason} · Директор: {first.cancelledBy||'director'}</span></div>}
   </article>;
  })}</div>}
  {selected&&canCancel&&<CancelPaymentDialog {...props} paymentId={selected} onClose={()=>setSelected('')}/>}
 </div>;
}

function CancelPaymentDialog({state,paymentId,ready,busy,error,onClearError,onCancel,onRepay,onClose}:Props&{paymentId:string;onClose:()=>void}){
 const dialog=useRef<HTMLDialogElement>(null),titleId=useId(),descriptionId=useId();
 const [reason,setReason]=useState('Ошибка при вводе'),[comment,setComment]=useState(''),[done,setDone]=useState(false),[sending,setSending]=useState(false),[localError,setLocalError]=useState('');
 const group=supplierPaymentGroup(state,paymentId),first=group[0],amount=groupAmount(group),locked=busy||sending;
 const blocked=done?'':supplierPaymentCancellationReason(state,paymentId);
 const documents=[...new Set(group.map(p=>state.entries.find(e=>e.id===p.target)?.number).filter(Boolean))];
 const changes=new Map<string,number>();for(const p of group)changes.set(p.account,round((changes.get(p.account)||0)-p.amount));
 const partyId=state.entries.find(e=>e.id===first?.target)?.partyId;
 useEffect(()=>{const element=dialog.current;element?.showModal();return()=>{if(element?.open)element.close()}},[]);
 async function submit(event:React.FormEvent){
  event.preventDefault();if(locked||!ready||blocked)return;
  const explanation=reason==='Другая причина'?comment.trim():reason;
  if(!explanation){setLocalError('Укажите причину отмены');return;}
  setSending(true);setLocalError('');
  try{const next=await onCancel(paymentId,amount,explanation);if(next)setDone(true)}catch{setLocalError('Не удалось сохранить отмену. Обновите страницу и проверьте историю оплат.')}finally{setSending(false)}
 }
 return <dialog className="paymentCancelDialog" ref={dialog} aria-labelledby={titleId} aria-describedby={descriptionId} onCancel={event=>{event.preventDefault();if(!locked)onClose()}}>
  <div className="paymentCancelHeader"><h2 id={titleId}>{done?'Оплата отменена':'Отменить оплату?'}</h2><button type="button" aria-label="Закрыть" disabled={locked} onClick={onClose}><X size={21}/></button></div>
  {done?<div className="paymentCancelBody"><div className="paymentCancelSuccess"><CheckCircle2 size={42}/><strong>Долг и сумма в кассе восстановлены</strong></div><p id={descriptionId}>Отмена {money(amount)} сохранена в истории. Теперь можно внести правильную оплату.</p><div className="paymentCancelFooter"><button type="button" onClick={onClose}>Готово</button>{partyId&&first&&<button type="button" className="green" onClick={()=>{onClose();onRepay(partyId,first.account)}}>Внести правильную оплату</button>}</div></div>:<form onSubmit={submit} className="paymentCancelBody">
   <p className="paymentCancelParty">{first?.party||'Поставщик'}</p><strong className="paymentCancelAmount">{money(amount)}</strong>
   <p id={descriptionId}>Долг поставщику увеличится на эту сумму. Деньги восстановятся в учёте кассы.</p>
   <div className="paymentCancelEffects">{[...changes].map(([account,total])=><div key={account}><span>{state.accounts.find(a=>a.id===account)?.name||'Касса'}</span><b>+{money(total)}</b></div>)}<small>{documents.length===1?'Накладная':'Накладные'} № {documents.join(', ')||'—'}</small></div>
   {group.length>1&&<p className="paymentCancelGroup">Оплата распределена по {documents.length} накладным. Будет отменена вся сумма.</p>}
   <label>Причина отмены<select value={reason} disabled={locked} onChange={event=>{setReason(event.target.value);setLocalError('');onClearError()}}><option>Ошибка при вводе</option><option>Неверная сумма</option><option>Не тот поставщик</option><option>Не та касса</option><option>Другая причина</option></select></label>
   {reason==='Другая причина'&&<label>Что произошло?<textarea required maxLength={300} rows={2} disabled={locked} value={comment} onChange={event=>setComment(event.target.value)} placeholder="Коротко опишите причину"/></label>}
   {(localError||error||blocked)&&<div className="error" role="alert">{localError||error||blocked}</div>}
   <small className="paymentCancelFootnote">Изменится только учёт в VAG Oil. Банковский перевод не возвращается.</small>
   <div className="paymentCancelFooter"><button type="button" disabled={locked} onClick={onClose}>Не отменять</button><button type="submit" className="paymentCancelConfirm" disabled={locked||!ready||!!blocked}>{locked?'Сохраняю…':'Отменить оплату'}</button></div>
  </form>}
 </dialog>;
}
