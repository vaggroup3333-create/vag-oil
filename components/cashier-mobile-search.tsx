'use client';

import {useRef} from 'react';
import {Plus, ScanLine, Search, X} from 'lucide-react';
import type {Product} from '../lib/ledger';

const normalize=(value:string)=>value.toLocaleLowerCase('ru').replace(/ё/g,'е').trim();
const quantity=(value:number)=>new Intl.NumberFormat('ru-RU',{maximumFractionDigits:3}).format(value);
const money=(value:number)=>new Intl.NumberFormat('ru-RU',{maximumFractionDigits:2}).format(value)+' TJS';

export function MobileCashierSearch({value,onChange,disabled,onScan}:{
  value:string;onChange:(value:string)=>void;disabled:boolean;onScan:()=>void;
}){
  const input=useRef<HTMLInputElement>(null);
  return <div className="cashMobileSearchPanel">
    <div className="cashMobileSearchRow">
      <form className="cashMobileSearchForm" role="search" onSubmit={event=>{event.preventDefault();input.current?.blur();}}>
        <label className="sr-only" htmlFor="cash-mobile-product-search">Поиск товаров для продажи</label>
        <input id="cash-mobile-product-search" ref={input} type="search" autoComplete="off" enterKeyHint="search"
          placeholder="Название, артикул или QR" value={value} onChange={event=>onChange(event.target.value)}/>
        {value&&<button type="button" aria-label="Очистить поиск товара" onClick={()=>{onChange('');input.current?.focus();}}><X size={18}/></button>}
        <button type="submit" aria-label="Показать найденные товары" title="Найти"><Search size={21}/></button>
      </form>
      <button type="button" className="cashMobileScan" disabled={disabled} onClick={onScan} aria-label="Сканировать штрихкод или QR"><ScanLine size={22}/><span>Сканер</span></button>
    </div>
  </div>;
}

/** Results stay mounted when the keyboard loses focus, so a tap can reach Add. */
export function MobileCashierSearchResults({products,value,onAdd,availableQuantity,cartQuantity,disabled}:{
  products:Product[];value:string;onAdd:(id:string)=>boolean;availableQuantity:(id:string)=>number;
  cartQuantity:(id:string)=>number;disabled:boolean;
}){
  const query=normalize(value);
  if(!query)return null;
  const tokens=query.split(/\s+/);
  const exact=(p:Product)=>[p.code,p.article,p.barcode,p.qrCode].some(code=>normalize(String(code||''))===query);
  const matches=products.filter(p=>{
    const text=normalize([p.code,p.name,p.article,p.barcode,p.qrCode,p.location].join(' '));
    return tokens.every(token=>text.includes(token));
  }).sort((a,b)=>Number(exact(b))-Number(exact(a)));
  return <section className="cashMobileResults" aria-label="Найденные товары">
    <p className="cashMobileResultCount" role="status">{matches.length?'Найдено: '+matches.length:'Товары не найдены'}{matches.length>30?' · показаны первые 30, уточните поиск':''}</p>
    {matches.slice(0,30).map(p=>{
      const available=availableQuantity(p.id),inCart=cartQuantity(p.id),canAdd=available>inCart;
      return <article key={p.id} className="cashMobileResult">
        <small>{p.code}{p.article?' · '+p.article:''}</small>
        <h3>{p.name}</h3>
        <p>На складе: {quantity(p.qty)} {p.unit}{available>Math.max(0,p.qty)?' · с черновиками доступно: '+quantity(available)+' '+p.unit:''}</p>
        {inCart>0&&<p className="cashMobileResultInCart">В корзине: {quantity(inCart)} {p.unit}</p>}
        <div className="cashMobileResultAction">
          <div><strong>{money(p.price)}</strong><small>Розничная / {p.unit}</small></div>
          <button type="button" disabled={disabled||!canAdd} aria-label={(inCart?'Добавить ещё: ':'В корзину: ')+p.name}
            onClick={()=>{if(onAdd(p.id))document.querySelector<HTMLInputElement>('#cash-mobile-product-search')?.blur();}}>
            <Plus size={19}/>{!canAdd?(inCart?'Всё в корзине':'Нет остатка'):(inCart?'Добавить ещё':'В корзину')}
          </button>
        </div>
      </article>;
    })}
    {!matches.length&&<div className="cashMobileResultEmpty"><Search size={28}/><p>Попробуйте другое название, артикул, штрихкод или QR.</p></div>}
  </section>;
}
