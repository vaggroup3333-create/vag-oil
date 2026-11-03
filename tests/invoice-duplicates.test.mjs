import assert from 'node:assert/strict';
import {stripTypeScriptTypes} from 'node:module';
import {readFile,writeFile,mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';
const dir=await mkdtemp(join(tmpdir(),'vag-invoice-duplicates-'));let passed=0;
try{
 for(const name of ['legacy-ledger','packaging','opening-stock','paid-stock','paid-stock-costs','paid-stock-draft','draft-stock','stock-advances','stock-sources','invoice-duplicates','ledger'])await writeFile(join(dir,name+'.mjs'),stripTypeScriptTypes(await readFile(new URL('../lib/'+name+'.ts',import.meta.url),'utf8')).replace(/from '\.\/([^']+)'/g,"from './$1.mjs'"));
 const L=await import(pathToFileURL(join(dir,'ledger.mjs'))),D=await import(pathToFileURL(join(dir,'invoice-duplicates.mjs')));
 const ctx={role:'director',now:'2026-10-30T10:00:00Z'},act=(s,a)=>L.apply(s,a,ctx);
 const newRow=(overrides={})=>({key:crypto.randomUUID(),qty:'2',cost:'10',product:{name:'Масляный фильтр',article:'SB123',barcode:'',qrCode:'',unit:'шт',category:'Фильтры',price:'20',wholesale:'20',...overrides}});
 function seed(){let s=L.initial(false);s=L.apply(s,{type:'product',name:'Масляный фильтр',article:'SB123',barcode:'460001',qrCode:'FILTER-QR',unit:'шт',category:'Фильтры',price:20},{id:'p'});s=L.apply(s,{type:'party',name:'Supplier',kind:'supplier'},{id:'supplier'});const id=crypto.randomUUID();s=act(s,{type:'paid_stock_draft_new',id});s=act(s,{type:'paid_stock_draft_save',id,revision:0,title:'Saved invoice',date:'2026-10-30',rows:[newRow({article:'SAFE'})]});return {s,id}}
 const check=(name,fn)=>{fn();passed++;console.log('PASS '+name)};
 function rejects(name,rows){check(name,()=>{const {s,id}=seed(),before=JSON.stringify(s);assert.throws(()=>act(s,{type:'paid_stock_draft_save',id,revision:1,title:'Should not save',date:'2026-10-30',rows,additionalExpense:'15'}),/Одинаковый товар в строках 1 и 2/);assert.equal(JSON.stringify(s),before);assert.equal(s.paidStockDrafts[0].revision,1);assert.equal(s.products[0].qty,0)})}
 rejects('same existing product cannot save twice',[{key:crypto.randomUUID(),productId:'p',unit:'шт',qty:'1',cost:'10'},{key:crypto.randomUUID(),productId:'p',unit:'шт',qty:'3',cost:'20'}]);
 rejects('two new identical article rows cannot save',[newRow(),newRow({article:'  sb123  ',name:'Another name'})]);
 rejects('two identical names without identifiers cannot save',[newRow({article:'',name:'  Масляный  фильтр '}),newRow({article:'',name:'масляный фильтр'})]);
 rejects('same barcode across two new cards cannot save',[newRow({article:'A',barcode:'460123'}),newRow({article:'B',barcode:'460123'})]);
 rejects('same QR across two new cards cannot save',[newRow({article:'A',qrCode:'QR-MDJ055'}),newRow({article:'B',qrCode:'QR-MDJ055'})]);
 rejects('barcode colliding with QR cannot save',[newRow({article:'A',barcode:'SAME'}),newRow({article:'B',qrCode:'SAME'})]);
 rejects('new row matching existing selected product article cannot save',[{key:crypto.randomUUID(),productId:'p',qty:'1',cost:'10'},newRow()]);
 rejects('new row matching selected product QR cannot save',[{key:crypto.randomUUID(),productId:'p',qty:'1',cost:'10'},newRow({article:'DIFFERENT',qrCode:'FILTER-QR'})]);
 check('blank unfinished rows can autosave',()=>{const {s,id}=seed();const next=act(s,{type:'paid_stock_draft_save',id,revision:1,date:'2026-10-30',rows:[newRow({name:'',article:''}),newRow({name:'',article:''})]});assert.equal(next.paidStockDrafts[0].rows.length,2)});
 check('same name with different articles remains valid',()=>{const {s,id}=seed();const next=act(s,{type:'paid_stock_draft_save',id,revision:1,date:'2026-10-30',rows:[newRow({article:'A'}),newRow({article:'B'})]});assert.equal(next.paidStockDrafts[0].rows.length,2)});
 check('QR is case sensitive and barcode can equal QR on one row',()=>{assert.equal(D.invoiceDuplicate([newRow({article:'A',barcode:'CodeA',qrCode:'CodeA'}),newRow({article:'B',qrCode:'codea'})],[]),null)});
 check('fixing duplicate allows save and subsequent atomic posting',()=>{const {s,id}=seed();const rows=[newRow({article:'A'}),newRow({article:'B'})];const saved=act(s,{type:'paid_stock_draft_save',id,revision:1,date:'2026-10-30',rows});const posted=act(saved,{type:'paid_stock_draft_post',id,revision:2});assert.equal(posted.entries.length,1);assert.equal(posted.entries[0].lines.length,2);assert.equal(posted.paidStockDrafts.length,0);assert.equal(L.balance(posted),0)});
 check('legacy saved duplicate cannot bypass posting guard',()=>{const {s,id}=seed();s.paidStockDrafts[0].rows=[newRow(),newRow()];const before=JSON.stringify(s);assert.throws(()=>act(s,{type:'paid_stock_draft_post',id,revision:1}),/Одинаковый товар/);assert.equal(JSON.stringify(s),before)});
 for(const role of ['director','administrator'])check(role+' purchase draft rejects repeated product without changing prior data',()=>{
  let {s}=seed();s=L.apply(s,{type:'draft_new',partyId:'supplier'},{...ctx,role,id:'purchase'});s=L.apply(s,{type:'draft_save',id:'purchase',partyId:'supplier',paid:0,lines:[{id:'p',qty:1,price:10}]},{...ctx,role});const before=JSON.stringify(s);
  assert.throws(()=>L.apply(s,{type:'draft_save',id:'purchase',partyId:'supplier',paid:0,lines:[{id:'p',qty:1,price:10},{id:'p',qty:2,price:11}]},{...ctx,role}),/Одинаковый товар/);assert.equal(JSON.stringify(s),before);
 });
 check('same product in separate invoices is allowed',()=>{const {s}=seed();let next=act(s,{type:'purchase',partyId:'supplier',paid:0,lines:[{id:'p',qty:1,price:10}]});next=act(next,{type:'purchase',partyId:'supplier',paid:0,lines:[{id:'p',qty:2,price:12}]});assert.equal(next.products[0].qty,3);assert.equal(L.totals(next).supplierDebt,34)});
 console.log(JSON.stringify({passed}));
}finally{await rm(dir,{recursive:true,force:true})}
