'use client';

import {round} from '../lib/ledger';
import type {Product} from '../lib/ledger';
import type {PackSpec} from '../lib/packaging';

type Tier='retail'|'wholesale';
type Props={
  product?:Product;
  line:{price:number;priceTier?:Tier|'custom';packaging?:PackSpec};
  disabled:boolean;
  onChange:(tier:Tier)=>void;
};

export function CartLinePrice({product,line,disabled,onChange}:Props){
  if(!product)return null;
  const effectivePrice=(price:number)=>line.packaging&&line.packaging.volume>0
    ? round(price*line.packaging.volume)/line.packaging.volume : price;
  const matches=(price:number)=>Math.abs(line.price-effectivePrice(price))<0.000001;
  // A manually entered package price must not keep a stale catalogue-price badge.
  const active:Tier|undefined=line.priceTier==='custom'?undefined:
    line.priceTier==='wholesale'?(matches(product.wholesale)?'wholesale':undefined):
    matches(product.price)?'retail':undefined;
  const options:{tier:Tier;label:string;price:number}[]=[
    {tier:'retail',label:'Розница',price:product.price},
    {tier:'wholesale',label:'Оптом',price:product.wholesale},
  ];
  return <div className="cashLinePrice" role="group" aria-label={'Цена товара: '+product.name}>
    {options.map(({tier,label,price})=><button key={tier} type="button"
      className={'cashLinePriceButton '+tier} aria-pressed={active===tier}
      aria-label={label+': '+product.name}
      title={label+' — '+new Intl.NumberFormat('ru-RU',{maximumFractionDigits:2}).format(price)+' TJS / '+product.unit}
      disabled={disabled||!Number.isFinite(price)||price<0}
      onClick={()=>onChange(tier)}>{label}</button>)}
  </div>;
}
