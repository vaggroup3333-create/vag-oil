import assert from 'node:assert/strict';
import {stripTypeScriptTypes} from 'node:module';
import {readFile} from 'node:fs/promises';
const source=stripTypeScriptTypes(await readFile(new URL('../lib/paid-invoice-search.ts',import.meta.url),'utf8'));
const {paidDraftSearchProducts,paidEntrySearchProducts,searchPaidInvoice}=await import('data:text/javascript;base64,'+Buffer.from(source).toString('base64'));
const products=[{id:'catalogue',name:'Масляный фильтр',code:'100010',article:'EX-123',barcode:'460001',qrCode:'QR-OIL'}];
const draft={rows:[{key:'new',product:{name:'Салонный фильтр',article:'F-97133-2E260',barcode:'460002',qrCode:'QR-CABIN'}},{key:'existing',productId:'catalogue'}]};
const posted={lines:[{id:'catalogue',name:'Прежнее название фильтра'}]};
const before=JSON.stringify({draft,posted,products});
const draftProducts=paidDraftSearchProducts(draft,products),postedProducts=paidEntrySearchProducts(posted,products);
assert.equal(searchPaidInvoice('F-97133-2E260',['Мои фильтры'],draftProducts).products[0].name,'Салонный фильтр');
assert.equal(searchPaidInvoice(' f‑97133‑2e260 ',[],draftProducts).matches,true);
for(const term of ['EX-123','100010','460001','qr-oil','Прежнее название'])assert.equal(searchPaidInvoice(term,[],postedProducts).matches,true,term);
for(const term of ['EX-123','100010','460001','QR-OIL','460002','QR-CABIN'])assert.equal(searchPaidInvoice(term,[],draftProducts).matches,true,term);
assert.equal(searchPaidInvoice('салонный F-97133-2E260',[],draftProducts).products.length,1);
assert.equal(searchPaidInvoice('салонный EX-123',[],draftProducts).matches,false);
assert.equal(searchPaidInvoice('Мои фильтры',['Мои фильтры'],draftProducts).matches,true);
assert.equal(searchPaidInvoice('000047',['000047'],postedProducts).matches,true);
assert.equal(searchPaidInvoice('80,00 с',['80,00 с'],postedProducts).matches,true);
assert.equal(searchPaidInvoice('not-present',[],draftProducts).matches,false);
assert.equal(searchPaidInvoice('F-97133-2E260',[],postedProducts).matches,false);
assert.equal(searchPaidInvoice('',[],[]).matches,true);
assert.equal(searchPaidInvoice('старый',[],paidEntrySearchProducts({lines:[{id:'gone',name:'Старый фильтр'}]},[])).matches,true);
assert.deepEqual(paidDraftSearchProducts({rows:[{key:'blank',product:{name:''}},{key:'gone',productId:'missing'}]},[]).map(p=>p.name),['Новый товар','Новый товар']);
assert.equal(JSON.stringify({draft,posted,products}),before);
console.log('PASS: new/existing draft articles, posted invoices, codes, QR, normalized search, row isolation, missing products and read-only behavior.');

// Execute the actual register predicate so the selected dates cannot hide search matches.
{
 const registerSource=await readFile(new URL('../components/paid-stock-invoices.tsx',import.meta.url),'utf8');
 const registerLines=registerSource.split(/\r?\n/);
 const predicateLines=[' const search=',' const searchAllMonths=',' const filtered='].map(prefix=>{const line=registerLines.find(line=>line.startsWith(prefix));assert(line,'Register predicate '+prefix);return line});
 const filter=new Function('records','query','status','from','to','searchPaidInvoice','money',stripTypeScriptTypes(predicateLines.join('\n'))+'\nreturn filtered');
 const rows=[
  {id:'old-draft',day:'2026-10-30',status:'draft',number:'',title:'Старый черновик',searchProducts:draftProducts},
  {id:'old-posted',day:'2025-01-15',status:'posted',number:'000047',title:'Старые остатки',searchProducts:postedProducts},
  {id:'current',day:'2026-11-10',status:'posted',number:'000155',title:'Текущие остатки',searchProducts:postedProducts,ownerDebt:true},
  {id:'cancelled',day:'2024-04-15',status:'cancelled',number:'000046',title:'Отмена',searchProducts:postedProducts}
 ].map(row=>({note:'',total:10,...row}));
 const before=JSON.stringify(rows);
 const select=(query,status='',from='2026-11-01',to='2026-11-22')=>filter(rows,query,status,from,to,searchPaidInvoice,n=>String(n)).map(row=>row.id);
 for(const term of ['EX-123','100010','460001','QR-OIL','масляный',' EX-123 '])assert.deepEqual(select(term),rows.map(r=>r.id),term+' across all months');
 assert.deepEqual(select('F-97133-2E260'),['old-draft'],'new draft product from an older month');
 assert.deepEqual(select('000047'),['old-posted'],'old posted document number');
 assert.deepEqual(select('EX-123','draft'),['old-draft']);
 assert.deepEqual(select('EX-123','posted'),['old-posted','current']);
 assert.deepEqual(select('EX-123','cancelled'),['cancelled']);
 for(const term of ['', '  '])assert.deepEqual(select(term),['current'],'empty search restores exact dates');
 assert.deepEqual(select('', '', '2026-10-30','2026-10-30'),['old-draft'],'inclusive day boundaries');
 assert.deepEqual(select('not-present'),[]);
 assert.equal(JSON.stringify(rows),before,'read-only filtering');
 console.log('PASS: initial-stock all-month search, new and catalogue draft products, posted/owner records, status and exact period restoration.');
}
