import {stockOrigins,stockBalance,originLabels} from './stock-sources';
import type {StockOrigin,StockSplit} from './stock-sources';
import type {State,Product,Line,Entry} from './ledger';
export type PackSpec={kind:'canister'|'barrel',volume:number,count:number,unitPrice:number};
export type PackLot={stockOrigin?:StockOrigin,id:string,productId:string,sourceId:string,kind:PackSpec['kind'],volume:number,sealed:number,opened:number[]};
const q=(n:number)=>Math.round(n*1000)/1000;
export function packageSpec(value:any,p:Product):PackSpec|undefined{
 if(!value)return undefined;
 if(p.unit!=='л'||p.wholeOnly)throw Error('Упаковки доступны для масла с дробным учётом в литрах. Карточка товара автоматически не изменяется.');
 const {kind}=value,volume=Number(value.volume),count=Number(value.count),unitPrice=Number(value.unitPrice);
 if(!['canister','barrel'].includes(kind)||!Number.isFinite(volume)||volume<=0||volume>10000||Math.abs(volume-q(volume))>1e-8||!Number.isSafeInteger(count)||count<1||count>100000||!Number.isFinite(unitPrice)||unitPrice<0||unitPrice>1e9||volume*count>1e9)throw Error('Укажите тип, объём (до 3 знаков), целое количество упаковок и цену за упаковку');
 return {kind,volume,count,unitPrice:Math.round(unitPrice*100)/100};
}
export function packageBalance(s:State,p:Product){const lots=(s.packageLots||[]).filter(l=>l.productId===p.id);const sealed=lots.reduce((n,l)=>n+l.sealed,0),sealedLitres=q(lots.reduce((n,l)=>n+l.sealed*l.volume,0)),openedCount=lots.reduce((n,l)=>n+l.opened.length,0),openedLitres=q(lots.reduce((n,l)=>n+l.opened.reduce((a,b)=>a+b,0),0));return {sealed,sealedLitres,openedCount,openedLitres,looseLitres:q(p.qty-sealedLitres-openedLitres),lots};}
export function receivePackages(s:State,p:Product,line:Line,sourceId:string){if(!line.packaging)return;const pack=line.packaging;s.packageLots??=[];const lotId=sourceId+':'+p.id;if(s.packageLots.some(l=>l.id===lotId))throw Error('Упаковки этой накладной уже оприходованы');s.packageLots.push({id:lotId,productId:p.id,sourceId,kind:pack.kind,volume:pack.volume,sealed:pack.count,opened:[]});}
// Consume loose litres, then already-open containers, then open the oldest sealed containers.
export function consumePackages(s:State,p:Product,litres:number,pack?:PackSpec,split?:StockSplit){
 if(split){
  for(const origin of stockOrigins){
   const amount=split[origin];if(!amount)continue;
   const count=pack?Math.round(amount*1000)/Math.round(pack.volume*1000):0;
   if(pack&&!Number.isInteger(count))throw Error('Каждая целая упаковка должна относиться к одному источнику');
   const view={...s,packageLots:(s.packageLots||[]).filter(l=>l.stockOrigin===origin)};
   try{consumePackages(view,{...p,qty:stockBalance(s,p.id)[origin]},amount,pack?{...pack,count}:undefined)}
   catch(error){throw Error(originLabels[origin]+': '+(error as Error).message)}
  }
  return;
 }
 const b=packageBalance(s,p);if(b.looseLitres<-.001)throw Error('Расхождение упаковок и общего остатка');
 if(litres>p.qty+.000001)throw Error('Недостаточно масла: '+p.name);
 if(pack){let left=pack.count;const lots=b.lots.filter(l=>l.kind===pack.kind&&l.volume===pack.volume);if(lots.reduce((n,l)=>n+l.sealed,0)<left)throw Error('Недостаточно запечатанных упаковок выбранного объёма');for(const lot of lots){const take=Math.min(left,lot.sealed);lot.sealed-=take;left-=take;if(!left)break;}return;}
 let left=q(Math.max(0,litres-Math.max(0,b.looseLitres)));
 for(const lot of b.lots){for(let i=0;i<lot.opened.length&&left>0;i++){const take=Math.min(left,lot.opened[i]);lot.opened[i]=q(lot.opened[i]-take);left=q(left-take);}lot.opened=lot.opened.filter(v=>v>0);}
 for(const lot of b.lots){if(left<=0)break;const count=Math.min(lot.sealed,Math.ceil(Math.round(left*1000)/Math.round(lot.volume*1000)));if(!count)continue;lot.sealed-=count;const consumed=Math.min(left,count*lot.volume),remainder=q(count*lot.volume-consumed);if(remainder>0)lot.opened.push(remainder);left=q(left-consumed);}
 if(left>.000001)throw Error('Недостаточно масла для розлива');
}
export function removePurchasePackages(s:State,e:Entry){if(!s.packageLots)return;const own=s.packageLots.filter(l=>l.sourceId===e.id);if(own.some(l=>l.opened.length))throw Error('Упаковка уже вскрыта: отмена закупки недоступна');s.packageLots=s.packageLots.filter(l=>l.sourceId!==e.id);}
export function returnPackages(s:State,p:Product,source:Entry,original:Line,qty:number,returnSealed:boolean,split?:StockSplit){
 if(source.type==='purchase'&&original.packaging){const spec=original.packaging,lot=(s.packageLots||[]).find(l=>l.sourceId===source.id&&l.productId===p.id);const count=Math.round(qty*1000)/Math.round(spec.volume*1000);if(!Number.isInteger(count)||!lot||count>lot.sealed)throw Error('Поставщику можно вернуть только целые невскрытые упаковки из этой накладной');lot.sealed-=count;return;}
 if(source.type==='purchase'){consumePackages(s,p,qty,undefined,split);return;}
 if(!returnSealed)return; // Opened/loose client returns are never resealed.
 if(original.saleMode!=='sealed'||!original.packaging)throw Error('В исходном чеке нет запечатанной упаковки');const spec=original.packaging,count=Math.round(qty*1000)/Math.round(spec.volume*1000);
 if(!Number.isInteger(count))throw Error('Запечатанная упаковка возвращается целиком');
 s.packageLots??=[];
 for(const origin of stockOrigins){const amount=split?.[origin]??(origin==='unknown'?qty:0);if(!amount)continue;const part=Math.round(amount*1000)/Math.round(spec.volume*1000);if(!Number.isInteger(part))throw Error('Возвращайте целые упаковки из каждого источника');s.packageLots.push({id:crypto.randomUUID(),sourceId:source.id,productId:p.id,stockOrigin:origin,kind:spec.kind,volume:spec.volume,sealed:part,opened:[]})}
}
export function packageLabel(line:Pick<Line,'packaging'|'saleMode'>){const p=line.packaging;return p?(p.kind==='barrel'?'Бочка':'Канистра')+' '+p.volume+' л × '+p.count+' шт.':line.saleMode==='bulk'?'На разлив':'';}

// Restore sealed packages from their original lot; never reseal a bulk return.
export function restoreReturnPackages(s:State,p:Product,source:Entry,original:Line,qty:number,changes?:Entry['returnPackageChanges']){
 if(original.packaging){
  const pack=original.packaging,count=Math.round(qty*1000)/Math.round(pack.volume*1000);
  const lot=(s.packageLots||[]).find(l=>l.sourceId===source.id&&l.productId===p.id);
  if(!Number.isInteger(count)||count<=0||!lot||lot.kind!==pack.kind||lot.volume!==pack.volume||lot.sealed+count>pack.count)throw Error('Не удалось восстановить упаковки из исходной накладной');
  lot.sealed+=count;return;
 }
 const change=changes?.find(c=>c.productId===p.id);
 if(!changes&&(s.packageLots||[]).some(l=>l.productId===p.id))throw Error('В старом возврате нет сведений об упаковках. Нужна проверка перед отменой');
 if(!change)return;
 for(const prior of change.before){
  const index=(s.packageLots||[]).findIndex(l=>l.id===prior.id),expected=change.after.find(l=>l.id===prior.id);
  if(index<0||!expected||JSON.stringify(s.packageLots![index])!==JSON.stringify(expected))throw Error('После возврата упаковки этого товара изменились. Нужна проверка перед отменой');
  s.packageLots![index]=structuredClone(prior);
 }
}
