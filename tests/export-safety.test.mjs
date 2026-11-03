import assert from 'node:assert/strict';
import ts from 'typescript';
import {readFile,writeFile,mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';
const dir=await mkdtemp(join(tmpdir(),'oil-export-'));
try{
 for(const name of ['packaging','legacy-ledger','opening-stock','paid-stock','paid-stock-costs','paid-stock-draft','draft-stock','stock-advances','stock-sources','invoice-duplicates','ledger','backup-export','csv-export']){
  const src=await readFile(new URL('../lib/'+name+'.ts',import.meta.url),'utf8');
  const js=ts.transpileModule(src,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext}}).outputText.replace(/from '\.\/([^']+)'/g,"from './$1.mjs'").replaceAll("'./opening-stock'","'./opening-stock.mjs'").replaceAll("'./packaging'","'./packaging.mjs'").replaceAll("'./ledger'","'./ledger.mjs'").replaceAll("'./legacy-ledger'","'./legacy-ledger.mjs'");
  await writeFile(join(dir,name+'.mjs'),js);
 }
 const {fetchBackup}=await import(pathToFileURL(join(dir,'backup-export.mjs')));
 const {initial}=await import(pathToFileURL(join(dir,'ledger.mjs')));
 const {csvCell}=await import(pathToFileURL(join(dir,'csv-export.mjs')));
 const state=initial(false);let calls=0;
 const result=await fetchBackup('live',async(url,options)=>{calls++;assert.equal(url,'/vag-oil/api/store?mode=live');assert.equal(options.cache,'no-store');return Response.json({data:state,version:211})});
 assert.equal(calls,1);assert.equal(result.mode,'live');assert.equal(result.version,211);assert.deepEqual(result.products,state.products);assert.ok(result.exported);
 await assert.rejects(()=>fetchBackup('live',async()=>{throw Error('offline')}),/offline/);
 await assert.rejects(()=>fetchBackup('live',async()=>Response.json({error:'Войдите'},{status:401})),/Войдите/);
 await assert.rejects(()=>fetchBackup('live',async()=>Response.json({data:{products:[]},version:1})),/неполная/);
 await assert.rejects(()=>fetchBackup('wrong',async()=>{throw Error('must not fetch')}),/рабочий учёт/);
 assert.equal(csvCell('-120 TJS'),'"\'-120 TJS"');assert.equal(csvCell('-42'),'"\'-42"');
 assert.equal(csvCell('+992123'),'"\'+992123"');assert.equal(csvCell('=1+1'),'"\'=1+1"');
 assert.equal(csvCell('  =1+1'),'"\'  =1+1"');assert.equal(csvCell('A"B'),'"A""B"');
 assert.equal(csvCell(0),'"0"');assert.equal(csvCell(null),'""');
 const page=await readFile(new URL('../app/page.tsx',import.meta.url),'utf8');
 assert.equal(page.split('<PasswordSettings target="cashier"/>').length-1,1);
 assert.ok(page.includes("const mode='live'"));
 assert.ok(page.includes('if(lock.current||!ready||modal)return;'));
 assert.ok(!page.includes('replace(/^[=+@-]/'));
 console.log('PASS: backup uses fresh uncached server snapshot and fails closed; CSV retains minus/plus and blocks formulas; live-only mode and backup protect open forms; single cashier-password section');
}finally{await rm(dir,{recursive:true,force:true})}
