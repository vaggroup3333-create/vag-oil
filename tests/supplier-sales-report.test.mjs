import assert from 'node:assert/strict';
import {stripTypeScriptTypes} from 'node:module';
import {mkdtemp,readFile,rm,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';

const folder=await mkdtemp(join(tmpdir(),'vag-supplier-sales-'));
try{
 for(const name of ['legacy-ledger','packaging','opening-stock','paid-stock','paid-stock-costs','paid-stock-draft','draft-stock','stock-advances','stock-sources','invoice-duplicates','ledger','reporting','supplier-sales']){
  const source=await readFile(new URL('../lib/'+name+'.ts',import.meta.url),'utf8');
  await writeFile(join(folder,name+'.mjs'),stripTypeScriptTypes(source).replace(/from '\.\/([^']+)'/g,"from './$1.mjs'"));
 }
 const {apply,initial}=await import(pathToFileURL(join(folder,'ledger.mjs')));
 const {supplierSales,UNKNOWN_SUPPLIER}=await import(pathToFileURL(join(folder,'supplier-sales.mjs')));

 const act=(s,id,day,action)=>apply(s,action,{
  id,role:'director',actor:'test',now:`2026-10-${String(day).padStart(2,'0')}T09:00:00Z`
 });
 const buy=(s,id,day,partyId,qty,price)=>act(s,id,day,{
  type:'purchase',partyId,lines:[{id:'filter',qty,price}],paid:0,account:'cash'
 });
 const sendBack=(s,id,day,target,qty)=>act(s,id,day,{
  type:'return',target,lines:[{id:'filter',qty}],account:'cash'
 });
 const sell=(s,day)=>act(s,'sale',day,{
  type:'sale',partyId:'client',lines:[{id:'filter',qty:1,price:25}],paid:25,account:'cash'
 });
 const rowFor=(state,id)=>supplierSales(state).flatMap(group=>group.rows).find(row=>row.entryId===id);

 let base=act(initial(false),'filter',1,{type:'product',name:'Test filter',category:'Filters',unit:'шт',price:25});
 for(const [id,name,kind] of [['first','Supplier A','supplier'],['second','Supplier B','supplier'],['client','Client','client']]){
  base=act(base,id,1,{type:'party',name,kind});
 }
 base=buy(base,'first-receipt',1,'first',2,10);

 let fullyReturned=sendBack(base,'first-return',2,'first-receipt',1);
 fullyReturned=sendBack(fullyReturned,'second-return',3,'first-receipt',1);
 fullyReturned=sell(buy(fullyReturned,'second-receipt',4,'second',3,12),5);
 const confirmed=rowFor(fullyReturned,'sale');
 assert.equal(confirmed.supplierId,'second');
 assert.equal(confirmed.sources.length,1);
 assert.equal(confirmed.revenue,25);
 assert.equal(confirmed.cost,12);

 const partial=sell(buy(sendBack(base,'first-return',2,'first-receipt',1),'second-receipt',3,'second',3,12),4);
 assert.equal(rowFor(partial,'sale').supplierId,UNKNOWN_SUPPLIER);

 let cancelled=sendBack(base,'first-return',2,'first-receipt',2);
 cancelled=act(cancelled,'cancel-return',3,{type:'cancel_supplier_return',id:'first-return',amount:20});
 cancelled=sell(buy(cancelled,'second-receipt',4,'second',3,12),5);
 assert.equal(rowFor(cancelled,'sale').supplierId,UNKNOWN_SUPPLIER);

 let later=sell(buy(base,'second-receipt',2,'second',3,12),3);
 later=sendBack(later,'supplier-return-after-sale',3,'first-receipt',2);
 later=sendBack(later,'customer-return',4,'sale',1);
 const original=rowFor(later,'sale'),returned=rowFor(later,'customer-return');
 assert.equal(original.supplierId,UNKNOWN_SUPPLIER);
 assert.equal(returned.supplierId,original.supplierId);
 assert.deepEqual(returned.sources,original.sources);
 assert.equal(returned.revenue,-25);

 console.log('SUPPLIER SALES REPORT CHECKS: full, partial, cancelled and later returns passed');
}finally{
 await rm(folder,{recursive:true,force:true});
}
