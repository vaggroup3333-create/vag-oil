'use client';
import {useEffect,useRef,useState} from 'react';

/** Keeps horizontal navigation within reach while editing long invoices. */
export function InvoiceScroll(){
 const root=useRef<HTMLDivElement>(null);
 const target=useRef<HTMLElement|null>(null);
 const [position,setPosition]=useState(0);
 const [limit,setLimit]=useState(0);
 useEffect(()=>{
  const table=root.current?.closest('form')?.querySelector<HTMLTableElement>('.purchaseLines');
  const viewport=table?.parentElement;
  if(!table||!viewport)return;
  target.current=viewport;
  const update=()=>{setLimit(Math.max(0,viewport.scrollWidth-viewport.clientWidth));setPosition(viewport.scrollLeft);};
  const observer=new ResizeObserver(update);
  observer.observe(viewport);observer.observe(table);
  viewport.addEventListener('scroll',update,{passive:true});update();
  return()=>{observer.disconnect();viewport.removeEventListener('scroll',update);target.current=null;};
 },[]);
 const move=(value:number)=>{if(target.current)target.current.scrollLeft=Math.max(0,Math.min(limit,value));};
 return <div ref={root} className="invoiceScroll" aria-label="Прокрутка столбцов накладной">
  <button type="button" disabled={position<=0} onClick={()=>move(position-300)} aria-label="Прокрутить накладную влево">← Влево</button>
  <input type="range" min={0} max={limit} step={1} value={Math.min(position,limit)} disabled={limit<=0} aria-label="Положение столбцов накладной" onChange={e=>move(Number(e.target.value))}/>
  <button type="button" disabled={position>=limit-1} onClick={()=>move(position+300)} aria-label="Прокрутить накладную вправо">Вправо →</button>
 </div>;
}
