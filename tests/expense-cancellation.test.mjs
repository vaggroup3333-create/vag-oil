import assert from 'node:assert/strict';
import {stripTypeScriptTypes} from 'node:module';
import {readFile,writeFile,mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';

const dir=await mkdtemp(join(tmpdir(),'vag-expense-cancellation-'));
try{
 for(const name of ['legacy-ledger','packaging','opening-stock','paid-stock','paid-stock-costs','paid-stock-draft','paid-stock-store','paid-stock-save-recovery','draft-stock','stock-advances','stock-sources','invoice-duplicates','ledger','reporting']){
  const source=await readFile(new URL('../lib/'+name+'.ts',import.meta.url),'utf8');
  await writeFile(join(dir,name+'.mjs'),stripTypeScriptTypes(source).replace(/from '\.\/([^']+)'/g,"from './$1.mjs'"));
 }
 const L=await import(pathToFileURL(join(dir,'ledger.mjs')));
 const R=await import(pathToFileURL(join(dir,'reporting.mjs')));
 const at='2026-11-20T10:34:00Z',cancelledAt='2026-11-22T15:00:00Z';
 const context={role:'director',actor:'test-director',now:cancelledAt,id:'expense-cancellation'};
 function fixture(account='city',date=at){
  let s=L.initial(false);
  s=L.apply(s,{type:'party',kind:'supplier',name:'Unrelated Supplier'},{id:'supplier',now:at});
  s=L.apply(s,{type:'product',name:'Unrelated item',unit:'шт',category:'Parts',price:20},{id:'product',now:at});
  s=L.apply(s,{type:'purchase',partyId:'supplier',lines:[{id:'product',qty:2,price:10}],paid:0,account:'cash'},{id:'unrelated-purchase',now:at});
  s=L.apply(s,{type:'cash_in',total:3000,party:'Owner',account},{id:'funds',now:date});
  s=L.apply(s,{type:'expense',total:1300,party:'КАЛЕСО ТЧ',account,note:'Ошибочная запись'},{id:'expense',number:'000173',now:date});
  return s;
 }
 const action={type:'cancel_expense',id:'expense',amount:1300,reason:'Ошибочный расход'};
 const run=(s,a=action,c=context)=>L.apply(s,a,c);
 let checked=0;

 for(const account of ['cash','city','alif']){
  const before=fixture(account),raw=JSON.stringify(before),original=structuredClone(before.entries.find(e=>e.id==='expense')),debit=structuredClone(before.payments.find(p=>p.target==='expense'));
  assert.equal(L.expenseCancellationReason(before,'expense'),'');
  const after=run(before),entry=after.entries.find(e=>e.id==='expense'),reversal=after.entries.find(e=>e.reversalOf==='expense'),payment=after.payments.find(p=>p.reversalOf===debit.id);
  assert.equal(JSON.stringify(before),raw,'input is not mutated');
  assert.equal(entry.status,'posted','the original expense remains in its historical period');
  assert.equal(entry.cancelledAt,cancelledAt);assert.equal(entry.cancelledBy,'test-director');assert.equal(entry.cancellationReason,action.reason);
  assert.equal(reversal.id,entry.reversalId);assert.equal(reversal.type,'expense_reversal');assert.equal(reversal.status,'posted');assert.equal(reversal.date,cancelledAt);
  assert.equal(reversal.target,entry.id);assert.equal(reversal.reversalOf,entry.id);assert.equal(reversal.total,1300);assert.equal(reversal.paid,1300);assert.equal(reversal.account,account);assert.equal(reversal.lines.length,0);
  assert.equal(payment.kind,'expense_reversal');assert.equal(payment.amount,1300);assert.equal(payment.account,account);assert.equal(payment.target,reversal.id);assert.equal(payment.operationId,reversal.id);assert.equal(payment.date,cancelledAt);
  const savedDebit=after.payments.find(p=>p.id===debit.id);
  assert.equal(savedDebit.amount,-1300);assert.equal(savedDebit.date,at);assert.equal(savedDebit.reversalId,payment.id);assert.equal(savedDebit.cancellationReason,action.reason);
  const {cancelledAt:ca,cancelledBy:cb,cancellationReason:cr,reversalId:ri,...preservedEntry}=entry;
  assert.deepEqual(JSON.parse(JSON.stringify(preservedEntry)),JSON.parse(JSON.stringify(original)),'every original expense business field is retained');
  assert.deepEqual(after.products,before.products);assert.deepEqual(after.parties,before.parties);assert.deepEqual(after.packageLots,before.packageLots);assert.deepEqual(after.stockSources,before.stockSources);assert.deepEqual(after.stockAdvances,before.stockAdvances);
  assert.deepEqual(after.entries.filter(e=>e.id!=='expense'&&e.id!==reversal.id),before.entries.filter(e=>e.id!=='expense'));
  assert.deepEqual(after.payments.filter(p=>p.id!==debit.id&&p.id!==payment.id),before.payments.filter(p=>p.id!==debit.id));
  const totalsBefore=L.totals(before),totalsAfter=L.totals(after);
  assert.equal(totalsAfter.cash-totalsBefore.cash,1300);assert.equal(totalsAfter.expenses,0);assert.equal(totalsAfter.profit-totalsBefore.profit,1300);assert.equal(totalsAfter.income,totalsBefore.income);
  assert.equal(L.balance(after,account),3000);for(const other of after.accounts.filter(a=>a.id!==account))assert.equal(L.balance(after,other.id),L.balance(before,other.id));
  for(const key of ['revenue','cost','stock','customerDebt','supplierDebt'])assert.equal(totalsAfter[key],totalsBefore[key],key);
  assert.equal(L.totals(after,'2026-11-20','2026-11-20').expenses,1300);assert.equal(L.totals(after,'2026-11-22','2026-11-22').expenses,-1300);
  assert.match(L.expenseCancellationReason(after,'expense'),/уже отменён/);
  assert.deepEqual(JSON.parse(JSON.stringify(run(after))),JSON.parse(JSON.stringify(after)),'lost-response retry is idempotent');
  assert.deepEqual(JSON.parse(JSON.stringify(run(after,{...action,reason:'Повтор после разрыва связи'},{...context,id:'different-attempt',now:'2026-11-23T15:00:00Z'}))),JSON.parse(JSON.stringify(after)),'a second fresh attempt cannot create a second correction');
  assert.throws(()=>run(after,{...action,amount:1299}),/Сумма расхода изменилась/);
  checked++;
 }
 const monthly=run(fixture('city','2026-10-20T10:34:00Z'));
 assert.equal(L.totals(monthly,'2026-10-01','2026-10-31').expenses,1300);
 assert.equal(L.totals(monthly,'2026-10-01','2026-10-31').profit,-1300);
 assert.equal(L.totals(monthly,'2026-11-01','2026-11-30').expenses,-1300);
 assert.equal(L.totals(monthly).expenses,0);
 assert.equal(R.balanceAt(monthly,'2026-10-31').cash,1700);
 assert.equal(R.balanceAt(monthly,'2026-11-30').cash,3000);
 checked++;

 // Legacy normalization linked expenses by payment id rather than target.
 const legacy=fixture();const legacyPayment=legacy.payments.find(p=>p.target==='expense');legacyPayment.id='expense';delete legacyPayment.target;delete legacy.entries.find(e=>e.id==='expense').account;
 assert.equal(L.expenseCancellationReason(legacy,'expense'),'');assert.equal(L.balance(run(legacy),'city'),3000);checked++;
 const future=fixture('city','2026-12-01T10:34:00Z'),futureAfter=run(future);
 assert.equal(futureAfter.entries.at(-1).date,'2026-12-01T10:34:00Z');assert.equal(futureAfter.payments.at(-1).date,'2026-12-01T10:34:00Z');
 assert.equal(R.balanceAt(futureAfter,'2026-11-30').cash,R.balanceAt(future,'2026-11-30').cash);assert.equal(L.totals(futureAfter,'2026-12-01','2026-12-01').expenses,0);checked++;

 for(const role of [undefined,'administrator','cashier'])assert.throws(()=>run(fixture(),action,{...context,role}),/только директор/);
 for(const change of [
  s=>{s.entries.find(e=>e.id==='expense').total=1301},
  s=>{s.entries.find(e=>e.id==='expense').paid=100},
  s=>{s.entries.find(e=>e.id==='expense').credit=1},
  s=>{s.entries.find(e=>e.id==='expense').lines=[{id:'product',qty:1,price:1300,cost:1300}]},
  s=>{s.entries.find(e=>e.id==='expense').reversalOf='other-expense'},
  s=>{s.entries.find(e=>e.id==='expense').date='bad-date'},
  s=>{s.entries.find(e=>e.id==='expense').account='cash'},
  s=>{s.entries.find(e=>e.id==='expense').status='deleted'},
  s=>{s.entries.push({...s.entries.find(e=>e.id==='expense')})},
  s=>{s.payments.find(p=>p.target==='expense').amount=-1299},
  s=>{s.payments.find(p=>p.target==='expense').kind='payout'},
  s=>{s.payments.find(p=>p.target==='expense').date='2026-11-19T10:34:00Z'},
  s=>{s.payments.find(p=>p.target==='expense').date='bad-date'},
  s=>{s.payments.find(p=>p.target==='expense').account='missing'},
  s=>{s.payments.find(p=>p.target==='expense').cancelledAt=cancelledAt},
  s=>{s.payments.find(p=>p.target==='expense').reversalId='other'},
  s=>{s.payments.push({...s.payments.find(p=>p.target==='expense')})},
  s=>{s.payments=s.payments.filter(p=>p.target!=='expense')},
  s=>{s.entries.push({...s.entries.find(e=>e.id==='expense'),id:'related',target:'expense',type:'income'})},
 ]){
  const invalid=fixture();change(invalid);const raw=JSON.stringify(invalid);assert(L.expenseCancellationReason(invalid,'expense'));assert.throws(()=>run(invalid));assert.equal(JSON.stringify(invalid),raw);checked++;
 }
 assert.throws(()=>run(fixture(),{...action,reason:'  '}),/обязательные/);
 assert.throws(()=>run(fixture(),{...action,amount:1299}),/Сумма расхода/);
 assert.throws(()=>run(fixture(),{...action,amount:1300.001}),/Сумма расхода/);
 assert.throws(()=>run(fixture(),action,{...context,now:'bad-date'}),/дата отмены/);
 assert.throws(()=>run(fixture(),{...action,id:'unrelated-purchase'}),/Расход не найден/);
 assert.throws(()=>run(fixture(),action,{...context,id:'funds'}),/уже используется/);
 for(const change of [
  s=>{s.entries=s.entries.filter(e=>e.type!=='expense_reversal')},
  s=>{s.entries.at(-1).total=1},
  s=>{s.payments.at(-1).account='cash'},
  s=>{s.payments.at(-1).amount=1},
  s=>{s.payments.at(-1).reversalOf='wrong'},
  s=>{s.payments.push({...s.payments.at(-1),id:'extra'})},
  s=>{s.entries.find(e=>e.id==='expense').cancelledBy=''},
  s=>{s.entries.find(e=>e.id==='expense').status='cancelled'},
  s=>{s.entries.find(e=>e.id==='expense').credit=1},
  s=>{s.payments.find(p=>p.target==='expense').date='2026-11-19T10:34:00Z'},
  s=>{s.payments.at(-1).cancelledAt=cancelledAt},
  s=>{s.entries.at(-1).cancelledAt=cancelledAt},
 ]){
  const invalid=run(fixture());change(invalid);const raw=JSON.stringify(invalid);assert.throws(()=>run(invalid),/История отмены расхода неполная/);assert.equal(JSON.stringify(invalid),raw);checked++;
 }
 console.log('PASS: expense cancellation roles, exact amount/payment/account, original audit history, same/cross-month cash and profit, legacy linkage, future dates, malformed histories and idempotent retries ('+checked+' scenarios).');
}finally{await rm(dir,{recursive:true,force:true});}
