'use client';
import {useEffect,useId,useState} from 'react';
import {ChevronDown,ChevronRight,ChevronsDownUp,ChevronsUpDown,Info,Search,X} from 'lucide-react';
import type {CSSProperties} from 'react';

type IconName='sale'|'return'|'suppliers'|'clients'|'products'|'balance'|'cash'|'profit';
type Group={id:IconName;name:string;color:string;views:string[]};
const groups:Group[]=[
 {id:'sale',name:'Продажа',color:'#347cf5',views:['Продажа по чекам','Продажа по способам оплаты','Продажа по товарам']},
 {id:'return',name:'Возврат от клиента',color:'#a34df3',views:['Возврат по чекам','Возврат по товарам']},
 {id:'suppliers',name:'Контрагенты',color:'#f87716',views:['Продажи по поставщикам','Выписка контрагентов','Наш долг поставщикам']},
 {id:'clients',name:'Клиенты',color:'#1dc362',views:['Выписка клиентов','Должники','История оплаты долга']},
 {id:'products',name:'Товары',color:'#0db0ca',views:['Движение товаров','Остатки товаров','Товары с изменёнными ценами','Необорачиваемые товары','ABC/XYZ анализ','Рентабельность товаров (ROI)']},
 {id:'balance',name:'Баланс',color:'#f43c6b',views:['Баланс','Баланс по дате']},
 {id:'cash',name:'Кассы',color:'#efa000',views:['Движение кассы']},
 {id:'profit',name:'Прибыль',color:'#20bd65',views:['Прибыль по дням','Прибыль по товарам']},
];
const normal=(s:string)=>s.toLocaleLowerCase('ru').replace(/ё/g,'е').trim();

// Original SVG artwork keeps the icons crisp at any screen size and offline.
function ReportIcon({name}:{name:IconName}){
 const content={
  sale:<><path d="M7 11h8l8 30h30l7-23H18" fill="currentColor" stroke="currentColor" strokeWidth="5" strokeLinejoin="round" strokeLinecap="round"/><circle cx="28" cy="54" r="5.5"/><circle cx="49" cy="54" r="5.5"/></>,
  return:<><path d="M16 24a21 21 0 1 1-3 25" fill="none" stroke="currentColor" strokeWidth="7" strokeLinecap="round"/><path d="M12 10v18h18" fill="none" stroke="currentColor" strokeWidth="7" strokeLinejoin="round" strokeLinecap="round"/></>,
  suppliers:<><rect x="7" y="8" width="32" height="49" rx="6"/><g fill="white"><rect x="14" y="17" width="6" height="7" rx="1"/><rect x="26" y="17" width="6" height="7" rx="1"/><rect x="14" y="30" width="6" height="7" rx="1"/><rect x="26" y="30" width="6" height="7" rx="1"/><path d="M18 57V46a5 5 0 0 1 10 0v11"/></g><circle cx="50" cy="34" r="9" stroke="white" strokeWidth="3"/><path d="M36 59v-7c0-8 7-12 14-12s14 4 14 12v7Z" stroke="white" strokeWidth="3" strokeLinejoin="round"/></>,
  clients:<><circle cx="25" cy="21" r="12"/><path d="M3 58v-7c0-11 9-18 22-18s22 7 22 18v7Z"/><circle cx="46" cy="23" r="10" opacity=".9"/><path d="M43 36c12 0 20 7 20 17v5H51v-7c0-6-3-12-8-15Z" opacity=".9"/></>,
  products:<><path d="m32 6 15 7v17l-15 8-15-8V13Z"/><path d="m16 31 15 7v18l-15 8L1 56V38Zm32 0 15 7v18l-15 8-15-8V38Z"/><g fill="none" stroke="white" strokeWidth="3.2" strokeLinejoin="round"><path d="m19 14 13 6 13-6M32 20v15M3 39l13 6 13-6M16 45v16M35 39l13 6 13-6M48 45v16"/></g></>,
  balance:<><path d="M11 15h44M33 12v46M18 60h30" fill="none" stroke="currentColor" strokeWidth="6" strokeLinecap="round"/><circle cx="33" cy="15" r="7"/><path d="M14 23 3 43h22ZM51 23 40 43h22Z" fill="none" stroke="currentColor" strokeWidth="4.5" strokeLinejoin="round"/><path d="M3 44c0 8 22 8 22 0ZM40 44c0 8 22 8 22 0Z"/></>,
  cash:<><path d="M12 11h39a4 4 0 0 1 0 8H14a3 3 0 0 0 0 6h40a7 7 0 0 1 7 7v22a7 7 0 0 1-7 7H12a8 8 0 0 1-8-8V19a8 8 0 0 1 8-8Z"/><circle cx="51" cy="42" r="3.5" fill="white"/></>,
  profit:<><path d="M10 10v48h46M20 43l12-14 10 8 16-20" fill="none" stroke="currentColor" strokeWidth="6" strokeLinecap="round" strokeLinejoin="round"/><path d="M48 16h11v11" fill="none" stroke="currentColor" strokeWidth="5" strokeLinecap="round" strokeLinejoin="round"/></>,
 };
 return <svg viewBox="0 0 68 68" fill="currentColor" aria-hidden="true" focusable="false">{content[name]}</svg>;
}

export function ReportCatalog({query,onQuery,selected,onSelect}:{query:string;onQuery:(value:string)=>void;selected:string;onSelect:(view:string)=>void}){
 const prefix=useId();
 const [expanded,setExpanded]=useState<string[]>([]);
 const search=normal(query),tokens=search.split(/\s+/).filter(Boolean);
 const visible=groups.map(group=>({...group,matched:tokens.length?group.views.filter(view=>tokens.every(token=>normal(group.name+' '+view).includes(token))):group.views})).filter(group=>group.matched.length);
 const allOpen=visible.length>0&&visible.every(group=>expanded.includes(group.id));
 useEffect(()=>{const group=groups.find(group=>group.views.includes(selected));if(group)setExpanded(old=>old.includes(group.id)?old:[...old,group.id])},[selected]);
 function choose(view:string){onSelect(view);requestAnimationFrame(()=>document.getElementById('active-report')?.scrollIntoView({behavior:matchMedia('(prefers-reduced-motion: reduce)').matches?'auto':'smooth',block:'start'}))}
 return <section className="panel reportsHub" aria-labelledby="reports-heading">
  <div className="reportsHeading"><div><h2 id="reports-heading">Отчёты</h2><p>Продажи, товары и финансы вашего магазина</p></div><span className="reportsHeadingCount">{groups.length} разделов</span></div>
  <div className="reportsToolbar"><div className="reportsSearch"><Search size={20} aria-hidden="true"/><input aria-label="Поиск отчёта" placeholder="Поиск отчёта…" value={query} onChange={event=>onQuery(event.target.value)}/>{query&&<button type="button" aria-label="Очистить поиск отчёта" onClick={()=>onQuery('')}><X size={18}/></button>}</div>{!search&&<button type="button" className="reportsExpand" onClick={()=>setExpanded(allOpen?[]:visible.map(group=>group.id))}>{allOpen?<ChevronsDownUp size={18}/>:<ChevronsUpDown size={18}/>}<span>{allOpen?'Свернуть всё':'Развернуть всё'}</span></button>}{search&&<span className="reportsSearchCount" role="status">Найдено отчётов: {visible.reduce((sum,group)=>sum+group.matched.length,0)}</span>}</div>
  <div className="reportTiles">{visible.map(group=>{const open=!!search||expanded.includes(group.id),active=group.views.includes(selected),contentId=prefix+'-'+group.id;return <article key={group.id} className={'reportTile'+(open?' isOpen':'')+(active?' isActive':'')} style={{'--report-color':group.color} as CSSProperties}><h3><button type="button" className="reportTileToggle" disabled={!!search} aria-expanded={open} aria-controls={contentId} onClick={()=>setExpanded(old=>old.includes(group.id)?old.filter(id=>id!==group.id):[...old,group.id])}><span className="reportTileIcon"><ReportIcon name={group.id}/></span><span className="reportTileName">{group.name}</span><ChevronDown className="reportTileChevron" size={19}/></button></h3><div className="reportTileLinks" id={contentId} hidden={!open}>{group.matched.map(view=><button type="button" key={view} className={selected===view?'selected':''} aria-current={selected===view?'page':undefined} onClick={()=>choose(view)}><span>{view}</span><ChevronRight size={17} aria-hidden="true"/></button>)}</div></article>})}</div>
  {!visible.length&&<div className="reportsEmpty" role="status"><Search size={34}/><h3>Отчёт не найден</h3><p>Попробуйте «остатки», «продажа» или «прибыль».</p><button type="button" onClick={()=>onQuery('')}>Показать все разделы</button></div>}
  <details className="reportsHelp"><summary><Info size={21}/><span>О разделах отчётов</span><ChevronDown size={19}/></summary><p>Нажмите на карточку, затем выберите нужный отчёт. Поиск сразу показывает подходящие отчёты. Кнопка «Развернуть всё» открывает весь список.</p></details>
 </section>;
}
