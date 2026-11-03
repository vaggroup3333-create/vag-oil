import assert from 'node:assert/strict';import {DatabaseSync} from 'node:sqlite';import {stripTypeScriptTypes} from 'node:module';
import {readFile,writeFile,mkdtemp,rm} from 'node:fs/promises';import {tmpdir} from 'node:os';import {join} from 'node:path';import {pathToFileURL} from 'node:url';
const dir=await mkdtemp(join(tmpdir(),'vag-legacy-recovery-'));
try{
 for(const name of ['legacy-ledger','packaging','opening-stock','paid-stock','paid-stock-costs','paid-stock-draft','paid-stock-store','paid-stock-save-recovery','draft-stock','stock-advances','stock-sources','invoice-duplicates','ledger'])await writeFile(join(dir,name+'.mjs'),stripTypeScriptTypes(await readFile(new URL('../lib/'+name+'.ts',import.meta.url),'utf8')).replace(/from '\.\/([^']+)'/g,"from './$1.mjs'"));
 const L=await import(pathToFileURL(join(dir,'ledger.mjs'))),S=await import(pathToFileURL(join(dir,'paid-stock-store.mjs'))),R=await import(pathToFileURL(join(dir,'paid-stock-save-recovery.mjs')));
 class Database{
  sql=new DatabaseSync(':memory:');
  prepare(query){const db=this;return {bind(...args){return {
   async first(){return db.sql.prepare(query).get(...args)||null},
   async run(){const r=db.sql.prepare(query).run(...args);return {meta:{changes:Number(r.changes)}}}
  }}}}
 }
 const db=new Database();db.sql.exec('CREATE TABLE ledgers (id TEXT PRIMARY KEY,data TEXT NOT NULL,version INTEGER NOT NULL)');
 const id=crypto.randomUUID(),row={key:crypto.randomUUID(),qty:'2',cost:'25',product:{name:'Учебный фильтр',article:'TEST',barcode:'',qrCode:'',unit:'шт',category:'Фильтры',price:'30',wholesale:''}};
 let state=L.initial(false);state=L.apply(state,{type:'paid_stock_draft_new',id},{role:'director'});state=L.apply(state,{type:'paid_stock_draft_save',id,revision:0,date:'2026-10-30',title:'Только проверка',rows:[row]},{role:'director'});
 const current=state.paidStockDrafts[0];db.sql.prepare('INSERT INTO ledgers VALUES (?,?,?)').run('owner:live',JSON.stringify(state),10);
 const pending={...current,type:'paid_stock_draft_save',revision:0,rows:[{...row,cost:'27'}]},before=db.sql.prepare('SELECT * FROM ledgers').get();
 await assert.rejects(()=>S.savePaidStockDraft(db,'owner:live',pending,'director'),/сохранены отдельно/);
 assert.deepEqual(db.sql.prepare('SELECT * FROM ledgers').get(),before);
 let recovery=db.sql.prepare('SELECT * FROM pos_paid_stock_save_recovery').get();assert.equal(JSON.parse(recovery.payload).rows[0].cost,'27');assert.equal(recovery.server_revision,1);assert.equal(recovery.fingerprint.length,64);
 const latest={...pending,rows:[{...row,cost:'29'}]};await assert.rejects(()=>S.savePaidStockDraft(db,'owner:live',latest,'director'),/сохранены отдельно/);
 recovery=db.sql.prepare('SELECT * FROM pos_paid_stock_save_recovery').get();assert.equal(JSON.parse(recovery.payload).rows[0].cost,'29');assert.equal(db.sql.prepare('SELECT count(*) AS n FROM pos_paid_stock_save_recovery').get().n,1);
 await R.capturePaidStockSaveRecovery(db,'other-owner:live',pending,1);assert.equal(db.sql.prepare('SELECT count(*) AS n FROM pos_paid_stock_save_recovery').get().n,2);
 assert.equal(await R.capturePaidStockSaveRecovery(db,'owner:live',{...pending,rows:Array.from({length:301},()=>row)},1),false);
 assert.equal(await R.capturePaidStockSaveRecovery(db,'owner:live',{...pending,rows:[{...row,extra:'x'.repeat(512001)}]},1),false);
 await S.savePaidStockDraft(db,'owner:live',{...current,type:'paid_stock_draft_save'},'director');assert.deepEqual(db.sql.prepare('SELECT * FROM ledgers').get(),before);
 db.sql.close();console.log('PASS: rejected legacy fields retained separately; live ledger unchanged; latest attempt preserved; owner isolation; bounded payload; normal retry unaffected.');
}finally{await rm(dir,{recursive:true,force:true})}
