import assert from 'node:assert/strict';
import {stripTypeScriptTypes} from 'node:module';
import {readFile,writeFile,mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';
const dir=await mkdtemp(join(tmpdir(),'vag-system-audit-'));let checks=0,failures=0;
try{
 for(const name of ['legacy-ledger','packaging','opening-stock','paid-stock','paid-stock-costs','paid-stock-draft','draft-stock','stock-advances','stock-sources','invoice-duplicates','ledger','reporting','cashier-protocol']){
  await writeFile(join(dir,name+'.mjs'),stripTypeScriptTypes((await readFile(new URL('../lib/'+name+'.ts',import.meta.url),'utf8')).replace('State,Entry,initial,normalize,apply,ApplyContext,round','initial,normalize,apply,round')).replace(/from '\.\/([^']+)'/g,"from './$1.mjs'"));
 }
 const L=await import(pathToFileURL(join(dir,'ledger.mjs'))),C=await import(pathToFileURL(join(dir,'cashier-protocol.mjs'))),S=await import(pathToFileURL(join(dir,'stock-sources.mjs'))),E=await import(pathToFileURL(join(dir,'paid-stock-costs.mjs')));
 const act=(s,a,id)=>L.apply(s,a,{role:'director',actor:'test',now:'2026-10-30T09:00:00Z',...(id?{id}:{})});
 function setup(){let s=L.initial(false);s=act(s,{type:'product',name:'Test',article:'T1',category:'Parts',unit:'шт',price:30},'p');s=act(s,{type:'party',name:'Supplier',kind:'supplier'},'supplier');s=act(s,{type:'party',name:'Client',kind:'client'},'client');return s}
 const buy=(s,qty=10,price=10)=>act(s,{type:'purchase',partyId:'supplier',lines:[{id:'p',qty,price}],paid:0,account:'cash'});
 const sale=(qty=1,stockOrigin='credit')=>({type:'sale',walkIn:true,lines:[{id:'p',qty,price:30,stockOrigin}],paid:qty*30,received:qty*30,account:'cash'});
 function check(name,fn){try{fn();checks++;console.log('PASS '+name)}catch(e){failures++;console.error('FAIL '+name+': '+e.stack)}}
 function invariant(s){for(const p of s.products)assert.equal(S.splitTotal(S.stockBalance(s,p.id)),p.qty)}
 function draft(s,rows,expense='0'){
  const id=crypto.randomUUID();s=act(s,{type:'paid_stock_draft_new',id});
  s=act(s,{type:'paid_stock_draft_save',id,revision:0,rows,title:'Test paid invoice',date:'2026-10-30',additionalExpense:expense,expenseAllocation:'quantity'});
  return {s,id,post:{type:'paid_stock_draft_post',id,revision:1,expenseReview:{amount:Number(expense),allocation:'quantity'}}};
 }
 const row=(id,qty,cost)=>({key:crypto.randomUUID(),productId:id,unit:'шт',qty:String(qty),cost:String(cost)});
 check('paid and credit stock selected separately; repayment preserves origin',()=>{
  let s=buy(setup());const purchase=s.entries.at(-1).id;s=act(s,{type:'paid_stock_add',productId:'p',qty:5,cost:20,requestId:crypto.randomUUID()});
  assert.deepEqual(S.stockBalance(s,'p'),{paid:5,credit:10,unknown:0});assert.throws(()=>act(s,{...sale(),lines:[{id:'p',qty:1,price:30}]}),/Выберите остаток/);
  s=act(s,sale(2,'paid'));assert.equal(S.stockBalance(s,'p').paid,3);
  const origin=structuredClone(s.stockSources);s=act(s,{type:'payment',target:purchase,amount:100,account:'cash'});assert.deepEqual(s.stockSources,origin);invariant(s);
 });
 check('split sale and partial returns restore exact origins',()=>{
  let s=buy(setup());s=act(s,{type:'paid_stock_add',productId:'p',qty:3,cost:10,requestId:crypto.randomUUID()});
  s=act(s,{...sale(4),lines:[{id:'p',qty:4,price:30,stockOrigin:'split',stockSplit:{paid:2,credit:2,unknown:0}}]});const id=s.entries.at(-1).id;
  s=act(s,{type:'return',target:id,lines:[{id:'p',qty:1,stockOrigin:'paid'}],account:'cash'});assert.equal(S.stockBalance(s,'p').paid,2);
  s=act(s,{type:'return',target:id,lines:[{id:'p',qty:3,stockOrigin:'split',stockSplit:{paid:1,credit:2,unknown:0}}],account:'cash'});
  assert.deepEqual(S.stockBalance(s,'p'),{paid:3,credit:10,unknown:0});assert.equal(L.totals(s).profit,0);invariant(s);
 });
 check('paid invoice expenses, weighted cost, replay and cancellation are atomic',()=>{
  let s=buy(setup());const d=draft(s,[row('p',3,20)],'10');const before=structuredClone(d.s);
  assert.throws(()=>act(d.s,{...d.post,expenseReview:undefined}),/подтвердите/);assert.deepEqual(d.s,before);
  s=act(d.s,d.post);assert.equal(s.products[0].qty,13);assert.equal(s.products[0].cost,170/13);assert.equal(s.entries.at(-1).total,70);
  assert.equal(L.balance(s),0);assert.equal(L.totals(s).supplierDebt,100);assert.equal(L.totals(s).profit,0);invariant(s);
  assert.deepEqual(act(s,d.post),s);s=act(s,{type:'cancel_opening_stock',id:d.id,amount:70});assert.equal(s.products[0].cost,10);assert.equal(s.products[0].qty,10);invariant(s);
 });
 check('expense cents distribute exactly across 300 rows and fractional litres',()=>{
  for(let count=1;count<=300;count++){
   const rows=Array.from({length:count},(_,i)=>row('p'+i,(i+1)/1000,(i+3)/100));
   for(const amount of [.01,.02,1,10000.01]){const p=E.paidStockExpensePlan(rows,amount,'quantity');assert.equal(L.round(p.lines.reduce((n,l)=>n+l.expenseAmount,0)),amount);assert.equal(p.total,L.round(p.base+amount))}
  }
 });
 check('duplicate article rejects entire invoice without creating partial goods',()=>{
  const product={name:'Another',article:' t1 ',barcode:'',qrCode:'',category:'Parts',unit:'шт',price:'30',wholesale:'30'};
  const d=draft(setup(),[{key:crypto.randomUUID(),product,qty:'2',cost:'10'}]);const before=structuredClone(d.s);assert.throws(()=>act(d.s,d.post),/Артикул/);assert.deepEqual(d.s,before);
 });
 check('old browser save preserves freight and stale revision is rejected',()=>{
  const d=draft(setup(),[row('p',2,10)],'7.25');const s=act(d.s,{type:'paid_stock_draft_save',id:d.id,revision:1,rows:d.s.paidStockDrafts[0].rows,date:'2026-10-30',title:'Changed'});
  assert.equal(s.paidStockDrafts[0].additionalExpense,'7.25');assert.throws(()=>act(s,d.post),/другом окне/);
 });
 check('300 new products post once with expenses and reverse together',()=>{
  const rows=Array.from({length:300},(_,i)=>({key:crypto.randomUUID(),qty:String(i%5+1),cost:'10',product:{name:'Test '+i,article:'B'+i,category:'Parts',unit:'шт',price:'20'}}));
  const d=draft(L.initial(false),rows,'17.29');const posted=act(d.s,d.post),amount=rows.reduce((n,r)=>n+Number(r.qty)*10,0)+17.29;
  assert.equal(posted.products.length,300);assert.equal(posted.entries.length,1);assert.equal(posted.entries[0].lines.length,300);assert.equal(posted.entries[0].total,amount);assert.equal(L.totals(posted).stock,amount);assert.equal(L.balance(posted),0);invariant(posted);
  assert.deepEqual(act(posted,d.post),posted);const cancelled=act(posted,{type:'cancel_opening_stock',id:d.id,amount});assert.ok(cancelled.products.every(p=>p.qty===0));assert.equal(L.totals(cancelled).stock,0);invariant(cancelled);
 });
 check('packaged oil expense is allocated per litre and cancellation restores packages',()=>{
  let s=act(L.initial(false),{type:'product',name:'Oil',article:'O1',category:'Oil',unit:'л',price:30},'oil');
  const d=draft(s,[{...row('oil',10,10),unit:'л',packaging:{kind:'canister',volume:5,count:2,unitPrice:50}}],'3.33');
  s=act(d.s,d.post);assert.equal(s.products[0].qty,10);assert.equal(s.entries[0].total,103.33);assert.equal(s.packageLots[0].sealed,2);invariant(s);
  s=act(s,{type:'cancel_opening_stock',id:d.id,amount:103.33});assert.equal(s.products[0].qty,0);assert.equal((s.packageLots||[]).reduce((n,l)=>n+l.sealed,0),0);invariant(s);
 });
 check('acknowledged server receipt is not projected twice while acknowledgement is pending',()=>{
  const base=C.cashierProjection(buy(setup()));let cache=C.enqueueCashier({base,version:1,pending:[],lastSync:''},sale(2));const op=cache.pending[0];
  const committed=C.applyCashierAction(base,op.action,{id:op.id,now:op.createdAt});cache=C.acceptCashierSnapshot(cache,committed,2);
  const state=C.localCashierState(cache);assert.equal(state.products[0].qty,8);assert.equal(state.entries.filter(e=>e.id===op.id).length,1);assert.equal(cache.pending.length,1);
 });
 check('conflicting offline receipt blocks additional sales until synchronization',()=>{
  const base=C.cashierProjection(buy(setup()));let cache=C.enqueueCashier({base,version:1,pending:[],lastSync:''},sale(8));
  const other=C.applyCashierAction(base,sale(5),{id:crypto.randomUUID(),now:new Date().toISOString()});cache=C.acceptCashierSnapshot(cache,other,2);
  const before=structuredClone(cache);assert.throws(()=>C.enqueueCashier(cache,sale(1)),/Синхронизировать|синхронизац|провер/);assert.deepEqual(cache,before);
 });
 check('return after a conflicting offline sale remains pending without inflating stock',()=>{
  const base=C.cashierProjection(buy(setup()));let cache=C.enqueueCashier({base,version:1,pending:[],lastSync:''},sale(8));const id=cache.pending[0].id;
  cache=C.enqueueCashier(cache,{type:'return',target:id,lines:[{id:'p',qty:2,stockOrigin:'credit'}],account:'cash'});
  const other=C.applyCashierAction(base,sale(5),{id:crypto.randomUUID(),now:new Date().toISOString()});cache=C.acceptCashierSnapshot(cache,other,2);
  const p=C.projectCashierCache(cache);assert.ok(p.error);assert.equal(p.state.products[0].qty,5);assert.equal(cache.pending.length,2);assert.ok(cache.pending.every(op=>p.state.entries.some(e=>e.id===op.id)));
 });
 check('unacknowledged debt collection already on server is not collected again locally',()=>{
  let s=buy(setup());s=act(s,{...sale(2),walkIn:false,partyId:'client',paid:0,received:0});const base=C.cashierProjection(s);
  let cache=C.enqueueCashier({base,version:1,pending:[],lastSync:''},{type:'payment_party',partyId:'client',amount:20,account:'cash'});const op=cache.pending[0];
  const committed=C.applyCashierAction(base,op.action,{id:op.id,now:op.createdAt});cache=C.acceptCashierSnapshot(cache,committed,2);
  const p=C.projectCashierCache(cache);assert.equal(p.error,'');assert.equal(L.totals(p.state).customerDebt,40);assert.equal(p.state.entries.filter(e=>e.id===op.id).length,1);
 });
 check('insufficient stock and duplicate requests do not change source input',()=>{
  const s=buy(setup());const before=structuredClone(s);assert.throws(()=>act(s,sale(11)),/Недостаточно/);assert.deepEqual(s,before);
  const cache=C.enqueueCashier({base:C.cashierProjection(s),version:1,pending:[],lastSync:''},sale(2));cache.pending[0].status='blocked';cache.pending[0].error='Требуется проверка';assert.throws(()=>C.enqueueCashier(cache,sale()),/проверка/);
 });
 console.log(JSON.stringify({checks,failures}));if(failures)process.exitCode=1;
}finally{await rm(dir,{recursive:true,force:true})}
