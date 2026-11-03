import type {Product} from './ledger';

type Identity=Pick<Product,'name'|'article'|'barcode'|'qrCode'|'unit'>;
type InvoiceRow={productId?:string;product?:Partial<Identity>};
const text=(value:unknown)=>String(value??'').trim().replace(/\s+/g,' ').toLocaleLowerCase('ru').replace(/ё/g,'е');
export function invoiceDuplicate(rows:InvoiceRow[],products:Product[]):{first:number;second:number;message:string}|null{
 const catalog=new Map(products.map(p=>[p.id,p])),seen=new Map<string,number>();
 for(let index=0;index<rows.length;index++){
  const row=rows[index],p=row.productId?catalog.get(row.productId):row.product;
  const keys=new Set<string>();
  if(row.productId)keys.add('id:'+row.productId);
  if(p){
   const article=text(p.article),codes=[p.barcode,p.qrCode].map(value=>String(value??'').trim()).filter(Boolean),name=text(p.name);
   if(article)keys.add('article:'+article);
   for(const code of codes)keys.add('code:'+code);
   // Unfinished blank rows are allowed. A name alone is used only when neither
   // row has an identifying code/article, so different product variants remain valid.
   if(name&&!article&&!codes.length)keys.add('name:'+JSON.stringify([name,p.unit||'шт']));
  }
  for(const key of keys){const first=seen.get(key);if(first!==undefined)return {first,second:index,message:'Одинаковый товар в строках '+(first+1)+' и '+(index+1)+'. Измените количество в одной строке и удалите повтор. Сохранение и проведение с повтором заблокированы.'};}
  for(const key of keys)seen.set(key,index);
 }
 return null;
}
