import assert from 'node:assert/strict';
import {stripTypeScriptTypes} from 'node:module';
import {readFile,writeFile,mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';import {join} from 'node:path';import {pathToFileURL} from 'node:url';
const dir=await mkdtemp(join(tmpdir(),'vag-draft-sales-'));let passed=0;
try{
 for(const name of ['legacy-ledger','packaging','opening-stock','paid-stock','paid-stock-costs','paid-stock-draft','draft-stock','stock-advances','stock-sources','invoice-duplicates','ledger','reporting','cashier-protocol'])await writeFile(join(dir,name+'.mjs'),stripTypeScriptTypes(await readFile(new URL('../lib/'+name+'.ts',import.meta.url),'utf8')).replace(/from '\.\/([^']+)'/g,"from './$1.mjs'"));
 const L=await import(pathToFileURL(join(dir,'ledger.mjs'))),D=await import(pathToFileURL(join(dir,'draft-stock.mjs'))),C=await import(pathToFileURL(join(dir,'cashier-protocol.mjs'))),R=await import(pathToFileURL(join(dir,'reporting.mjs')));
 const now='2026-10-31T02:00:00Z',act=(s,a,more={})=>L.apply(s,a,{role:'director',now,...more});
 function seed(unit='шт'){let s=act(L.initial(false),{type:'product',name:'Фильтр',article:'AAA',category:'Фильтры',unit,price:30,wholesale:25});s=act(s,{type:'party',kind:'supplier',name:'Поставщик'});return s}
 function receipt(s,qty=10,price=12,paid=0){return act(s,{type:'purchase',partyId:s.parties.find(x=>x.kind==='supplier').id,lines:[{id:s.products[0].id,qty,price}],paid,account:'cash'})}
 function draft(s,qty=10,price=12,paid=0){s=act(s,{type:'draft_new',partyId:s.parties.find(x=>x.kind==='supplier').id});return act(s,{type:'draft_save',id:s.entries.at(-1).id,lines:[{id:s.products[0].id,qty,price}],paid,account:'cash'})}
 function post(s,id=s.entries.find(x=>x.type==='purchase'&&x.status==='draft').id){const e=s.entries.find(x=>x.id===id);return act(s,{type:'draft_post',id,lines:e.lines,paid:e.draftPaid||0,account:'cash'})}
 const sell=(s,n,origin='credit',more={})=>act(s,{type:'sale',walkIn:true,allowDraftStock:true,lines:[{id:s.products[0].id,qty:n,price:30,stockOrigin:origin}],paid:n*30,account:'cash',...more});
 const near=(a,b)=>assert.ok(Math.abs(a-b)<.00001,`${a} != ${b}`);
 const check=(name,fn)=>{fn();passed++;console.log('PASS '+name)};
 check('draft-only quantity, explicit confirmation, negative then receipt and actual profit',()=>{
  let s=draft(seed());assert.equal(D.saleStockQty(s,s.products[0].id),10);
  assert.throws(()=>sell(s,2,'credit',{allowDraftStock:false}),/Недостаточно/);
  s=sell(s,2);assert.equal(s.products[0].qty,-2);assert.equal(s.entries.at(-1).costPending,true);assert.equal(L.totals(s).cash,60);
  assert.throws(()=>sell(s,9),/Недостаточно/);
  s=post(s);assert.equal(s.products[0].qty,8);near(s.products[0].cost,12);assert.equal(L.totals(s).stock,96);assert.equal(L.totals(s).profit,36);assert.equal(L.totals(s).supplierDebt,120);assert.equal(D.pendingStockCount(s),0);assert.equal(s.entries.find(x=>x.type==='sale').cost,24);
  near(R.balanceAt(s,'').capital,36);assert.throws(()=>act(s,{type:'unpost_purchase',id:s.entries.find(x=>x.type==='purchase').id}),/закрыл продажи/);
 });
 check('no draft does not enable unbounded negative sales',()=>assert.throws(()=>sell(seed(),1),/Недостаточно/));
 check('partial receipts adjust cost cumulatively and avoid division by zero',()=>{
  let s=sell(draft(seed(),10),4);s=receipt(s,2,11);assert.equal(s.products[0].qty,-2);assert.equal(s.entries.find(x=>x.type==='sale').cost,22);s=receipt(s,2,15);assert.equal(s.products[0].qty,0);assert.equal(s.products[0].stockValue,0);assert.equal(s.entries.find(x=>x.type==='sale').cost,52);near(L.totals(s).profit,68);assert.ok(Number.isFinite(s.products[0].cost));
 });
 check('positive paid and negative credit remain separate at zero net quantity',()=>{
  let s=receipt(seed(),2,10,20);s=draft(s,2,12);s=sell(s,2,'credit');assert.equal(s.products[0].qty,0);assert.equal(s.stockSources.balances[s.products[0].id].paid,2);assert.equal(s.stockSources.balances[s.products[0].id].credit,-2);near(s.products[0].stockValue,0);
  s=receipt(s,1,2,2);near(s.products[0].cost,22/3);near(s.products[0].stockValue,2);s=post(s);near(s.products[0].qty,3);near(s.products[0].stockValue,22);near(s.products[0].cost,22/3);near(L.totals(s).profit,36);
 });
 check('physical stock consumed at existing average; only shortage repriced',()=>{
  let s=receipt(seed(),3,10);s=draft(s,10,12);s=sell(s,5);s=post(s);assert.equal(s.products[0].qty,8);assert.equal(s.entries.find(x=>x.type==='sale').cost,54);near(s.products[0].cost,12);near(L.totals(s).profit,96);
 });
 check('customer return waits for receipt then returns correct cost and money',()=>{
  let s=sell(draft(seed()),2),sale=s.entries.at(-1).id;const ret={type:'return',target:sale,lines:[{id:s.products[0].id,qty:1,stockOrigin:'credit'}],account:'cash'};assert.throws(()=>act(s,ret),/Сначала проведите/);s=post(s);s=act(s,ret);assert.equal(s.products[0].qty,9);assert.equal(s.entries.at(-1).cost,12);assert.equal(L.totals(s).profit,18);assert.equal(L.totals(s).cash,30);
 });
 check('paid initial-stock draft settles paid shortage including allocated expense',()=>{
  let s=seed(),id=crypto.randomUUID();s=act(s,{type:'paid_stock_draft_new',id});s=act(s,{type:'paid_stock_draft_save',id,revision:0,title:'Мои товары',date:'2026-10-31',rows:[{key:crypto.randomUUID(),productId:s.products[0].id,unit:'шт',qty:'10',cost:'12'}],additionalExpense:'20',expenseAllocation:'quantity'});s=sell(s,2,'paid');s=act(s,{type:'paid_stock_draft_post',id,revision:1,expenseReview:{amount:20,allocation:'quantity'}});assert.equal(s.products[0].qty,8);near(s.products[0].cost,14);assert.equal(L.totals(s).stock,112);assert.equal(L.totals(s).profit,32);assert.equal(L.totals(s).supplierDebt,0);assert.equal(L.totals(s).cash,60);
 });
 check('bulk litres consume incoming containers without creating imaginary sealed packs',()=>{
  let s=draft(seed('л'),10,12);s=sell(s,.5);const id=s.entries.find(x=>x.type==='purchase').id;s=act(s,{type:'draft_post',id,lines:[{id:s.products[0].id,qty:10,price:12,packaging:{kind:'canister',volume:5,count:2,unitPrice:60}}],paid:0,account:'cash'});assert.equal(s.products[0].qty,9.5);assert.equal(s.packageLots[0].sealed,1);assert.deepEqual(s.packageLots[0].opened,[4.5]);near(L.totals(s).profit,9);
 });
 check('cashier projection retains limits and pending quantities, never costs',()=>{
  let s=receipt(seed(),1,17);s=sell(s,1);s=draft(s,10,12);s=sell(s,2);const projected=C.cashierProjection(s);assert.equal(projected.products[0].cost,0);assert.equal(projected.products[0].stockValue,0);assert.equal(projected.stockAdvances[0].estimate,0);assert.equal(D.saleStockQty(projected,s.products[0].id),8);const next=C.enqueueCashier({base:projected,version:1,pending:[],lastSync:now},{type:'sale',walkIn:true,allowDraftStock:true,lines:[{id:s.products[0].id,qty:1,price:30,stockOrigin:'credit'}],paid:30,account:'cash'},now);assert.equal(C.localCashierState(next).products[0].qty,-3);assert.equal(next.pending[0].action.allowDraftStock,true);
 });
 check('inventory cannot erase an unreceived sale',()=>{const s=sell(draft(seed()),2);assert.throws(()=>act(s,{type:'inventory',lines:[{id:s.products[0].id,qty:0}]}),/Сначала проведите приход/)});
 check('supplier returns and their cancellation preserve advanced valuation',()=>{
  let s=post(sell(draft(seed()),2)),purchase=s.entries.find(x=>x.type==='purchase').id;
  s=act(s,{type:'return',target:purchase,lines:[{id:s.products[0].id,qty:2}],account:'cash'});
  near(s.products[0].stockValue,72);near(s.products[0].qty,6);near(L.totals(s).supplierDebt,96);near(L.totals(s).profit,36);
  const e=s.entries.at(-1);s=act(s,{type:'cancel_supplier_return',id:e.id,amount:e.total});near(s.products[0].stockValue,96);near(s.products[0].qty,8);near(L.totals(s).supplierDebt,120);
 });
 check('fully paid purchase draft remains paid and creates no supplier debt',()=>{
  let s=draft(seed(),10,12,120);s=sell(s,2,'paid');s=post(s);assert.equal(s.stockSources.balances[s.products[0].id].paid,8);assert.equal(L.totals(s).supplierDebt,0);assert.equal(L.totals(s).cash,-60);assert.equal(L.totals(s).profit,36);
 });
 check('source change at posting is explicit and never silently reclassifies shortages',()=>{
  const s=sell(draft(seed()),2),e=s.entries.find(x=>x.type==='purchase'),before=JSON.stringify(s);
  assert.throws(()=>act(s,{type:'draft_post',id:e.id,lines:e.lines,paid:120,account:'cash'}),/тем же источником/);assert.equal(JSON.stringify(s),before);
 });
 check('whole sealed packages cannot be invented before receipt',()=>{
  const s=draft(seed('л'),10),p=s.products[0];assert.throws(()=>sell(s,5,'credit',{lines:[{id:p.id,qty:5,price:30,stockOrigin:'credit',saleMode:'sealed',packaging:{kind:'canister',volume:5,count:1,unitPrice:150}}]}),/целой канистры/);
 });
 check('draft changes constrain the next sale; rejected operation leaves all data intact',()=>{
  let s=sell(draft(seed(),10),2),d=s.entries.find(x=>x.type==='purchase');s=act(s,{type:'draft_save',id:d.id,lines:[{id:s.products[0].id,qty:3,price:12}],paid:0});const before=JSON.stringify(s);assert.throws(()=>sell(s,2),/Недостаточно/);assert.equal(JSON.stringify(s),before);s=sell(s,1);assert.equal(s.products[0].qty,-3);
 });
 check('multiple prices and fractional receipts reconcile profit, stock and capital',()=>{
  for(let i=1;i<=30;i++){
   let s=draft(seed('л'),10),qty=Math.round((.1+i*.071)*1000)/1000;
   s=sell(s,qty);const q1=Math.round(qty*.4*1000)/1000,q2=Math.round((qty-q1)*1000)/1000;
   s=receipt(s,q1,10+i*.1);s=receipt(s,q2+2,12+i*.2);
   const cost=Math.round((q1*(10+i*.1)+q2*(12+i*.2))*100)/100;
   assert.equal(s.products[0].qty,2);near(L.totals(s).stock,Math.round(2*(12+i*.2)*100)/100);near(L.totals(s).cost,cost);assert.equal(D.pendingStockCount(s),0);
   // Two receipt totals and the sale cost are rounded independently to cents.
   assert.ok(Math.abs(R.balanceAt(s,'').capital-L.totals(s).profit)<=.020001);
  }
 });
 console.log(JSON.stringify({passed}));
}finally{await rm(dir,{recursive:true,force:true})}
