'use client';

import {useEffect,useState} from 'react';
import {Search,RotateCcw,ChevronDown} from 'lucide-react';
import type {Product} from '../lib/ledger';
import {ProductPhoto} from './product-photo';

const number=(value:number)=>new Intl.NumberFormat('ru-RU',{maximumFractionDigits:3}).format(value||0);

export function ProductPhotoCatalog({products,categories,query,barcode,category,onQuery,onBarcode,onCategory,onReset,photoURL,onProduct}:{
 products:Product[];categories:string[];query:string;barcode:string;category:string;
 onQuery:(value:string)=>void;onBarcode:(value:string)=>void;onCategory:(value:string)=>void;onReset:()=>void;
 photoURL:(key:string)=>string;onProduct:(product:Product)=>void;
}){
 const [limit,setLimit]=useState(48);
 useEffect(()=>setLimit(48),[query,barcode,category]);
 return <section className="photoCatalog" aria-label="Каталог товаров с фотографиями">
  <div className="photoCatalogFilters">
   <label className="photoCatalogSearch">Поиск товара<span><Search size={18} aria-hidden="true"/><input type="search" placeholder="Название, артикул, код или QR" value={query} onChange={e=>onQuery(e.target.value)}/></span></label>
   <label>Категория<select value={category} onChange={e=>onCategory(e.target.value)}><option value="">Все категории</option>{categories.map(c=><option key={c}>{c}</option>)}</select></label>
   <details className="photoCatalogExtra"><summary>Ещё фильтры</summary><label>Штрихкод / QR<input value={barcode} onChange={e=>onBarcode(e.target.value)} placeholder="Введите штрихкод или QR"/></label></details>
   {(query||barcode||category)&&<button type="button" className="photoCatalogReset" onClick={onReset}><RotateCcw size={16}/> Сбросить</button>}
  </div>
  <div className="photoCatalogSummary"><strong>Найдено: {products.length}</strong><span>Нажмите фото, чтобы увеличить</span></div>
  <div className="photoCatalogGrid">
   {products.slice(0,limit).map(p=><article key={p.id} className="photoCatalogCard" data-product-id={p.id}>
    <ProductPhoto src={p.imageKey?photoURL(p.imageKey):undefined} name={p.name} className="photoCatalogPhoto" onAdd={()=>onProduct(p)}/>
    {!p.imageKey&&<span className="photoCatalogMissing">Фото не добавлено</span>}
    <button type="button" className="photoCatalogName" onClick={()=>onProduct(p)}>{p.name}</button>
    <small className="photoCatalogArticle">{p.article?'Артикул: '+p.article:'Код: '+p.code}</small>
    <div className="photoCatalogStock"><span>Остаток</span><strong>{number(p.qty)} {p.unit}</strong></div>
    <div className="photoCatalogPrice"><span>Розница</span><strong>{number(p.price)} TJS</strong></div>
    <button type="button" className="photoCatalogOpen" onClick={()=>onProduct(p)} aria-label={'Открыть карточку: '+p.name}>Карточка товара</button>
   </article>)}
  </div>
  {!products.length&&<div className="photoCatalogEmpty"><Search size={28}/><strong>Товары не найдены</strong><p>Измените поиск или категорию.</p><button type="button" onClick={onReset}>Сбросить фильтры</button></div>}
  {products.length>limit&&<div className="photoCatalogMore"><button type="button" onClick={()=>setLimit(n=>n+48)}><ChevronDown size={18}/> Показать ещё товары</button><span>Показано {limit} из {products.length}</span></div>}
 </section>;
}
