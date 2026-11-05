'use client';
import {useEffect,useRef,type RefObject} from 'react';

/** Move once after the dialog and (if needed) the target page are rendered. */
export function useInvoiceRowFocus(root:RefObject<HTMLElement|null>,rowKey:string|undefined,ready=true){
 const completed=useRef<string|undefined>(undefined);
 useEffect(()=>{
  if(rowKey===undefined){completed.current=undefined;return}
  if(!ready||completed.current===rowKey)return;
  const frame=requestAnimationFrame(()=>{
   const row=Array.from(root.current?.querySelectorAll<HTMLElement>('[data-invoice-row]')||[]).find(el=>el.dataset.invoiceRow===rowKey);
   if(!row)return;
   // Scroll the first cell so the product name stays visible in a wide table.
   (row.querySelector('td')||row).scrollIntoView({block:'center',inline:'start',behavior:'instant'});
   row.focus({preventScroll:true});completed.current=rowKey;
  });
  return()=>cancelAnimationFrame(frame);
 },[root,rowKey,ready]);
}
