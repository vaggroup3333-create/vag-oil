import type {Entry,PaidStockDraft,Product} from './ledger';

export type InvoiceSearchProduct={name:string;article?:string;barcode?:string;qrCode?:string;code?:string;currentName?:string};
const normalize=(value:string)=>value.normalize('NFKC').toLocaleLowerCase('ru').replace(/ё/g,'е').replace(/[‐‑‒–—−]/g,'-').replace(/\s+/g,' ').trim();

export function paidDraftSearchProducts(draft:PaidStockDraft,products:Product[]):InvoiceSearchProduct[]{
 const byId=new Map(products.map(p=>[p.id,p]));
 return draft.rows.map(row=>{
  const product=row.productId?byId.get(row.productId):row.product;
  return {name:product?.name||'Новый товар',article:product?.article,barcode:product?.barcode,qrCode:product?.qrCode,code:row.productId?byId.get(row.productId)?.code:undefined};
 });
}

export function paidEntrySearchProducts(entry:Entry,products:Product[]):InvoiceSearchProduct[]{
 const byId=new Map(products.map(p=>[p.id,p]));
 return entry.lines.map(line=>{
  const product=byId.get(line.id);
  return {name:line.name||product?.name||'Товар',currentName:product?.name,article:product?.article,barcode:product?.barcode,qrCode:product?.qrCode,code:product?.code};
 });
}

// A product's identifiers stay tied to its own document and row.
export function searchPaidInvoice(query:string,metadata:string[],products:InvoiceSearchProduct[]){
 const tokens=normalize(query).split(' ').filter(Boolean),documentText=normalize(metadata.join(' '));
 if(!tokens.length)return {matches:true,products:[] as InvoiceSearchProduct[]};
 const found=products.filter(product=>{
  const text=normalize([product.name,product.currentName,product.article,product.barcode,product.qrCode,product.code].filter(Boolean).join(' '));
  return tokens.some(token=>text.includes(token))&&tokens.every(token=>text.includes(token)||documentText.includes(token));
 });
 return {matches:tokens.every(token=>documentText.includes(token))||found.length>0,products:found};
}
