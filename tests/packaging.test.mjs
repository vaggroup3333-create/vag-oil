import assert from 'node:assert/strict';
import ts from 'typescript';
import {readFile,writeFile,mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';
const dir=await mkdtemp(join(tmpdir(),'oil-packs-'));
try{
 const names=['packaging','legacy-ledger','opening-stock','paid-stock','paid-stock-costs','paid-stock-draft','draft-stock','stock-advances','stock-sources','invoice-duplicates','ledger','cashier-protocol'];
 for(const name of names){let js=ts.transpileModule(await readFile(new URL('../lib/'+name+'.ts',import.meta.url),'utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext}}).outputText;for(const d of names)js=js.replaceAll("'./"+d+"'","'./"+d+".mjs'");await writeFile(join(dir,name+'.mjs'),js);}
 const {initial,apply,normalize,totals}=await import(pathToFileURL(join(dir,'ledger.mjs')));
 const {packageBalance}=await import(pathToFileURL(join(dir,'packaging.mjs')));
 const {cashierProjection,enqueueCashier,localCashierState,cleanCashierAction}=await import(pathToFileURL(join(dir,'cashier-protocol.mjs')));
 function setup(){let s=initial(false);s=apply(s,{type:'product',name:'Test oil',article:'TEST',category:'Масло',unit:'л',price:100,wholesale:90},{id:'oil'});s=apply(s,{type:'party',name:'Test supplier',kind:'supplier'},{id:'supplier'});s=apply(s,{type:'party',name:'Test client',kind:'client'},{id:'client'});return s;}
 const pack=(count=2,volume=5,unitPrice=300,kind='canister')=>({kind,volume,count,unitPrice});
 const buy=(spec=pack())=>({type:'purchase',partyId:'supplier',account:'cash',paid:0,lines:[{id:'oil',packaging:spec,retail:100,wholesale:90}]});
 const sale=(qty,packaging)=>({type:'sale',partyId:'client',account:'cash',paid:0,lines:[{id:'oil',qty,price:100,...(packaging?{packaging,saleMode:'sealed'}:{saleMode:'bulk'})}]});
 const bal=s=>packageBalance(s,s.products.find(p=>p.id==='oil'));
 function check(s){const b=bal(s);assert.ok(b.looseLitres>=-.00001);assert.equal(Math.round((b.sealedLitres+b.openedLitres+b.looseLitres)*1000),Math.round(s.products.find(p=>p.id==='oil').qty*1000));assert.ok(b.lots.every(l=>Number.isInteger(l.sealed)&&l.sealed>=0&&l.opened.every(n=>n>0&&n<=l.volume)));}
 let s=setup(),original=structuredClone(s);s=apply(s,buy(),{id:'purchase1'});assert.deepEqual(original,setup());assert.equal(s.products[0].qty,10);assert.equal(s.products[0].cost,60);assert.equal(s.products[0].price,100);assert.equal(s.entries.at(-1).total,600);assert.equal(bal(s).sealed,2);check(s);
 const purchased=structuredClone(s);s=apply(s,sale(2),{id:'sale-bulk'});assert.equal(s.products[0].qty,8);assert.equal(bal(s).sealed,1);assert.deepEqual(bal(s).lots[0].opened,[3]);assert.equal(totals(s).profit,80);check(s);
 s=apply(s,sale(5,pack(1,5,480)),{id:'sale-sealed'});assert.equal(s.products[0].qty,3);assert.equal(bal(s).sealed,0);assert.deepEqual(bal(s).lots[0].opened,[3]);assert.equal(totals(s).profit,260);check(s);
 assert.throws(()=>apply(s,sale(5,pack(1,5,480))),/Недостаточно/);assert.throws(()=>apply(s,sale(4)),/Недостаточно/);
 s=apply(s,{type:'return',target:'sale-sealed',account:'cash',lines:[{id:'oil',qty:5,returnSealed:true}]});assert.equal(bal(s).sealed,1);assert.equal(totals(s).profit,80);check(s);
 s=apply(s,{type:'return',target:'sale-bulk',account:'cash',lines:[{id:'oil',qty:1}]});assert.equal(bal(s).looseLitres,1);assert.equal(totals(s).profit,40);check(s);
 assert.throws(()=>apply(s,{type:'return',target:'sale-bulk',account:'cash',lines:[{id:'oil',qty:1,returnSealed:true}]}),/нет запечатанной/);
 // A returned opened canister becomes loose oil, not sealed stock.
 let openedReturn=apply(purchased,sale(5,pack(1,5,480)),{id:'opened-return-sale'});openedReturn=apply(openedReturn,{type:'return',target:'opened-return-sale',account:'cash',lines:[{id:'oil',qty:5}]});assert.equal(bal(openedReturn).sealed,1);assert.equal(bal(openedReturn).looseLitres,5);check(openedReturn);
 // Draft autosave, post-once, undo/delete/restore and supplier returns.
 let draft=apply(setup(),{type:'draft_new',partyId:'supplier'},{id:'draft'});draft=apply(draft,{...buy(),type:'draft_save',id:'draft'});assert.equal(draft.products[0].qty,0);assert.equal(draft.packageLots,undefined);assert.equal(draft.entries.at(-1).lines[0].packaging.count,2);
 draft=apply(draft,{...buy(),type:'draft_post',id:'draft'});assert.equal(bal(draft).sealed,2);assert.throws(()=>apply(draft,{...buy(),type:'draft_post',id:'draft'}));
 let undo=apply(draft,{type:'unpost_purchase',id:'draft'});assert.equal(undo.products[0].qty,0);assert.equal(bal(undo).sealed,0);
 let deleted=apply(draft,{type:'delete_purchase',id:'draft'});assert.equal(bal(deleted).sealed,0);deleted=apply(deleted,{type:'restore_purchase',id:'draft'});assert.equal(bal(deleted).sealed,2);check(deleted);
 let ret=apply(draft,{type:'return',target:'draft',account:'cash',lines:[{id:'oil',qty:10}]});assert.equal(bal(ret).sealed,0);ret=apply(ret,{type:'unpost_purchase',id:'draft'});assert.equal(ret.products[0].qty,0);check(ret);
 assert.throws(()=>apply(apply(draft,sale(1)),{type:'unpost_purchase',id:'draft'}),/другие проведённые/);
 assert.throws(()=>apply(draft,{type:'return',target:'draft',account:'cash',lines:[{id:'oil',qty:1}]}),/целые невскрытые/);
 // Old stock remains loose with unchanged identity and price, weighted cost still applies.
 let old=setup();old.products[0].qty=3;old.products[0].cost=40;old.stockSources.balances.oil={paid:0,credit:0,unknown:3};const preserved=structuredClone(old);old=apply(old,buy());assert.equal(old.products[0].qty,13);assert.equal(bal(old).looseLitres,3);assert.equal(old.products[0].article,'TEST');assert.equal(old.products[0].cost,720/13);assert.deepEqual(preserved.products[0].qty,3);old=apply(old,{...sale(2),lines:[{...sale(2).lines[0],stockOrigin:'unknown'}]});assert.equal(bal(old).sealed,2);assert.equal(bal(old).looseLitres,1);check(old);
 // Barrel, precision, discounts, stock adjustments, and boundary validation.
 let barrel=apply(setup(),buy(pack(1,200,10000,'barrel')));barrel=apply(barrel,sale(4.5));assert.equal(bal(barrel).openedLitres,195.5);assert.equal(barrel.entries.at(-1).cost,225);check(barrel);
 let fractional=apply(setup(),buy(pack(2,7,100)));assert.equal(fractional.entries.at(-1).total,200);fractional=apply(fractional,sale(7,pack(1,7,150)));assert.equal(fractional.entries.at(-1).total,150);assert.equal(totals(fractional).profit,50);check(fractional);
 let discounted=apply(setup(),{...buy(),discountMode:'percent',discountValue:10,lines:[{id:'oil',packaging:pack(),discount:100,expense:2}]});assert.equal(discounted.entries.at(-1).total,450);assert.equal(discounted.products[0].cost,47);assert.equal(totals(apply(discounted,sale(1))).profit,53);
 let adjusted=apply(purchased,{type:'writeoff',note:'test',lines:[{id:'oil',qty:1}]});assert.equal(bal(adjusted).openedLitres,4);adjusted=apply(adjusted,{type:'inventory',note:'test',lines:[{id:'oil',qty:11}]});assert.equal(bal(adjusted).looseLitres,2);check(adjusted);
 for(const bad of [pack(1.5),pack(0),pack(1,0),pack(1,5,-1),{...pack(),kind:'invalid'}])assert.throws(()=>apply(setup(),buy(bad)));
 let piece=setup();piece.products[0].unit='шт';assert.throws(()=>apply(piece,buy()),/литрах/);
 // Offline receipts preserve package mode and count; projections carry no purchase costs.
 const projection=cashierProjection(purchased);assert.equal(projection.products[0].cost,0);assert.equal(projection.packageLots[0].sealed,2);
 let cache={base:projection,version:1,pending:[],lastSync:''};const action=sale(5,pack(1,5,480));assert.equal(cleanCashierAction(action).lines[0].packaging.count,1);cache=enqueueCashier(cache,action);assert.equal(bal(localCashierState(cache)).sealed,1);cache=enqueueCashier(cache,sale(2));assert.equal(bal(localCashierState(cache)).openedLitres,3);check(localCashierState(cache));
 assert.deepEqual(normalize(preserved),preserved,'legacy state has no packaging migration');
 // Editing a draft replaces its package quantity/cost; posting counts only the final edit.
 let edited=apply(setup(),{type:'draft_new',partyId:'supplier'},{id:'edit-draft'});
 edited=apply(edited,{...buy(),type:'draft_save',id:'edit-draft'});
 edited=apply(edited,{...buy(pack(1,200,10000,'barrel')),type:'draft_save',id:'edit-draft'});
 assert.equal(edited.products[0].qty,0);
 edited=apply(edited,{...buy(pack(1,200,10000,'barrel')),type:'draft_post',id:'edit-draft'});
 assert.equal(edited.products[0].qty,200);assert.equal(edited.products[0].cost,50);
 edited=apply(edited,{type:'unpost_purchase',id:'edit-draft'});
 edited=apply(edited,{...buy(pack(3,5,250)),type:'draft_post',id:'edit-draft'});
 assert.equal(edited.products[0].qty,15);assert.equal(bal(edited).sealed,3);assert.equal(edited.entries.at(-1).total,750);check(edited);
 // Entire sealed barrel sale and fully paid cashier scenario use the same ledger.
 let wholeBarrel=apply(setup(),buy(pack(1,200,10000,'barrel')));
 wholeBarrel=apply(wholeBarrel,sale(200,pack(1,200,14000,'barrel')));
 assert.equal(wholeBarrel.products[0].qty,0);assert.equal(totals(wholeBarrel).profit,4000);check(wholeBarrel);
 let paid=apply(setup(),{...buy(),paid:600});paid=apply(paid,{...sale(2),paid:200});paid=apply(paid,{...sale(5,pack(1,5,480)),paid:480});
 assert.equal(paid.products[0].qty,3);assert.equal(totals(paid).revenue,680);assert.equal(totals(paid).cost,420);assert.equal(totals(paid).profit,260);assert.equal(totals(paid).stock,180);check(paid);
 // Old documents/stock/prices survive normalization without invented packaging.
 const legacy=apply(setup(),{type:'purchase',partyId:'supplier',account:'cash',paid:0,lines:[{id:'oil',qty:8,price:45,retail:100,wholesale:90}]});
 const legacyBefore=structuredClone(legacy);assert.deepEqual(normalize(legacy),legacyBefore);
 const afterNewPurchase=apply(legacy,buy());assert.deepEqual(afterNewPurchase.entries.slice(0,legacyBefore.entries.length),legacyBefore.entries);
 assert.equal(afterNewPurchase.products[0].price,legacyBefore.products[0].price);assert.equal(afterNewPurchase.products[0].qty,18);assert.equal(bal(afterNewPurchase).looseLitres,8);
 console.log('PASS: packaged receipts, 5L canister/200L barrel, sealed vs bulk stock, opened containers, weighted costs/profit, returns, draft and rollback, legacy preservation, offline package operations');
}finally{await rm(dir,{recursive:true,force:true})}
