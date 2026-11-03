import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFile,writeFile,mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';
import ts from 'typescript';
const dir=await mkdtemp(join(tmpdir(),'offline-cashier-'));
try{
 const names=['packaging','legacy-ledger','opening-stock','paid-stock','paid-stock-costs','paid-stock-draft','draft-stock','stock-advances','stock-sources','invoice-duplicates','ledger','request-security','password-auth','working-ledger','cashier-protocol','cashier-server','cashier-sync'];
 for(const name of names){let source=await readFile(new URL('../lib/'+name+'.ts',import.meta.url),'utf8');let output=ts.transpileModule(source,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext}}).outputText;for(const dependency of names)output=output.replaceAll("'./"+dependency+"'","'./"+dependency+".mjs'");await writeFile(join(dir,name+'.mjs'),output)}
 const {initial,apply,balance,totals}=await import(pathToFileURL(join(dir,'ledger.mjs')));
 const {cashierProjection,enqueueCashier,localCashierState,refreshAfterReset}=await import(pathToFileURL(join(dir,'cashier-protocol.mjs')));
 const {cashierStore}=await import(pathToFileURL(join(dir,'cashier-server.mjs')));
 const {drainCashierQueue}=await import(pathToFileURL(join(dir,'cashier-sync.mjs')));
 const {authenticate,passwordHash,sessionPrincipal,ledgerOwner}=await import(pathToFileURL(join(dir,'password-auth.mjs')));
 class Database{
  sql=new DatabaseSync(':memory:');injectRace=false;
  prepare(query){const db=this;return {args:[],bind(...args){this.args=args;return this},async first(){return db.sql.prepare(query).get(...this.args)||null},async run(){if(db.injectRace&&query.startsWith('UPDATE ledgers')){db.injectRace=false;db.sql.exec('UPDATE ledgers SET version=version+1')}const result=db.sql.prepare(query).run(...this.args);return {meta:{changes:Number(result.changes)},success:true}}}}
  async batch(statements){this.sql.exec('BEGIN');try{const results=[];for(const statement of statements)results.push(await statement.run());this.sql.exec('COMMIT');return results}catch(e){this.sql.exec('ROLLBACK');throw e}}
 }
 const db=new Database();db.sql.exec('CREATE TABLE ledgers(id TEXT PRIMARY KEY,data TEXT NOT NULL,version INTEGER NOT NULL)');
 let server=initial(false);server=apply(server,{type:'party',kind:'supplier',name:'Private supplier'});const supplier=server.parties[0].id;
 server=apply(server,{type:'product',name:'Part',category:'Parts',unit:'шт',price:30});const product=server.products[0].id;
 server=apply(server,{type:'purchase',partyId:supplier,lines:[{id:product,qty:10,price:10}],paid:0});
 server.shifts.push({id:'closed-shift',opened:new Date(Date.now()-7200000).toISOString(),closed:new Date(Date.now()-1800000).toISOString(),expected:0,actual:60});
 db.sql.prepare('INSERT INTO ledgers VALUES(?,?,?)').run('owner:live',JSON.stringify(server),1);
 const get=()=>cashierStore(new Request('https://test.invalid/api/cashier?mode=live'),db,'owner');
 const post=operation=>cashierStore(new Request('https://test.invalid/api/cashier?mode=live',{method:'POST',headers:{host:'test.invalid',origin:'https://test.invalid','content-type':'application/json'},body:JSON.stringify({operation})}),db,'owner');
 const snapshot=await (await get()).json();assert.equal(snapshot.data.products[0].cost,0);assert.equal(snapshot.data.parties.some(p=>p.kind==='supplier'),false);assert.equal(snapshot.data.entries.some(e=>e.type==='purchase'),false);assert.equal(snapshot.data.payments.length,0);
 let stored=JSON.stringify({base:snapshot.data,version:snapshot.version,pending:[],lastSync:''});
 const store={read:async()=>JSON.parse(stored),update:async fn=>{const next=fn(JSON.parse(stored));stored=JSON.stringify(next);return JSON.parse(stored)}};
 const createdAt=new Date(Date.now()-3600000).toISOString(),id=crypto.randomUUID();
 await store.update(cache=>enqueueCashier(cache,{type:'sale',walkIn:true,lines:[{id:product,qty:2,price:30}],paid:60,received:100,account:'cash',paymentMethod:'cash'},createdAt,id));
 const restarted=await store.read();assert.equal(restarted.pending.length,1);assert.equal(localCashierState(restarted).products[0].qty,8);assert.equal(restarted.pending[0].receipt.change,40);assert.equal(restarted.pending[0].receipt.date,createdAt);
 let lostResponse=true;
 const send=async operation=>{const response=await post(operation);const reply=await response.json();if(lostResponse){lostResponse=false;throw Error('Network disconnected after server commit')}return {...reply,status:response.status}};
 await assert.rejects(()=>drainCashierQueue(store,send),/Network disconnected/);assert.equal((await store.read()).pending.length,1);
 assert.equal((await drainCashierQueue(store,send)).count,1);assert.equal((await store.read()).pending.length,0);
 let actual=JSON.parse(db.sql.prepare('SELECT data FROM ledgers WHERE id=?').get('owner:live').data);assert.equal(actual.entries.filter(e=>e.id===id).length,1);assert.equal(actual.products[0].qty,8);assert.equal(balance(actual,'cash'),60);assert.equal(totals(actual).profit,40);assert.equal(actual.shifts[0].expected,60);assert.equal(actual.entries.find(e=>e.id===id).date,createdAt);
 const originalOperation=restarted.pending[0];assert.equal((await post(originalOperation)).status,200);assert.equal((await post({...originalOperation,action:{...originalOperation.action,note:'different'}})).status,409);
 // Two queued receipts, including a return against a local receipt, retain stable IDs.
 const saleId=crypto.randomUUID();await store.update(cache=>enqueueCashier(cache,{type:'sale',walkIn:true,lines:[{id:product,qty:1,price:30}],paid:30,received:30,account:'cash',paymentMethod:'cash'},new Date().toISOString(),saleId));
 await store.update(cache=>enqueueCashier(cache,{type:'return',target:saleId,lines:[{id:product,qty:1}],account:'cash'}));
 assert.equal((await drainCashierQueue(store,async op=>{const response=await post(op);return {...await response.json(),status:response.status}})).count,2);
 actual=JSON.parse(db.sql.prepare('SELECT data FROM ledgers WHERE id=?').get('owner:live').data);assert.equal(actual.products[0].qty,8);assert.equal(balance(actual,'cash'),60);
 // An independent till consumed the last stock while this till was offline.
 await store.update(cache=>enqueueCashier(cache,{type:'sale',walkIn:true,lines:[{id:product,qty:8,price:30}],paid:240,received:240,account:'cash',paymentMethod:'cash'}));
 actual.products[0].qty=0;actual.stockSources.balances[product]={paid:0,credit:0,unknown:0};db.sql.prepare('UPDATE ledgers SET data=?,version=version+1 WHERE id=?').run(JSON.stringify(actual),'owner:live');
 const blocked=await drainCashierQueue(store,async op=>{const response=await post(op);return {...await response.json(),status:response.status}});assert.equal(blocked.blocked,true);assert.equal((await store.read()).pending.length,1);assert.equal((await store.read()).pending[0].status,'blocked');
 actual.products[0].qty=8;actual.stockSources.balances[product]={paid:0,credit:8,unknown:0};db.sql.prepare('UPDATE ledgers SET data=?,version=version+1 WHERE id=?').run(JSON.stringify(actual),'owner:live');db.injectRace=true;
 assert.equal((await drainCashierQueue(store,async op=>{const response=await post(op);return {...await response.json(),status:response.status}},true)).count,1);assert.equal((await store.read()).pending.length,0);
 // Restricted endpoint cannot execute director operations or return a purchase.
 assert.equal((await post({id:crypto.randomUUID(),createdAt:new Date().toISOString(),action:{type:'product',name:'Forgery',lines:[{id:product,qty:1}]}})).status,422);
 assert.equal((await post({id:crypto.randomUUID(),createdAt:new Date().toISOString(),action:{type:'return',target:server.entries[0].id,lines:[{id:product,qty:1}],account:'cash'}})).status,422);
 // Offline debt collection updates sale debts and posts money exactly once after a lost response.
 actual=JSON.parse(db.sql.prepare('SELECT data FROM ledgers WHERE id=?').get('owner:live').data);
 actual=apply(actual,{type:'party',name:'Debtor',kind:'client'});const debtor=actual.parties.find(p=>p.name==='Debtor').id;actual.products[0].qty=5;actual.stockSources.balances[product]={paid:0,credit:5,unknown:0};
 actual=apply(actual,{type:'sale',partyId:debtor,lines:[{id:product,qty:1,price:30}],paid:0,received:0,account:'cash',paymentMethod:'debt'});
 actual=apply(actual,{type:'sale',partyId:debtor,lines:[{id:product,qty:1,price:30}],paid:0,received:0,account:'cash',paymentMethod:'debt'});
 db.sql.prepare('UPDATE ledgers SET data=?,version=version+1 WHERE id=?').run(JSON.stringify(actual),'owner:live');
 const beforeCash=balance(actual,'cash'),beforeStock=actual.products[0].qty,beforeProfit=totals(actual).profit;
 const fresh=await (await get()).json();stored=JSON.stringify({base:fresh.data,version:fresh.version,pending:[],lastSync:''});
 await store.update(cache=>enqueueCashier(cache,{type:'payment_party',partyId:debtor,amount:40,account:'cash',note:'Debt paid'}));
 const debtOp=(await store.read()).pending[0];const local=localCashierState(await store.read());assert.equal(local.entries.filter(e=>e.type==='sale'&&e.partyId===debtor).reduce((n,e)=>n+e.total-e.paid-e.credit,0),20);assert.equal(debtOp.receipt.total,40);
 assert.equal((await post(debtOp)).status,200);assert.equal((await post(debtOp)).status,200);
 actual=JSON.parse(db.sql.prepare('SELECT data FROM ledgers WHERE id=?').get('owner:live').data);assert.equal(balance(actual,'cash'),beforeCash+40);assert.equal(actual.products[0].qty,beforeStock);assert.equal(totals(actual).profit,beforeProfit);assert.equal(actual.entries.filter(e=>e.id===debtOp.id).length,1);
 assert.equal((await post({id:crypto.randomUUID(),createdAt:new Date().toISOString(),action:{type:'payment_party',partyId:debtor,amount:21,account:'cash'}})).status,422);
 assert.equal((await post({id:crypto.randomUUID(),createdAt:new Date().toISOString(),action:{type:'payment_party',partyId:supplier,amount:1,account:'cash'}})).status,422);
 console.log('PASS: offline customer debt receipt, allocation across two sales, duplicate replay, excess payment and supplier payment rejected');
 const authEnv={DB:db,POS_LOGIN:'director',POS_PASSWORD_SALT:'director-test',POS_PASSWORD_HASH:await passwordHash('Director-for-tests','director-test'),POS_LEDGER_OWNER:'owner',POS_CASHIER_LOGIN:'cashier',POS_CASHIER_PASSWORD_SALT:'cashier-test',POS_CASHIER_PASSWORD_HASH:await passwordHash('7392','cashier-test')};
 const authReq=(body,cookie='')=>new Request('https://test.invalid/api/auth',{method:'POST',headers:{host:'test.invalid',origin:'https://test.invalid','content-type':'application/json',cookie,'cf-connecting-ip':'test'},body:JSON.stringify(body)});
 const cashierLogin=await authenticate(authReq({action:'login',login:'cashier',password:'7392'}),authEnv);assert.equal(cashierLogin.status,200);const cashierCookie=cashierLogin.headers.get('set-cookie');assert.equal((await sessionPrincipal(new Request('https://test.invalid',{headers:{cookie:cashierCookie}}),authEnv)).role,'cashier');assert.equal(await ledgerOwner(new Request('https://test.invalid',{headers:{cookie:cashierCookie}}),authEnv),'owner');
 assert.equal((await authenticate(authReq({action:'change_password',currentPassword:'Director-for-tests',newPassword:'5932',confirmPassword:'5932'},cashierCookie),authEnv)).status,403);
 const directorLogin=await authenticate(authReq({action:'login',login:'director',password:'Director-for-tests'}),authEnv);const directorCookie=directorLogin.headers.get('set-cookie');
 assert.equal((await authenticate(authReq({action:'change_cashier_password',currentPassword:'Director-for-tests',newPassword:'5932',confirmPassword:'5932'},directorCookie),authEnv)).status,200);
 assert.equal(await sessionPrincipal(new Request('https://test.invalid',{headers:{cookie:cashierCookie}}),authEnv),null);assert.equal((await sessionPrincipal(new Request('https://test.invalid',{headers:{cookie:directorCookie}}),authEnv)).role,'director');
 assert.equal((await authenticate(authReq({action:'login',login:'cashier',password:'7392'}),authEnv)).status,401);assert.equal((await authenticate(authReq({action:'login',login:'cashier',password:'5932'}),authEnv)).status,200);
 const resetAt=new Date().toISOString();const oldCache=await store.read();const cleared=refreshAfterReset(oldCache,initial(false),oldCache.version+1,resetAt);assert.equal(cleared.pending.length,0);assert.equal(cleared.base.products.length,0);assert.equal(cleared.resetAt,resetAt);
 const current=enqueueCashier({...cleared,base:fresh.data},{type:'payment_party',partyId:debtor,amount:1,account:'cash'});assert.equal(refreshAfterReset(current,fresh.data,current.version,resetAt).pending.length,1);
 db.sql.prepare('INSERT INTO pos_ledger_resets VALUES(?,?,?)').run('owner:live',resetAt,'test-reset');
 assert.equal((await post(debtOp)).status,422);assert.equal((await (await get()).json()).resetAt,resetAt);
 console.log('PASS: reset generation drops old local data once, preserves new checks, rejects stale replay');
 console.log('PASS: persistent offline queue/restart, lost-response replay exactly once, stock/cash/profit/date, local receipt return, blocked stock conflict retained and retried, optimistic concurrency, restricted data/actions, cashier role and director-only cashier password rotation');
}finally{await rm(dir,{recursive:true,force:true})}
