import {receiptAverage,advanceReceiptReason} from './stock-advances';
import type {State,Entry,ApplyContext,Product} from './ledger';
import {apply,posted,round} from './ledger';
import {packageSpec,receivePackages,removePurchasePackages,packageBalance} from './packaging';

const quantity=(v:number)=>Math.round(v*1000)/1000;
const movements=new Set(['purchase','sale','sale_return','purchase_return','purchase_return_reversal','inventory','writeoff','opening_stock']);
const normalizeName=(v:string)=>v.trim().toLocaleLowerCase('ru').replace(/ё/g,'е');
export function paidStockAdditionReason(s:State,id:string):string{
 const p=s.products.find(p=>p.id===id);
 if(!p)return 'Выберите существующий товар';
 if(!Number.isFinite(p.qty)||(p.qty<0&&p.stockValue===undefined)||!Number.isFinite(p.cost)||p.cost<0)return 'Сначала исправьте отрицательный остаток или себестоимость товара';
 if(p.stockValue===undefined&&packageBalance(s,p).looseLitres<-.001)return 'Остаток упаковок не совпадает с общим остатком. Нужна проверка';
 return '';
}
export function openingStockReason(s:State,id:string):string{
 const p=s.products.find(p=>p.id===id);
 if(!p)return 'Выберите товар';
 if(p.qty!==0)return 'У товара уже есть остаток. Повторный ввод начального остатка недоступен';
 if(s.entries.some(e=>movements.has(e.type)&&((posted(e)&&!e.cancelledAt)||(e.status==='deleted'&&e.deletedStatus==='posted'))&&e.lines.some(l=>l.id===id)))return 'По товару уже есть складские операции. Начальный остаток можно внести до начала продаж и закупок';
 if(s.packageLots?.some(l=>l.productId===id))return 'У товара уже есть учёт упаковок';
 return '';
}
export function cancelOpeningStockReason(s:State,id:string):string{
 const e=s.entries.find(e=>e.id===id&&e.type==='opening_stock');
 if(!e||!posted(e))return 'Документ начального остатка не найден';
 if(e.cancelledAt||e.reversalId)return 'Этот ввод уже отменён';
 const advanceReason=advanceReceiptReason(s,e.id);if(advanceReason)return advanceReason;
 const snapshots=e.openingStockSnapshots||(e.openingStockSnapshot?[e.openingStockSnapshot]:undefined);
 if(snapshots){
  if(snapshots.length!==e.lines.length||new Set(snapshots.map(x=>x.productId)).size!==snapshots.length)return 'Состав документа изменился. Нужна проверка';
  for(const snapshot of snapshots){
   const p=s.products.find(p=>p.id===snapshot.productId),line=e.lines.find(l=>l.id===snapshot.productId);
   if([snapshot.beforeQty,snapshot.beforeCost,snapshot.afterQty,snapshot.afterCost].some(v=>!Number.isFinite(v)||v<0))return 'Данные остатка до ввода недоступны. Нужна проверка';
   if(!line||!p||!Number.isFinite(p.qty)||!Number.isFinite(p.cost)||Math.abs(p.qty-snapshot.afterQty)>.000001||Math.abs(p.cost-snapshot.afterCost)>.000001)return 'После ввода остаток или себестоимость изменились. Отмена недоступна';
   if(s.entries.slice(s.entries.indexOf(e)+1).some(x=>posted(x)&&!x.cancelledAt&&movements.has(x.type)&&x.lines.some(l=>l.id===p.id)))return 'После добавления по товару были продажи или другие складские операции. Отмена недоступна';
   const own=(s.packageLots||[]).filter(l=>l.sourceId===e.id&&l.productId===p.id);
   if(line.packaging){const pack=line.packaging;if(own.length!==1||own[0].kind!==pack.kind||own[0].volume!==pack.volume||own[0].sealed!==pack.count||own[0].opened.length)return 'Добавленные упаковки уже изменились. Отмена недоступна';}
   else if(own.length)return 'Данные упаковок изменились. Нужна проверка';
  }
  return '';
 }
 for(const line of e.lines){
  const p=s.products.find(p=>p.id===line.id);
  if(!p||Math.abs(p.qty-line.qty)>.000001||Math.abs(p.cost-line.cost)>.000001)return 'Остаток или себестоимость уже изменились. Отмена ввода недоступна';
  if(s.entries.some(x=>x.id!==e.id&&posted(x)&&!x.cancelledAt&&movements.has(x.type)&&x.lines.some(l=>l.id===line.id)))return 'По товару уже были продажи или другие складские операции. Отмена ввода недоступна';
  if((s.packageLots||[]).some(l=>l.productId===line.id&&(l.sourceId!==e.id||l.opened.length)))return 'Упаковки уже изменились. Отмена ввода недоступна';
 }
 return '';
}
export function applyOpeningStock(raw:State,a:any,context:ApplyContext):State{
 if(context.role!=='director')throw Error('Начальные остатки может вводить и отменять только директор');
 let s=raw;
 const now=context.now||new Date().toISOString(),id=context.id||crypto.randomUUID();
 if(a.type==='cancel_opening_stock'){
  const reason=cancelOpeningStockReason(s,a.id);if(reason)throw Error(reason);
  const e=s.entries.find(e=>e.id===a.id)!;
  if(Number(a.amount)!==e.total)throw Error('Сумма документа изменилась. Обновите страницу');
  removePurchasePackages(s,e);
  for(const line of e.lines){const p=s.products.find(p=>p.id===line.id)!;const snapshot=e.openingStockSnapshots?.find(x=>x.productId===line.id)||e.openingStockSnapshot;p.qty=snapshot?.beforeQty??0;p.cost=snapshot?.beforeCost??0;}
  e.cancelledAt=now;e.cancelledBy=context.actor||'director';e.reversalId=id;
  s.entries.push({...e,id,number:context.number||String(s.entries.length+1).padStart(6,'0'),date:now,createdAt:now,type:'opening_stock_reversal',cancelledAt:undefined,cancelledBy:undefined,reversalId:undefined,requestId:undefined,reversalOf:e.id,target:e.id,note:'Отмена ввода начального остатка № '+e.number+' · Директор: '+(context.actor||'director')});
  return s;
 }
 if(typeof a.requestId!=='string'||!/^[a-f0-9-]{36}$/.test(a.requestId))throw Error('Откройте форму добавления товара заново');
 if(s.entries.some(e=>e.requestId===a.requestId))throw Error('Этот остаток уже сохранён. Обновите список, чтобы не внести его повторно');
 let productId=String(a.productId||'');
 const adding=a.type==='paid_stock_add';
 if(adding&&!productId)throw Error('Выберите существующий товар');
 if(!productId){
  const input=a.product;
  if(!input||!String(input.name||'').trim()||!['л','шт'].includes(input.unit))throw Error('Укажите название и единицу учёта товара');
  if(s.products.some(p=>normalizeName(p.name)===normalizeName(String(input.name))&&normalizeName(p.article||'')===normalizeName(String(input.article||''))&&p.unit===input.unit))throw Error('Такая карточка уже есть. Выберите «Товар уже есть в списке»');
  if(input.price===''||input.price===null||input.price===undefined||!Number.isFinite(Number(input.price))||Number(input.price)<0)throw Error('Укажите цену продажи за единицу');
  productId=crypto.randomUUID();
  s=apply(s,{type:'product',name:input.name,unit:input.unit,wholeOnly:input.unit==='шт',article:input.article||'',barcode:input.barcode||'',qrCode:input.qrCode||'',category:input.category||'Другое',price:input.price,wholesale:input.wholesale===''||input.wholesale===undefined?input.price:input.wholesale},{...context,id:productId,now});
 }
 const reason=adding?paidStockAdditionReason(s,productId):openingStockReason(s,productId);if(reason)throw Error(reason);
 const p=s.products.find(p=>p.id===productId)!;
 const pack=packageSpec(a.packaging,p);
 const qty=pack?quantity(pack.volume*pack.count):Number(a.qty);
 const cost=pack?pack.unitPrice/pack.volume:Number(a.cost);
 if(!Number.isFinite(qty)||qty<.001||qty>1e9||Math.abs(qty-quantity(qty))>1e-8||p.wholeOnly&&!Number.isInteger(qty))throw Error('Укажите положительное количество: штуки целиком, литры до 3 знаков');
 if(!Number.isFinite(cost)||cost<=0||cost>1e9)throw Error('Укажите закупочную стоимость товара');
 const line={id:p.id,name:p.name,kind:'product',unit:p.unit,qty,price:cost,cost,...(pack?{packaging:pack}: {})};
 const total=round(qty*cost);
 if(!Number.isFinite(total)||total>1e9)throw Error('Проверьте общую стоимость остатка');
 const beforeQty=p.qty,beforeCost=p.cost,afterQty=quantity(beforeQty+qty),afterCost=receiptAverage(p,qty,cost);
 if(afterQty>1e9||!Number.isFinite(afterCost))throw Error('Проверьте итоговое количество и стоимость товара');
 p.qty=afterQty;p.cost=afterCost;
 receivePackages(s,p,line,id);
 const entry:Entry={id,number:context.number||String(s.entries.length+1).padStart(6,'0'),type:'opening_stock',status:'posted',date:now,createdAt:now,party:'Товары, оплаченные до начала учёта',lines:[line],total,cost:total,paid:0,credit:0,discount:0,service:0,requestId:a.requestId,openingKind:adding?'addition':'initial',openingStockSnapshot:{productId,beforeQty,beforeCost,afterQty,afterCost},note:(adding?'Добавление своего оплаченного остатка':'Начальный остаток')+' · введён директором '+(context.actor||'director')};
 s.entries.push(entry);return s;
}
