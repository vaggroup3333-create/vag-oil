import assert from 'node:assert/strict';
import {stripTypeScriptTypes} from 'node:module';
import {readFile,writeFile,mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';
const temp=await mkdtemp(join(tmpdir(),'vag-return-rounding-'));
try{
 for(const name of ['legacy-ledger','packaging','opening-stock','paid-stock','paid-stock-costs','paid-stock-draft','draft-stock','stock-advances','stock-sources','invoice-duplicates','ledger','reporting'])await writeFile(join(temp,name+'.mjs'),stripTypeScriptTypes(await readFile(new URL('../lib/'+name+'.ts',import.meta.url),'utf8')).replace(/from '\.\/([^']+)'/g,"from './$1.mjs'"));
 const L=await import(pathToFileURL(join(temp,'ledger.mjs'))),R=await import(pathToFileURL(join(temp,'reporting.mjs')));
 const act=(s,a)=>L.apply(s,a,{role:'director',now:'2026-10-29T07:00:00Z'});
 function setup(){let s=L.initial(false);s=L.apply(s,{type:'party',name:'Test Supplier',kind:'supplier'},{id:'supplier'});s=L.apply(s,{type:'party',name:'Test Client',kind:'client'},{id:'client'});return L.apply(s,{type:'product',name:'Test item',category:'Parts',unit:'шт',price:100},{id:'p'})}
 const purchase=(s,qty,price,discount=0,paid=0)=>act(s,{type:'purchase',partyId:'supplier',lines:[{id:'p',qty,price}],discount,paid,account:'cash'});
 function returns(s,source,quantities){for(const qty of quantities){const quote=L.returnQuote(s,s.entries.find(e=>e.id===source),[{id:'p',qty}]);s=act(s,{type:'return',target:source,lines:[{id:'p',qty}],account:'cash'});assert.equal(s.entries.at(-1).total,quote.total);assert.equal(s.entries.at(-1).cost,quote.cost)}return s}
 let checked=0;
 for(const paid of [0,215]){
  let s=purchase(setup(),3,75,10,paid),source=s.entries[0].id;s=returns(s,source,[1,1,1]);
  assert.equal(s.entries[0].credit,215);assert.equal(L.debt(s.entries[0]),0);assert.equal(L.totals(s).profit,0);assert.equal(s.products[0].qty,0);assert.equal(L.balance(s),0);assert.equal(R.partyStatement(s,'purchase','supplier').closing,0);checked++;
 }
 for(const paid of [0,215]){
  let s=purchase(setup(),3,10);s=act(s,{type:'sale',partyId:'client',lines:[{id:'p',qty:3,price:75}],discount:10,paid,account:'cash'});const source=s.entries.at(-1).id;
  s=returns(s,source,[1,1,1]);assert.equal(s.entries.find(e=>e.id===source).credit,215);assert.equal(L.totals(s).revenue,0);assert.equal(L.totals(s).cost,0);assert.equal(L.totals(s).profit,0);assert.equal(s.products[0].qty,3);assert.equal(L.balance(s),0);checked++;
 }
 let s=purchase(setup(),3,75,10);const source=s.entries[0].id;s=returns(s,source,[1,1]);const cancelled=s.entries.at(-1);
 assert.equal(L.supplierReturnCancellationReason(s,cancelled.id),'');s=act(s,{type:'cancel_supplier_return',id:cancelled.id,amount:cancelled.total});s=returns(s,source,[1,1]);assert.equal(L.debt(s.entries[0]),0);assert.equal(L.totals(s).profit,0);checked++;
 for(const qty of [2,3,7])for(const cents of [1,7,101,7500])for(const discountCents of [0,1,Math.floor(qty*cents/3)]){
  if(discountCents>qty*cents)continue;
  let t=purchase(setup(),qty,cents/100,discountCents/100),entry=t.entries[0];t=returns(t,entry.id,Array(qty).fill(1));
  assert.equal(t.entries[0].credit,entry.total);assert.equal(L.debt(t.entries[0]),0);assert.equal(L.totals(t).profit,0);assert.equal(t.products[0].qty,0);checked++;
 }
 for(const order of [['p','p2'],['p2','p']]){
  let t=setup();t=L.apply(t,{type:'product',name:'Second item',category:'Parts',unit:'шт',price:1},{id:'p2'});
  t=act(t,{type:'purchase',partyId:'supplier',lines:[{id:'p',qty:1,price:.01},{id:'p2',qty:1,price:.01}],paid:0});
  t=act(t,{type:'sale',partyId:'client',lines:[{id:'p',qty:1,price:1},{id:'p2',qty:1,price:1}],discount:1.99,paid:.01,account:'cash'});const sale=t.entries.at(-1).id;
  for(const id of order)t=act(t,{type:'return',target:sale,lines:[{id,qty:1}],account:'cash'});
  assert.equal(L.totals(t).profit,0);assert.equal(L.totals(t).revenue,0);assert.equal(L.balance(t),0);
  for(const id of order){assert.equal(R.productSales(t.entries,id).revenue,0);assert.equal(R.productSales(t.entries,id).cost,0);assert.equal(R.productSales(t.entries,id).profit,0)}checked++;
 }
 s=purchase(setup(),10,15);s.entries[0].date='2026-10-01T12:00:00+05:00';s=act(s,{type:'payment',target:s.entries[0].id,amount:50,account:'cash'});s.payments[0].date='2026-10-01T09:00:00Z';const statement=R.partyStatement(s,'purchase','supplier');assert.equal(statement.rows[0].kind,'document');assert.equal(statement.rows[0].balance,150);assert.equal(statement.rows[1].balance,100);checked++;
 console.log('PASS '+checked+' scenarios: cumulative return money/cost, paid and unpaid returns, zero residual debt/profit, cancellation/retry, UI quote agreement, chronological statements.');
}finally{await rm(temp,{recursive:true,force:true})}
