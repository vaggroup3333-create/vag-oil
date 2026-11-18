import assert from 'node:assert/strict';
import {stripTypeScriptTypes} from 'node:module';
import {readFile,writeFile,mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';

const dir=await mkdtemp(join(tmpdir(),'vag-opening-owner-debt-'));
try{
 for(const name of ['legacy-ledger','packaging','opening-stock','paid-stock','paid-stock-costs','paid-stock-draft','paid-stock-store','paid-stock-save-recovery','draft-stock','stock-advances','stock-sources','invoice-duplicates','ledger','reporting']){
  const source=await readFile(new URL('../lib/'+name+'.ts',import.meta.url),'utf8');
  await writeFile(join(dir,name+'.mjs'),stripTypeScriptTypes(source).replace(/from '\.\/([^']+)'/g,"from './$1.mjs'"));
 }
 const load=name=>import(pathToFileURL(join(dir,name+'.mjs')));
 const [L,D,F,R,store]=await Promise.all(['ledger','draft-stock','paid-stock-draft','reporting','paid-stock-store'].map(load));
 const now='2026-10-31T02:00:00Z',name='Мои товары — долг владельцу';
 const act=(s,a,context={})=>L.apply(s,a,{role:'director',now,...context});
 const draft=(s,id)=>s.paidStockDrafts.find(d=>d.id===id);
 const save=(s,id,patch={},base)=>{const d=draft(s,id);return act(s,{type:'paid_stock_draft_save',id,revision:d.revision,...F.paidDraftForm(d),...patch,...(base?{base}:{})});};
 const post=(s,id,patch={})=>act(s,{type:'paid_stock_draft_post',id,revision:draft(s,id)?.revision??0,...patch});
 function seed({withCreditor=true,unit='шт'}={}){
  let s=act(L.initial(false),{type:'product',name:'Тестовый товар',article:'OD-001',category:'Масло',unit,price:60});
  if(withCreditor)s=act(s,{type:'party',kind:'supplier',name});
  const id=crypto.randomUUID();
  s=act(s,{type:'paid_stock_draft_new',id});
  const row={key:crypto.randomUUID(),productId:s.products[0].id,unit,qty:'4',cost:'23.40'};
  return {s,id,row};
 }

 {
  let {s,id,row}=seed();
  const creditorId=s.parties.find(p=>p.name===name).id;
  const before=L.totals(s);
  s=save(s,id,{funding:'owner_debt',rows:[row],additionalExpense:'7.20',title:'Тестовая накладная'});
  assert.deepEqual(D.draftStock(s)[row.productId],{paid:0,credit:4,unknown:0});
  assert.deepEqual(L.totals(s),before);
  assert.throws(()=>post(s,id),/учёта оплаты/);
  assert.throws(()=>post(s,id,{funding:'paid'}),/учёта оплаты/);
  assert.throws(()=>post(s,id,{funding:'owner_debt'}),/с расходами/);
  const posting={type:'paid_stock_draft_post',id,revision:draft(s,id).revision,funding:'owner_debt',expenseReview:{amount:7.2,allocation:'quantity'}};
  s=act(s,posting);
  const e=s.entries.at(-1),t=L.totals(s);
  assert.equal(e.id,id);
  assert.equal(e.requestId,id);
  assert.equal(e.type,'purchase');
  assert.equal(e.openingOwnerDebt,true);
  assert.equal(e.partyId,creditorId);
  assert.equal(e.total,100.8);
  assert.equal(e.cost,100.8);
  assert.equal(e.paid,0);
  assert.equal(e.openingOwnerDebtExpense,7.2);
  assert.equal(e.expenses,undefined);
  assert.equal(e.lines[0].expense,undefined);
  assert.equal(L.debt(e),100.8);
  assert.equal(R.partyStatement(s,'purchase',e.partyId).currentDebt,100.8);
  assert.equal(t.supplierDebt-before.supplierDebt,100.8);
  assert.equal(t.stock-before.stock,100.8);
  assert.equal(t.profit,before.profit);
  assert.equal(t.cash,before.cash);
  assert.equal(s.products[0].qty,4);
  assert.equal(draft(s,id),undefined);
  assert.equal(s.payments.length,0);
  assert.deepEqual(s.stockSources.balances[row.productId],{paid:0,credit:4,unknown:0});
  assert.deepEqual(act(s,posting),s);
  assert.deepEqual(act(s,{type:'paid_stock_draft_new',id}),s);
  assert.throws(()=>act(s,{type:'unpost_purchase',id}),/обычный черновик/);
  const renamed=act(s,{type:'paid_stock_title',id,beforeTitle:e.title,title:'Долг за товар'});
  assert.equal(renamed.entries.at(-1).title,'Долг за товар');
  const paid=act(s,{type:'payment',target:id,amount:5,account:'cash'});
  assert.equal(R.partyStatement(paid,'purchase',e.partyId).currentDebt,95.8);
  assert.equal(L.balance(paid),-5);
  assert.throws(()=>act(paid,{type:'delete_purchase',id}),/выплаты владельцу/);
  const returned=act(s,{type:'return',target:id,account:'cash',lines:[{id:row.productId,qty:1}]});
  assert.equal(R.partyStatement(returned,'purchase',e.partyId).currentDebt,75.6);
  assert.equal(L.balance(returned),0);
  assert.equal(returned.products[0].qty,3);
  console.log('PASS owner expense, traceable supplier statement, repayment and one receipt per draft');
 }
 {
  let {s,id,row}=seed();
  assert.equal(F.paidDraftForm(draft(s,id)).funding,'paid');
  const old=F.paidDraftForm(draft(s,id));
  const {funding,...legacy}=old;
  s=save(s,id,{funding:'owner_debt',rows:[row]});
  const {funding:currentFunding,...savedLegacy}=F.paidDraftForm(draft(s,id));
  s=act(s,{type:'paid_stock_draft_save',id,revision:draft(s,id).revision,...savedLegacy,note:'Старый клиент'});
  assert.equal(draft(s,id).funding,'owner_debt');
  s=act(s,{type:'paid_stock_draft_save',id,revision:0,...legacy,title:'Слияние',base:legacy});
  assert.equal(draft(s,id).funding,'owner_debt');
  assert.equal(draft(s,id).rows.length,1);
  assert.equal(draft(s,id).title,'Слияние');
  assert.equal(draft(s,id).note,'Старый клиент');
  assert.throws(()=>act(s,{type:'paid_stock_draft_post',id,revision:0,funding:'paid'}),/другом окне/);
  console.log('PASS old saves preserve funding and stale posts do not change stock');
 }
 {
  let {s,id,row}=seed({withCreditor:false,unit:'л'});
  s=save(s,id,{rows:[{...row,packaging:{kind:'canister',volume:4,count:2,unitPrice:47}}],funding:'owner_debt'});
  s=post(s,id,{funding:'owner_debt'});
  assert.equal(s.parties.filter(p=>p.name===name).length,1);
  assert.equal(s.entries.at(-1).total,94);
  assert.equal(s.products[0].qty,8);
  assert.equal(s.packageLots.length,1);
  assert.equal(s.packageLots[0].stockOrigin,'credit');
  assert.equal(s.packageLots[0].sourceId,id);
  const deleted=act(s,{type:'delete_purchase',id});
  assert.equal(deleted.products[0].qty,0);
  assert.equal(L.totals(deleted).supplierDebt,0);
  assert.equal(deleted.packageLots.length,0);
  const restored=act(deleted,{type:'restore_purchase',id});
  assert.equal(restored.products[0].qty,8);
  assert.equal(L.totals(restored).supplierDebt,94);
  assert.equal(restored.packageLots.length,1);
  const creditor=restored.parties.find(p=>p.name===name);
  s=act(restored,{type:'party',id:creditor.id,kind:'supplier',name:'Владелец магазина'});
  const next=crypto.randomUUID();
  s=act(s,{type:'paid_stock_draft_new',id:next});
  s=save(s,next,{rows:[row],funding:'owner_debt'});
  s=post(s,next,{funding:'owner_debt'});
  assert.equal(s.entries.at(-1).partyId,creditor.id);
  assert.equal(s.parties.filter(p=>p.kind==='supplier'&&p.ownerDebt===true).length,1);
  assert.equal(s.parties.some(p=>p.name===name),false);
  console.log('PASS creditor creation and rename, packaged stock, safe delete and restore');
 }
 {
  let {s,id,row}=seed();
  s=act(s,{type:'party',kind:'supplier',name:'  Мои товары - долг владельцу  '});
  s=save(s,id,{funding:'owner_debt',rows:[row]});
  assert.throws(()=>post(s,id,{funding:'owner_debt'}),/несколько карточек/);
  assert.equal(s.entries.length,0);
  assert.equal(s.products[0].qty,0);
  console.log('PASS ambiguous creditor rejected without a receipt');
 }
 {
  let {s,id,row}=seed();
  s=save(s,id,{funding:'owner_debt',rows:[row]});
  s=act(s,{type:'sale',walkIn:true,allowDraftStock:true,lines:[{id:row.productId,qty:2,price:60,stockOrigin:'credit'}],paid:120,account:'cash'});
  assert.equal(s.products[0].qty,-2);
  assert.equal(D.pendingStockCount(s),1);
  assert.throws(()=>save(s,id,{funding:'paid'}),/прежний способ/);
  assert.throws(()=>save(s,id,{rows:[{...row,qty:'1'}]}),/необходимое для этих продаж/);
  assert.throws(()=>act(s,{type:'paid_stock_draft_delete',id,revision:draft(s,id).revision}),/необходимое для этих продаж/);
  s=post(s,id,{funding:'owner_debt'});
  assert.equal(s.products[0].qty,2);
  assert.equal(s.entries.filter(e=>e.type==='purchase').length,1);
  assert.equal(D.pendingStockCount(s),0);
  assert.equal(s.entries.find(e=>e.type==='sale').cost,46.8);
  assert.equal(L.totals(s).cash,120);
  console.log('PASS pre-receipt sale for the same source settles without a second receipt');
 }
 {
  let {s,id,row}=seed();
  const {funding,...legacy}=F.paidDraftForm(draft(s,id));
  s=act(s,{type:'paid_stock_draft_save',id,revision:0,...legacy,rows:[row]});
  s=post(s,id);
  assert.equal(s.entries.at(-1).type,'opening_stock');
  assert.equal(s.entries.at(-1).openingOwnerDebt,undefined);
  assert.equal(L.totals(s).supplierDebt,0);
  assert.equal(s.products[0].qty,4);
  assert.deepEqual(s.stockSources.balances[row.productId],{paid:4,credit:0,unknown:0});
  console.log('PASS legacy opening stock still posts as paid with no debt');
 }
 {
  let {s,id,row}=seed({withCreditor:false});
  s=save(s,id,{rows:[row],funding:'owner_debt'});
  const action={type:'paid_stock_draft_post',id,revision:draft(s,id).revision,funding:'owner_debt'};
  let raw=JSON.stringify(s),version=10;
  const db={prepare(sql){return {bind(...values){
   if(sql.startsWith('SELECT'))return {first:async()=>({data:raw,version})};
   return {run:async()=>{
    if(values[2]!==version)return {meta:{changes:0}};
    raw=values[0];version++;return {meta:{changes:1}};
   }};
  }}}};
  const results=await Promise.all([store.savePaidStockDraft(db,'test:live',action,'director'),store.savePaidStockDraft(db,'test:live',action,'director')]);
  assert.equal(version,11);
  assert.equal(results[0].version,11);
  assert.equal(results[1].version,11);
  const final=JSON.parse(raw);
  assert.equal(final.entries.filter(e=>e.id===id).length,1);
  assert.equal(final.products[0].qty,4);
  assert.equal(final.parties.filter(p=>p.name===name).length,1);
  console.log('PASS concurrent posting updates the ledger once');
 }
}finally{await rm(dir,{recursive:true,force:true});}
