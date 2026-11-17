import assert from 'node:assert/strict';
import {stripTypeScriptTypes} from 'node:module';
import {readFile,writeFile,mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';
const dir=await mkdtemp(join(tmpdir(),'vag-monthly-'));let count=0;
try{
 const seen=new Set();async function load(name){if(seen.has(name))return;seen.add(name);const code=await readFile(new URL('../lib/'+name+'.ts',import.meta.url),'utf8');for(const m of code.matchAll(/from ['"]\.\/([^'"]+)['"]/g))await load(m[1]);await writeFile(join(dir,name+'.mjs'),stripTypeScriptTypes(code).replace(/from ['"]\.\/([^'"]+)['"]/g,"from './$1.mjs'"))}
 await load('monthly-report');const M=await import(pathToFileURL(join(dir,'monthly-report.mjs'))),L=await import(pathToFileURL(join(dir,'ledger.mjs')));
 const check=(name,fn)=>{fn();count++;console.log('PASS '+name)};
 check('month boundaries, leap years, December and validation',()=>{assert.equal(M.monthRange('2028-02').to,'2028-02-29');assert.equal(M.monthRange('2027-02').to,'2027-02-28');assert.equal(M.monthRange('2026-01').previousDay,'2025-12-31');assert.equal(M.shiftMonth('2026-12',1),'2027-01');assert.throws(()=>M.monthRange('2026-13'));assert.throws(()=>M.monthRange('26-11'))});
 let s=L.initial(false);s=L.apply(s,{type:'product',name:'Filter',article:'TEST',category:'Фильтры',unit:'шт',price:25},{id:'filter'});s=L.apply(s,{type:'party',name:'Owner supplier',kind:'supplier'},{id:'owner'});s=L.apply(s,{type:'party',name:'Client',kind:'client'},{id:'client'});
 const act=(a,date)=>{s=L.apply(s,a,{now:date,role:'director',actor:'test'})};
 act({type:'purchase',partyId:'owner',lines:[{id:'filter',qty:20,price:10}],paid:0,account:'cash'},'2026-10-01T10:00:00Z');
 act({type:'sale',partyId:'client',lines:[{id:'filter',qty:4,price:25}],paid:50,account:'cash'},'2026-10-31T18:59:59Z');const octoberSale=s.entries.at(-1).id;
 act({type:'sale',partyId:'client',lines:[{id:'filter',qty:2,price:25}],paid:50,account:'cash'},'2026-10-31T19:00:00Z');
 act({type:'payment',target:octoberSale,amount:50,account:'city'},'2026-11-02T10:00:00Z');
 act({type:'expense',party:'Rent',total:5,account:'cash'},'2026-11-03T10:00:00Z');
 act({type:'payment_party',partyId:'owner',amount:20,account:'cash'},'2026-11-03T10:00:00Z');
 act({type:'transfer',account:'cash',to:'city',total:10},'2026-11-03T10:00:00Z');
 act({type:'return',target:octoberSale,lines:[{id:'filter',qty:1}],account:'city'},'2026-11-04T10:00:00Z');
 const before=JSON.stringify(s),oct=M.monthlyReport(s,'2026-10','2026-11-17T10:00:00Z'),nov=M.monthlyReport(s,'2026-11','2026-11-17T10:00:00Z');
 check('local midnight, old customer debt and month-end cash',()=>{assert.equal(oct.period.count,1);assert.equal(oct.period.revenue,100);assert.equal(oct.period.profit,60);assert.equal(oct.closing.customerDebt,50);assert.equal(oct.closing.cash,50);assert.equal(oct.closing.supplierDebt,200);assert.equal(oct.closing.stock,160);assert.equal(oct.ongoing,false)});
 check('later repayment excluded from revenue, owner repayment excluded from expenses',()=>{assert.equal(nov.period.revenue,25);assert.equal(nov.period.cost,10);assert.equal(nov.period.expenses,5);assert.equal(nov.period.profit,10);assert.equal(nov.cash.opening,50);assert.equal(nov.cash.incoming,100);assert.equal(nov.cash.outgoing,50);assert.equal(nov.cash.closing,100);assert.equal(nov.closing.supplierDebt,180);assert.equal(nov.closing.customerDebt,0)});
 check('current month uses today and remains provisional',()=>{assert.equal(nov.to,'2026-11-17');assert(nov.warnings.some(w=>w.includes('ещё не закончен')));assert.throws(()=>M.monthlyReport(s,'2026-12','2026-11-17T10:00:00Z'))});
 check('supplier sales keep units, returns and debt independent',()=>{const row=nov.suppliers.find(g=>g.id==='owner');assert.equal(row.net['шт'],1);assert.equal(row.cost,10);assert.equal(row.revenue,25);assert.equal(nov.debts.find(p=>p.id==='owner').opening,200);assert.equal(nov.debts.find(p=>p.id==='owner').closing,180)});
 check('no data mutation and cash equation',()=>{assert.equal(JSON.stringify(s),before);assert.equal(nov.cash.opening+nov.cash.incoming-nov.cash.outgoing,nov.cash.closing)});
 check('all exports contain same amounts, and hostile names stay inert',()=>{const t=structuredClone(nov);t.shop='<script>alert(1)</script>';t.suppliers[0].name='=HYPERLINK("x")';const html=M.monthlyHTML(t),csv=M.monthlyCSV(t);assert(!html.includes('<script>'));assert(html.includes('&lt;script&gt;'));assert(html.includes('180,00 с'));assert(csv.includes("'=HYPERLINK"));assert(csv.includes('180,00 с'));assert(html.includes('документы месяца не блокируются'))});
 check('empty past month retains balances and has zero activity',()=>{const r=M.monthlyReport(s,'2026-12','2027-01-01T10:00:00Z');assert.equal(r.period.revenue,0);assert.equal(r.period.profit,0);assert.equal(r.cash.opening,r.cash.closing);assert.equal(r.warnings.length,0)});
 check('drafts and unresolved sales are visibly preliminary',()=>{const t=structuredClone(s);t.entries.push({...t.entries[0],id:'draft',status:'draft',date:'2026-11-12T10:00:00Z'});t.entries.find(e=>e.type==='sale'&&e.id!==octoberSale).costPending=true;const r=M.monthlyReport(t,'2026-11','2026-12-01T10:00:00Z');assert.equal(r.draftCount,1);assert.equal(r.pendingCount,1);assert.equal(r.period.revenue,nov.period.revenue);assert.equal(r.warnings.length,2)});
 check('returns use their own month and reconcile with net revenue',()=>{assert.equal(oct.returns.total,0);assert.equal(nov.returns.total,25);assert.equal(nov.returns.count,1);assert.equal(nov.returns.rows[0].qty,1);assert.equal(nov.returns.rows[0].name,'Filter');assert.equal(nov.returns.rows[0].date,'2026-11-04');assert.equal(nov.period.grossRevenue-nov.returns.total,nov.period.revenue);assert.equal(nov.returns.rows[0].saleNumber,s.entries.find(e=>e.id===octoberSale).number)});
 check('return lines reconcile discounted totals to the cent and keep historical names',()=>{const t=structuredClone(s),ret=t.entries.find(e=>e.type==='sale_return');t.products=[];t.entries=[{...ret,id:'multi',date:'2026-10-31T19:00:00Z',total:10.01,lines:[{...ret.lines[0],name:'Original name',qty:1,price:3},{...ret.lines[0],id:'second',name:'Second product',unit:'л',qty:1.5,price:2}]}];t.entries.push({...t.entries[0],id:'cancelled',status:'cancelled',total:900},{...t.entries[0],id:'draft',status:'draft',total:800},{...t.entries[0],id:'outside',date:'2026-10-31T18:59:59Z',total:700});const r=M.monthlyReturns(t,'2026-11-01','2026-11-30');assert.equal(r.count,1);assert.equal(r.total,10.01);assert.equal(L.round(r.rows.reduce((n,row)=>n+row.amount,0)),10.01);assert.equal(r.rows[0].name,'Original name');assert.equal(r.rows[1].qty,1.5);assert.equal(r.rows[1].unit,'л')});
 check('return details appear in all saved formats with escaping',()=>{const r=structuredClone(nov);r.returns.rows[0].name='<img src=x onerror=alert(1)>';const html=M.monthlyHTML(r),csv=M.monthlyCSV(r);assert(html.includes('Возвращённые товары'));assert(!html.includes('<img'));assert(html.includes('&lt;img'));assert(csv.includes('Возвращённые товары'));assert.equal(M.monthlyReturnSection(nov).rows[0][6],'25,00 с')});
 check('cash reconciliation separates month sales, old debt, supplier reversal and cash refunds',()=>{
  let t=L.initial(false);
  const post=(action,now,id)=>{t=L.apply(t,action,{now,id,role:'director',actor:'test'})};
  const product='reconcile-product',customer='reconcile-client',supplier='reconcile-supplier';
  post({type:'product',name:'Test filter',category:'Фильтры',unit:'шт',price:120},'2026-10-01T10:00:00Z',product);
  post({type:'party',name:'Supplier',kind:'supplier'},'2026-10-01T10:00:00Z',supplier);
  post({type:'party',name:'Customer',kind:'client'},'2026-10-01T10:00:00Z',customer);
  post({type:'purchase',partyId:supplier,lines:[{id:product,qty:6,price:500}],paid:0,account:'cash'},'2026-10-01T10:00:00Z');
  post({type:'sale',partyId:customer,lines:[{id:product,qty:1,price:1250}],paid:1000,account:'cash'},'2026-10-31T18:59:59Z');
  post({type:'sale',partyId:customer,lines:[{id:product,qty:1,price:7400}],paid:7200,account:'cash'},'2026-10-31T19:00:00Z');
  post({type:'sale',partyId:customer,lines:[{id:product,qty:1,price:120}],paid:120,account:'cash'},'2026-11-01T10:00:00Z','reconcile-returned-sale');
  post({type:'payment_party',partyId:customer,amount:250,account:'city'},'2026-11-02T10:00:00Z');
  post({type:'payment_party',partyId:supplier,amount:1300,account:'cash'},'2026-11-03T10:00:00Z');
  post({type:'payment_party',partyId:supplier,amount:157.23,account:'cash'},'2026-11-04T10:00:00Z');
  post({type:'cancel_supplier_payment',id:t.payments.at(-1).id,amount:157.23,reason:'Duplicate posted payment'},'2026-11-05T10:00:00Z');
  post({type:'return',target:'reconcile-returned-sale',lines:[{id:product,qty:1}],account:'cash'},'2026-11-06T10:00:00Z');
  post({type:'transfer',account:'cash',to:'city',total:10},'2026-11-08T10:00:00Z');

  const report=M.monthlyReport(t,'2026-11','2026-11-12T10:00:00Z');
  assert.equal(report.period.revenue,7400);
  assert.deepEqual(report.cash,{opening:1000,incoming:7727.23,outgoing:1577.23,closing:7150});
  assert.deepEqual(report.cashReconciliation,{
   incoming:[
    {label:'Оплаты по чекам этого месяца',amount:7320},
    {label:'Погашение долгов клиентов за прошлые месяцы',amount:250},
    {label:'Возврат денег после отмены оплаты поставщику',amount:157.23},
   ],
   outgoing:[
    {label:'Оплаты поставщикам',amount:1457.23},
    {label:'Возвраты денег клиентам',amount:120},
   ],
   currentSalesPaid:7320,currentSalesDifference:-80,otherReceipts:407.23,difference:327.23,
  });
  for(const saved of [M.monthlyHTML(report),M.monthlyCSV(report)]){
   assert(saved.includes('Сверка выручки и кассы'));
   assert(saved.includes('Погашение долгов клиентов за прошлые месяцы'));
   assert(saved.includes('Возвраты денег клиентам'));
   assert(saved.includes('327,23 с'));
  }
 });
 check('unknown or unlinked movements remain visible in the cash totals',()=>{
  const t=L.initial(false),date='2026-11-01T10:00:00Z';
  const payment={date,account:'cash',party:'Test',note:''};
  t.payments.push(
   {...payment,id:'legacy',kind:'receipt',target:'missing-sale',amount:.01},
   {...payment,id:'unknown-in',kind:'test-import',amount:.02},
   {...payment,id:'unknown-out',kind:'test-import',amount:-.01},
  );
  const report=M.monthlyReport(t,'2026-11','2026-12-01T10:00:00Z'),cash=report.cashReconciliation;
  assert.deepEqual(cash.incoming,[{label:'Оплаты без связанного чека',amount:.01},{label:'Другие поступления',amount:.02}]);
  assert.deepEqual(cash.outgoing,[{label:'Другие списания',amount:.01}]);
  assert.equal(cash.currentSalesDifference,0);
  assert.equal(cash.otherReceipts,.03);
  assert.equal(cash.difference,.03);
 });
 console.log(count+' monthly report cases passed');
}finally{await rm(dir,{recursive:true,force:true})}
