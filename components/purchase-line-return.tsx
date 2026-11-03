'use client';
import {useEffect,useId,useRef,useState} from 'react';
import {CheckCircle2,Minus,Plus,Undo2,X} from 'lucide-react';
import {SafeInput} from './safe-input';
import {debt,posted,activeReturn,round,returnQuote} from '../lib/ledger';
import type {State} from '../lib/ledger';

const qtyRound=(v:number)=>Math.round(v*1000)/1000;
const number=(v:number)=>new Intl.NumberFormat('ru-RU',{maximumFractionDigits:3}).format(v);
const money=(v:number)=>new Intl.NumberFormat('ru-RU',{minimumFractionDigits:2,maximumFractionDigits:2}).format(v)+' TJS';

function availability(state:State,sourceId:string,productId:string){
 const source=state.entries.find(e=>e.id===sourceId&&e.type==='purchase');
 const line=source?.lines.find(l=>l.id===productId&&l.kind!=='service');
 const product=state.products.find(p=>p.id===productId);
 const returned=qtyRound(state.entries.filter(e=>activeReturn(e)&&e.type==='purchase_return'&&e.target===sourceId).flatMap(e=>e.lines).filter(l=>l.id===productId).reduce((sum,l)=>sum+l.qty,0));
 const remaining=Math.max(0,qtyRound((line?.qty||0)-returned));
 let available=Math.max(0,Math.min(remaining,product?.qty||0));
 const pack=line?.packaging;
 if(pack){const sealed=(state.packageLots||[]).find(l=>l.sourceId===sourceId&&l.productId===productId)?.sealed||0;available=Math.min(available,sealed*pack.volume);}
 const factor=pack?.volume||1,whole=!!pack||!!product?.wholeOnly;
 const maximum=whole?Math.floor(available/factor+1e-7):qtyRound(available/factor);
 const unit=pack?'шт.':product?.unit||line?.unit||'шт';
 const packName=pack?(pack.kind==='canister'?'Канистра':'Бочка')+' '+number(pack.volume)+' л':'';
 const price=line&&source?(line.price-(line.discount||0)/line.qty)*((source.total+source.discount)?source.total/(source.total+source.discount):1):0;
 const blocked=!source||!line||!product?'Товар не найден':!posted(source)?'Возврат доступен после проведения накладной':remaining<=0?'Уже возвращено всё количество':maximum<=0?(pack?'Нет целых невскрытых упаковок из этой накладной':'Нет остатка на складе'):'';
 return {source,line,product,returned,remaining,factor,whole,maximum,unit,packName,price,blocked};
}

export function PurchaseLineReturnButton({state,sourceId,productId,disabled,onClick}:{state:State;sourceId:string;productId:string;disabled:boolean;onClick:()=>void}){
 const info=availability(state,sourceId,productId);
 return <span className="purchaseLineReturn"><span>{info.returned>0&&<>Уже возвращено: {number(info.returned)} {info.product?.unit||'шт'} · </>}{info.blocked||<>Можно вернуть: {number(info.maximum)} {info.unit}{info.packName?' · '+info.packName:''}</>}</span><button type="button" className="purchaseReturnButton" disabled={disabled||!!info.blocked} title={info.blocked||'Вернуть этот товар поставщику'} onClick={onClick}><Undo2 size={15}/> Вернуть</button></span>;
}

type Props={state:State;sourceId:string;productId:string;ready:boolean;busy:boolean;error:string;onClearError:()=>void;onClose:()=>void;onReturn:(action:any)=>Promise<State|null>};
type Result={qty:number;unit:string;total:number;refund:number;debtAfter:number;account:string;document:string};
export function PurchaseLineReturnDialog({state,sourceId,productId,ready,busy,error,onClearError,onClose,onReturn}:Props){
 const info=availability(state,sourceId,productId),dialog=useRef<HTMLDialogElement>(null),titleId=useId(),descriptionId=useId();
 const [quantity,setQuantity]=useState(String(Math.min(1,info.maximum)||1));
 const [account,setAccount]=useState(info.source?.account||state.accounts[0]?.id||'cash');
 const [sending,setSending]=useState(false),[localError,setLocalError]=useState(''),[result,setResult]=useState<Result|null>(null);
 const locked=busy||sending,minimum=info.whole?1:.001,count=Number(quantity),qty=qtyRound(count*info.factor);
 const valid=quantity.trim()!==''&&Number.isFinite(count)&&count>=minimum&&count<=info.maximum&&(!info.whole||Number.isInteger(count))&&Math.abs(count-qtyRound(count))<1e-8;
 const total=valid&&info.source?returnQuote(state,info.source,[{id:productId,qty}]).total:0,currentDebt=info.source?debt(info.source):0,reduction=Math.min(total,currentDebt),refund=round(Math.max(0,total-currentDebt));
 useEffect(()=>{const element=dialog.current;element?.showModal();return()=>{if(element?.open)element.close()}},[]);
 function change(value:string){setQuantity(value);setLocalError('');onClearError()}
 function step(amount:number){const base=Number.isFinite(count)?count:minimum;change(String(qtyRound(Math.min(info.maximum,Math.max(minimum,base+amount)))))}
 async function submit(event:React.FormEvent){
  event.preventDefault();if(locked||!ready||info.blocked)return;
  if(!valid){setLocalError('Укажите количество от '+number(minimum)+' до '+number(info.maximum)+' '+info.unit);return;}
  setSending(true);setLocalError('');
  try{
   const next=await onReturn({type:'return',target:sourceId,lines:[{id:productId,qty}],account,note:''});
   if(next){const receipt=next.entries.at(-1);const updated=next.entries.find(e=>e.id===sourceId);if(receipt?.type==='purchase_return'&&receipt.target===sourceId&&updated)setResult({qty:count,unit:info.unit,total:receipt.total,refund:receipt.refund||0,debtAfter:debt(updated),account:next.accounts.find(a=>a.id===account)?.name||'Касса',document:receipt.number});}
  }catch{setLocalError('Не удалось получить подтверждение. Обновите накладную и проверьте возвраты перед повторной отправкой.')}finally{setSending(false)}
 }
 return <dialog className="purchaseReturnDialog" ref={dialog} aria-labelledby={titleId} aria-describedby={descriptionId} onCancel={event=>{event.preventDefault();if(!locked)onClose()}}>
  <div className="purchaseReturnHeader"><h2 id={titleId}>{result?'Товар возвращён':'Вернуть товар'}</h2><button type="button" aria-label="Закрыть" disabled={locked} onClick={onClose}><X size={21}/></button></div>
  {result?<div className="purchaseReturnBody"><div className="purchaseReturnSuccess"><CheckCircle2 size={42}/><strong>Возврат сохранён</strong></div><p id={descriptionId}>{info.line?.name} · {number(result.qty)} {result.unit}</p><div className="purchaseReturnSummary"><div><span>Сумма возврата</span><b>{money(result.total)}</b></div><div><span>Остался долг по накладной</span><b>{money(result.debtAfter)}</b></div>{result.refund>0?<div><span>Поступило в «{result.account}»</span><b>+{money(result.refund)}</b></div>:<small>Деньги в кассе не изменились.</small>}</div><small>Возврат № {result.document} · накладная № {info.source?.number}</small><div className="purchaseReturnFooter"><button type="button" className="green" onClick={onClose}>Вернуться в накладную</button></div></div>:<form className="purchaseReturnBody" onSubmit={submit}>
   <p className="purchaseReturnProduct">{info.line?.name||'Товар'}</p><p id={descriptionId}>Накладная № {info.source?.number} · {info.source?.party}</p>
   {info.packName&&<div className="purchaseReturnPack">{info.packName} · возврат целыми упаковками</div>}
   <label className="purchaseReturnQtyLabel" htmlFor={titleId+'-qty'}>Сколько вернуть, {info.unit}?</label><div className="purchaseReturnStepper"><button type="button" aria-label="Уменьшить количество" disabled={locked||!valid||count<=minimum} onClick={()=>step(-1)}><Minus size={22}/></button><SafeInput id={titleId+'-qty'} type="number" required min={minimum} max={info.maximum} step={minimum} disabled={locked} value={quantity} onChange={event=>change(event.target.value)}/><button type="button" aria-label="Увеличить количество" disabled={locked||!valid||count>=info.maximum} onClick={()=>step(1)}><Plus size={22}/></button></div>
   <small className="purchaseReturnAvailable">Доступно: {number(info.maximum)} {info.unit}{info.packName&&valid?' · '+number(qty)+' л':''}</small>
   <div className="purchaseReturnSummary"><div><span>Сумма возврата</span><b>{money(total)}</b></div><div><span>Долг уменьшится на</span><b>{money(reduction)}</b></div><div><span>Останется долг</span><b>{money(round(currentDebt-reduction))}</b></div>{refund===0&&<small>Деньги в кассе не изменятся.</small>}</div>
   {refund>0&&<label className="purchaseReturnAccount">Поставщик возвращает {money(refund)}<select required disabled={locked} value={account} onChange={event=>setAccount(event.target.value)}>{state.accounts.map(a=><option key={a.id} value={a.id}>{a.name}</option>)}</select><small>Эта сумма будет записана как поступление в выбранную кассу.</small></label>}
   {(localError||error||info.blocked)&&<div className="error" role="alert">{localError||error||info.blocked}</div>}
   <div className="purchaseReturnFooter"><button type="button" disabled={locked} onClick={onClose}>Назад</button><button type="submit" className="green" disabled={locked||!ready||!valid||!!info.blocked}>{locked?'Сохраняю…':'Подтвердить возврат'}</button></div>
  </form>}
 </dialog>;
}
