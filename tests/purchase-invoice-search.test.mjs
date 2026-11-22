import assert from 'node:assert/strict';
import {stripTypeScriptTypes} from 'node:module';
import {readFile} from 'node:fs/promises';
const source=stripTypeScriptTypes(await readFile(new URL('../lib/paid-invoice-search.ts',import.meta.url),'utf8'));
const {searchPurchaseInvoice}=await import('data:text/javascript;base64,'+Buffer.from(source).toString('base64'));
const products=[{id:'filter',name:'Фильтр масляный новый',article:'F-97133-2E260',code:'100001',barcode:'460001',qrCode:'QR-FILTER'},{id:'oil',name:'Масло',article:'OIL-40',code:'100002'},{id:'unrelated',name:'Не в накладной',article:'ABSENT-99'}];
const draft={id:'draft',type:'purchase',status:'draft',number:'000071',title:'Поставка фильтров',party:'Поставщик А',note:'Для магазина',total:1234.5,lines:[{id:'filter',name:'Фильтр масляный прежний'},{id:'oil',name:'Масло'}]};
const posted={...draft,id:'posted',status:'posted',number:'000072',lines:[{id:'oil',name:'Масло'}]};
const before=JSON.stringify({products,draft,posted});
for(const status of ['draft','posted','cancelled']){
 const entry={...draft,status};
 for(const query of ['F-97133-2E260',' f‑97133‑2e260 ','100001','460001','qr-filter','масляный прежний','масляный новый']){
  const result=searchPurchaseInvoice(query,entry,products);
  assert.equal(result.matches,true,`${status}: ${query}`);
  assert.equal(result.products.length,1);
  assert.equal(result.products[0].article,'F-97133-2E260');
 }
}
assert.equal(searchPurchaseInvoice('F-97133-2E260',posted,products).matches,false,'No catalogue-wide false positives');
assert.equal(searchPurchaseInvoice('ABSENT-99',draft,products).matches,false);
assert.equal(searchPurchaseInvoice('масляный OIL-40',draft,products).matches,false,'Do not join two product rows');
assert.equal(searchPurchaseInvoice('Поставщик А F-97133-2E260',draft,products).products.length,1);
for(const query of ['000071','Поставка фильтров','Для магазина','Поставщик А','1234.5','1 234,5 TJS',''])assert.equal(searchPurchaseInvoice(query,draft,products).matches,true,query);
assert.equal(searchPurchaseInvoice('F-97133-2E260',{...draft,status:'deleted'},products).matches,false);
assert.equal(searchPurchaseInvoice('F-97133-2E260',{...draft,type:'sale'},products).matches,false);
assert.equal(searchPurchaseInvoice('Старый фильтр',{...draft,lines:[{id:'missing',name:'Старый фильтр'}]},products).matches,true);
assert.equal(searchPurchaseInvoice('F-97133-2E260',{...draft,lines:[]},products).matches,false);
assert.equal(JSON.stringify({products,draft,posted}),before);
console.log('PASS: supplier purchase draft/posted search, product identifiers, document metadata, row/document isolation, deleted/type guards and read-only behavior.');

const pageSource=await readFile(new URL('../app/page.tsx',import.meta.url),'utf8');
const pageLines=pageSource.split(/\r?\n/);
const scopeLine=pageLines.find(line=>line.startsWith(' const searchAllPurchaseMonths='));
const periodLine=pageLines.find(line=>line.startsWith(' const inRange='));
assert(scopeLine&&periodLine,'Use the same period predicate as the purchase page');
const periodFor=new Function('tab','query','from','to','fromClock','toClock',stripTypeScriptTypes(scopeLine+'\n'+periodLine)+'\nreturn inRange');
const november={from:'2026-11-01',to:'2026-11-22',fromClock:'08:30',toClock:'19:15'};
for(const query of ['100001','Фильтр','F-97133-2E260',' 100001 ']){
 const accepts=periodFor('Покупка',query,november.from,november.to,november.fromClock,november.toClock);
 for(const date of ['2025-01-01T09:00:00Z','2026-10-30T07:00:00Z','2026-11-22T18:00:00Z'])assert.equal(accepts(date),true,query+': all months and times');
}
for(const query of ['', '  ']){
 const accepts=periodFor('Покупка',query,november.from,november.to,november.fromClock,november.toClock);
 assert.equal(accepts('2026-10-30T07:00:00Z'),false);
 assert.equal(accepts('2026-11-01T03:29:00Z'),false);
 assert.equal(accepts('2026-11-01T03:30:00Z'),true);
 assert.equal(accepts('2026-11-22T14:15:00Z'),true);
 assert.equal(accepts('2026-11-22T14:16:00Z'),false);
}
assert.equal(periodFor('Продажи / касса','100001',november.from,november.to,'00:00','23:59')('2026-10-30T07:00:00Z'),false,'Searching other sections retains their selected period');
console.log('PASS: purchase search ignores month/time only for a non-empty query and restores the original period when cleared.');
