'use client';
import {useEffect,useMemo,useRef,useState} from 'react';
import {CalendarDays,ChevronLeft,ChevronRight,Download,Printer,FileSpreadsheet} from 'lucide-react';
import type {State} from '../lib/ledger';
import {localDay} from '../lib/reporting';
import {monthlyReport,monthlyMoney,monthlyQty,monthlyDate,monthlySections,monthlyCSV,monthlyHTML,monthlyExplanation,monthlySourceNote,shiftMonth} from '../lib/monthly-report';

export function MonthlyReport({s,ready}:{s:State;ready:boolean}){
 const current=localDay(new Date().toISOString()).slice(0,7);
 const [month,setMonth]=useState(current),[message,setMessage]=useState('');
 const [returnsOpen,setReturnsOpen]=useState(false);
 const returnsPanel=useRef<HTMLElement>(null),returnsButton=useRef<HTMLButtonElement>(null);
 const report=useMemo(()=>ready?monthlyReport(s,month):null,[s,month,ready]);
 function showReturns(){setReturnsOpen(true);if(returnsOpen)focusReturns()}
 function focusReturns(){returnsPanel.current?.focus({preventScroll:true});returnsPanel.current?.scrollIntoView({block:'start',behavior:'auto'})}
 useEffect(()=>{if(returnsOpen)focusReturns()},[returnsOpen]);
 function choose(value:string){if(/^[1-9]\d{3}-(0[1-9]|1[0-2])$/.test(value)&&value<=current){setMonth(value);setMessage('');setReturnsOpen(false)}}
 function save(excel=false){
  if(!report)return;
  const url=URL.createObjectURL(new Blob([excel?monthlyCSV(report):monthlyHTML(report)],{type:excel?'text/csv;charset=utf-8':'text/html;charset=utf-8'}));
  const a=document.createElement('a');a.href=url;a.download='VAG_Oil_Отчёт_'+month+(excel?'.csv':'.html');document.body.appendChild(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),60000);
  setMessage('Файл отправлен на скачивание. На iPhone его можно сохранить в «Файлы».');
 }
 function print(){
  if(!report)return;
  const popup=window.open('','_blank');
  if(!popup){setMessage('Разрешите открытие окна печати или сохраните отчёт файлом.');return}
  popup.opener=null;popup.document.open();popup.document.write(monthlyHTML(report));popup.document.close();popup.focus();popup.setTimeout(()=>popup.print(),300);
 }
 const sections=report?monthlySections(report):[];
 return <section className="monthlyReport" aria-labelledby="monthly-title">
  <div className="monthlyHeading"><div><span className="monthlyEyebrow"><CalendarDays size={17}/> Всё за месяц в одном месте</span><h2 id="monthly-title">Месячный отчёт</h2><p>Выберите месяц и сохраните готовый отчёт.</p></div></div>
  <div className="monthlyToolbar"><div className="monthlyPicker"><button type="button" aria-label="Предыдущий месяц" onClick={()=>choose(shiftMonth(month,-1))}><ChevronLeft size={20}/></button><label>Месяц<input type="month" aria-label="Месяц отчёта" value={month} max={current} onChange={e=>choose(e.target.value)}/></label><button type="button" aria-label="Следующий месяц" disabled={month>=current} onClick={()=>choose(shiftMonth(month,1))}><ChevronRight size={20}/></button></div><div className="monthlyPresets"><button type="button" onClick={()=>choose(shiftMonth(current,-1))}>Прошлый месяц</button><button type="button" onClick={()=>choose(current)}>Этот месяц</button></div></div>
  {!report?<p className="monthlyLoading" role="status">Загружаем данные для отчёта…</p>:<>
   <div className="monthlyPeriod"><h3>{report.title}</h3><span>{report.ongoing?'Текущий месяц · по '+monthlyDate(report.to):monthlyDate(report.from)+' — '+monthlyDate(report.to)}</span></div>
   {report.warnings.length>0&&<div className="monthlyWarnings">{report.warnings.map(w=><p key={w}>{w}</p>)}</div>}
   <div className="monthlyCards">{[['Выручка',report.period.revenue,'После возвратов','revenue'],['Себестоимость',report.period.cost,'Проданных товаров','cost'],['Расходы',report.period.expenses,'Расходы магазина','expenses'],['Прибыль',report.period.profit,'После расходов и корректировок',report.period.profit<0?'loss':'profit']].map(([label,value,hint,color])=><article key={String(label)} className={'monthlyCard '+color}><small>{label}</small><strong>{monthlyMoney(Number(value))}</strong><span>{hint}</span></article>)}</div>
   <button ref={returnsButton} type="button" className="monthlyReturnsButton" aria-expanded={returnsOpen} aria-controls="monthly-returns" onClick={showReturns}><span><b>Возвраты клиентов</b><small>Уже вычтены из выручки</small></span><strong>{monthlyMoney(report.returns.total)}</strong><span className="monthlyReturnsLink">Какие товары вернули →</span></button>
   {returnsOpen&&<section ref={returnsPanel} id="monthly-returns" className="monthlyReturns" tabIndex={-1} aria-labelledby="monthly-returns-title"><div className="monthlyReturnsHeading"><div><h3 id="monthly-returns-title">Возвращённые товары</h3><p>{monthlyDate(report.from)} — {monthlyDate(report.to)} · Чеков возврата: {report.returns.count}</p></div><button type="button" onClick={()=>{setReturnsOpen(false);returnsButton.current?.focus()}}>Скрыть возвраты</button></div><p>Сумма возвратов: <b>{monthlyMoney(report.returns.total)}</b>. Включает возврат денег и уменьшение долга клиента.</p>{report.returns.rows.length?<div className="monthlyReturnRows">{report.returns.rows.map(row=><article key={row.key} className="monthlyReturnRow"><div><b>{row.name}</b><strong>{monthlyMoney(row.amount)}</strong></div><p>{row.unit?monthlyQty({[row.unit]:row.qty}):'Количество не указано'} · {monthlyDate(row.date)} · Возврат № {row.number}{row.saleNumber&&' · Чек № '+row.saleNumber}</p><small>{row.party}</small></article>)}</div>:<p className="monthlyReturnsEmpty">В этом месяце возвратов клиентов нет.</p>}</section>}
   <div className="monthlyExport"><button type="button" className="green" onClick={()=>save()}><Download size={18}/> Сохранить отчёт</button><button type="button" onClick={print}><Printer size={18}/> Печать / PDF</button><button type="button" onClick={()=>save(true)}><FileSpreadsheet size={18}/> Excel</button></div>
   <p className="monthlyMessage" role="status">{message}</p>
   <p className="monthlyCaption">Чеков продажи: <b>{report.period.count}</b>. Прибыль включает продажи в долг. Остаток денег смотрите отдельно ниже.</p>
   <div className="monthlyTables">{sections.map((section,index)=>{const content=<div className="monthlyTableScroll"><table><thead><tr>{section.heads.map(h=><th key={h}>{h}</th>)}</tr></thead><tbody>{section.rows.length?section.rows.map((row,i)=><tr key={i}>{row.map((cell,j)=><td key={j}>{cell}</td>)}</tr>):<tr><td colSpan={section.heads.length}>Нет данных за период</td></tr>}</tbody></table></div>;return index===0?<details key={section.title}><summary>Из чего складывается прибыль</summary>{content}</details>:<section key={section.title}><h3>{section.title}</h3>{content}{index===1&&<small>Без переводов между своими кассами. На начало + поступило − списано = на конец.</small>}{index===3&&<small>Себестоимость проданного помогает оценить расчёты с поставщиками. Она не равна полученным деньгам или сумме к оплате.</small>}</section>})}</div>
   <details className="monthlyHelp"><summary>Как читать и сохранять отчёт</summary><p>{monthlyExplanation}</p><p>{monthlySourceNote}</p><p>Файл сохраняется на вашем устройстве. Для окончательного итога внесите расходы и проведите полученные товары. Касса, товары и долги переходят в следующий месяц.</p></details>
  </>}
 </section>;
}
