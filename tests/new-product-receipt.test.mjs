import assert from 'node:assert/strict';
import ts from 'typescript';
import {readFile,writeFile,mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';
const dir=await mkdtemp(join(tmpdir(),'oil-new-receipt-'));
try{
 for(const name of ['packaging','legacy-ledger','opening-stock','paid-stock','paid-stock-costs','paid-stock-draft','draft-stock','stock-advances','stock-sources','invoice-duplicates','ledger']){
  let js=ts.transpileModule(await readFile(new URL('../lib/'+name+'.ts',import.meta.url),'utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext}}).outputText;
  for(const dep of ['packaging','legacy-ledger','opening-stock','paid-stock','paid-stock-costs','paid-stock-draft','draft-stock','stock-advances','stock-sources','invoice-duplicates','ledger'])js=js.replaceAll("'./"+dep+"'","'./"+dep+".mjs'");
  js=js.replace(/from '\.\/([^']+)(?<!\.mjs)'/g,"from './$1.mjs'");await writeFile(join(dir,name+'.mjs'),js);
 }
 const {initial,apply}=await import(pathToFileURL(join(dir,'ledger.mjs')));
 let base=apply(initial(false),{type:'party',name:'Supplier',kind:'supplier'},{id:'supplier'});
 base=apply(base,{type:'product',name:'Existing filter',category:'Фильтры',unit:'шт',price:50},{id:'filter'});
 base=apply(base,{type:'draft_new',partyId:'supplier'},{id:'draft',number:'000002'});
 base=apply(base,{type:'draft_save',id:'draft',partyId:'supplier',note:'Keep this draft',paid:10,discountValue:5,account:'cash',lines:[{id:'filter',qty:2,price:20}]});
 const snapshot=structuredClone(base);
 const product={type:'product',name:'New oil',category:'Масло',unit:'л',price:100,wholesale:90,article:'OIL-5'};
 const packaging={kind:'canister',volume:5,count:2,unitPrice:300};
 const action={...product,initialPurchase:{partyId:'supplier',line:{packaging}}};
 const standalone=apply(base,action,{id:'oil'});
 assert.deepEqual(base,snapshot);
 assert.deepEqual(standalone.entries.slice(0,-1),base.entries);
 assert.deepEqual(standalone.products.slice(0,-1),base.products);
 assert.deepEqual(standalone.payments,base.payments);
 assert.equal(standalone.products.at(-1).qty,0);
 assert.equal(standalone.products.at(-1).cost,0);
 const receipt=standalone.entries.at(-1);
 assert.equal(receipt.status,'draft');assert.equal(receipt.total,600);
 assert.equal(receipt.lines[0].qty,10);assert.deepEqual(receipt.lines[0].packaging,packaging);
 const nested=apply(base,{...product,initialPurchase:{draftId:'draft',line:{packaging}}},{id:'oil'});
 assert.equal(nested.entries.length,base.entries.length);
 const draft=nested.entries.find(e=>e.id==='draft');
 for(const key of ['number','date','note','draftPaid','discountValue','account'])assert.equal(draft[key],base.entries[0][key]);
 assert.deepEqual(draft.lines[0],base.entries[0].lines[0]);
 assert.equal(draft.lines.length,2);assert.equal(draft.total,635);
 assert.deepEqual(nested.payments,base.payments);assert.equal(nested.products.at(-1).qty,0);
 for(const bad of [
  {...action,initialPurchase:{partyId:'missing',line:{packaging}}},
  {...action,initialPurchase:{draftId:'missing',line:{packaging}}},
  {...action,initialPurchase:{partyId:'supplier',line:{packaging:{...packaging,count:1.5}}}},
  {...action,unit:'шт'},
  {...action,id:'filter'}
 ]){assert.throws(()=>apply(base,bad));assert.deepEqual(base,snapshot);}
 const barrel=apply(base,{...product,initialPurchase:{partyId:'supplier',line:{packaging:{kind:'barrel',volume:200,count:1,unitPrice:12000}}}});
 assert.equal(barrel.entries.at(-1).lines[0].qty,200);assert.equal(barrel.entries.at(-1).total,12000);
 const bulk=apply(base,{...product,initialPurchase:{partyId:'supplier',line:{qty:2.5,price:60}}});
 assert.equal(bulk.entries.at(-1).total,150);
 const cardOnly=apply(base,product);assert.deepEqual(cardOnly.entries,base.entries);
 const posted=apply(standalone,{...receipt,type:'draft_post',date:receipt.date.slice(0,10),paid:0,account:'cash'});
 assert.equal(posted.products.find(p=>p.id==='oil').qty,10);
 assert.equal(posted.packageLots.find(p=>p.productId==='oil').sealed,2);
 console.log('PASS: atomic product + draft, existing draft 000002 preserved, canisters/barrels/bulk, no stock/payment before posting, invalid requests leave source unchanged.');
}finally{await rm(dir,{recursive:true,force:true});}
