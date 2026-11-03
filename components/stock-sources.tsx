'use client';
import {saleStock,draftStock} from '../lib/draft-stock';
import {useState} from 'react';
import {Boxes,CheckCircle2,Wallet,HelpCircle,Search} from 'lucide-react';
import type {State,Product} from '../lib/ledger';
import {StockSplit,stockOrigins,originLabels,stockBalance,emptySplit,splitTotal,q} from '../lib/stock-sources';
import {SafeInput} from './safe-input';
import './stock-sources.css';
const fmt=(v:number)=>new Intl.NumberFormat('ru-RU',{maximumFractionDigits:3}).format(v);

export function SourcePicker({s,p,line,onChange,disabled=false,available,includeDrafts=false,title='Какой товар продаём'}:{s:State,p:Product|undefined,line:any,onChange:(line:any)=>void,disabled?:boolean,available?:StockSplit,includeDrafts?:boolean,title?:string}){
 if(!p)return null;
 const actual=stockBalance(s,p.id),b=available||(includeDrafts?saleStock(s,p.id):actual),keys=stockOrigins.filter(k=>b[k]>0),selected=line.stockOrigin||(keys.length===1?keys[0]:''),parts=line.stockSplit||emptySplit();
 return <fieldset className="sourcePicker" disabled={disabled}><legend>{title}</legend><div className="sourceChoices">
 {keys.map(k=><button key={k} type="button" aria-pressed={selected===k} className={'sourceChoice source-'+k+(selected===k?' selected':'')} onClick={()=>onChange({...line,stockOrigin:k,stockSplit:undefined})}><span>{originLabels[k]}</span><b>{fmt(b[k])} {p.unit}</b>{includeDrafts&&b[k]>Math.max(0,actual[k])&&<small>На складе: {fmt(actual[k])} · остальное в черновиках</small>}</button>)}
 {keys.length>1&&<button type="button" aria-pressed={selected==='split'} className={'sourceChoice'+(selected==='split'?' selected':'')} onClick={()=>onChange({...line,stockOrigin:'split',stockSplit:emptySplit()})}><span>Из нескольких</span><small>Указать количества</small></button>}
 </div>{!selected&&keys.length>1&&<small className="sourceAttention">Выберите, из какого остатка списать товар.</small>}
 {selected==='split'&&<div className="sourceAmounts">{keys.map(k=><label key={k}>{originLabels[k]}, {p.unit}<SafeInput type="number" inputMode="decimal" min="0" max={b[k]} step={p.wholeOnly?1:.001} value={parts[k]} onChange={e=>onChange({...line,stockSplit:{...parts,[k]:Number(e.target.value)}})}/></label>)}<small className={Math.abs(splitTotal(parts)-Number(line.qty))>.000001?'sourceAttention':''}>Распределено {fmt(splitTotal(parts))} из {fmt(Number(line.qty)||0)} {p.unit}</small></div>}
 {selected==='unknown'&&<small>Происхождение этого остатка ещё не уточнено директором.</small>}
 {!keys.length&&<small className="sourceAttention">Нет доступного остатка.</small>}
 </fieldset>;
}

export function StockSourceInline({s,id,unit}:{s:State,id:string,unit:string}){
 const b=stockBalance(s,id),incoming=draftStock(s)[id];return <span className="sourceInline">{incoming&&(incoming.paid+incoming.credit)>0&&<span>В черновиках: {fmt(incoming.paid+incoming.credit)} {unit}</span>}{b.paid!==0&&<span className="source-paid">Оплаченный: {fmt(b.paid)} {unit}</span>}{b.credit!==0&&<span className="source-credit">В долг: {fmt(b.credit)} {unit}</span>}{b.unknown>0&&<span className="source-unknown">Уточнить: {fmt(b.unknown)} {unit}</span>}</span>;
}
export function SourceSplitLabel({split,unit}:{split?:StockSplit,unit?:string}){if(!split)return null;return <small className="sourceInline">{stockOrigins.filter(k=>split[k]>0).map(k=><span key={k} className={'source-'+k}>{originLabels[k]}: {fmt(split[k])}{unit?' '+unit:''}</span>)}</small>}

export function StockSourcesSection({s,ready,busy,onSave,onProduct}:{s:State,ready:boolean,busy:boolean,onSave:(a:any)=>Promise<State|null>,onProduct:(p:Product)=>void}){
 const [search,setSearch]=useState(''),[filter,setFilter]=useState('all'),[editId,setEditId]=useState(''),[paid,setPaid]=useState(''),[credit,setCredit]=useState(''),[error,setError]=useState('');
 const products=s.products.filter(p=>[p.name,p.article,p.code,p.barcode,p.qrCode].join(' ').toLocaleLowerCase('ru').includes(search.trim().toLocaleLowerCase('ru'))&&(filter==='all'?stockOrigins.some(k=>stockBalance(s,p.id)[k]!==0):stockBalance(s,p.id)[filter as keyof StockSplit]!==0));
 const icons={paid:CheckCircle2,credit:Wallet,unknown:HelpCircle};const p=s.products.find(p=>p.id===editId);
 async function assign(){if(!p)return;setError('');const next=await onSave({type:'stock_origin_assign',id:p.id,beforeUnknown:stockBalance(s,p.id).unknown,paid:Number(paid),credit:Number(credit)});if(next)setEditId('');else setError('Не удалось сохранить. Проверьте сообщение и обновите данные.')}
 return <section className="panel sourceStock"><h3><Boxes size={22}/> Оплаченные товары и товары, полученные в долг</h3><p>Показан оставшийся товар по условиям его поступления. Погашение долга поставщику не меняет отметку «Получен в долг».</p><div className="sourceSummary">{stockOrigins.map(k=>{const Icon=icons[k],count=s.products.filter(p=>stockBalance(s,p.id)[k]!==0).length;if(k==='unknown'&&!count)return null;return <button type="button" className={'source-'+k+(filter===k?' selected':'')} key={k} onClick={()=>setFilter(filter===k?'all':k)}><Icon size={25}/><span>{originLabels[k]}<b>{count} наименований</b></span></button>})}</div>
 <div className="sourceSearch"><Search size={20}/><input aria-label="Поиск по остаткам" placeholder="Название, артикул, штрихкод или QR" value={search} onChange={e=>setSearch(e.target.value)}/><button type="button" onClick={()=>{setFilter('all');setSearch('')}}>Все остатки</button></div>
 <div className="tablewrap"><table><thead><tr><th>Товар</th><th>Оплаченный</th><th>Получен в долг</th><th>Нужно уточнить</th><th>Всего</th><th/></tr></thead><tbody>{products.map(item=>{const b=stockBalance(s,item.id);return <tr key={item.id}><td><button type="button" className="link" onClick={()=>onProduct(item)}>{item.name}</button><small>{item.article||item.code}</small></td><td className="source-paid">{fmt(b.paid)} {item.unit}</td><td className="source-credit">{fmt(b.credit)} {item.unit}</td><td>{b.unknown?fmt(b.unknown)+' '+item.unit:'—'}</td><td><b>{fmt(item.qty)} {item.unit}</b></td><td>{b.unknown>0&&<button disabled={!ready||busy} onClick={()=>{setEditId(item.id);setPaid('0');setCredit('0');setError('')}}>Уточнить</button>}</td></tr>})}</tbody></table></div>{!products.length&&<div className="empty">Нет товаров с таким остатком.</div>}
 <div className="notice">Новая покупка с полной оплатой при проведении → «Оплаченный». Покупка без оплаты или с частичной оплатой → «Получен в долг». Уже оплаченные товары до начала учёта добавляйте через «Начальные остатки».</div>
 {p&&<div className="overlay"><div className="modal"><div className="modalhead"><h2>Уточнить происхождение</h2><button type="button" disabled={busy} onClick={()=>setEditId('')}>Закрыть</button></div><div className="modalbody"><h3>{p.name}</h3><p>Распределите {fmt(stockBalance(s,p.id).unknown)} {p.unit}. Общее количество, касса и долг не меняются.</p>{error&&<div className="error">{error}</div>}<div className="fields"><label>Оплаченный, {p.unit}<input type="number" min="0" step={p.wholeOnly?1:.001} value={paid} onChange={e=>setPaid(e.target.value)}/></label><label>Получен в долг, {p.unit}<input type="number" min="0" step={p.wholeOnly?1:.001} value={credit} onChange={e=>setCredit(e.target.value)}/></label></div><p>Укажите происхождение по вашим документам. Для старых смешанных остатков программа его не угадывает.</p></div><div className="modalfoot"><button type="button" className="green" disabled={busy||q(Number(paid)+Number(credit))!==stockBalance(s,p.id).unknown} onClick={()=>void assign()}>Сохранить распределение</button></div></div></div>}
 </section>;
}
