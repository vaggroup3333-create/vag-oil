import assert from 'node:assert/strict';
import {readFile,writeFile,mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';
import ts from 'typescript';
const dir=await mkdtemp(join(tmpdir(),'draft-save-'));
try{
 const source=await readFile(new URL('../lib/draft-autosave.ts',import.meta.url),'utf8');
 await writeFile(join(dir,'queue.mjs'),ts.transpileModule(source,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext}}).outputText);
 const {DraftSaveQueue}=await import(pathToFileURL(join(dir,'queue.mjs')));
 const saved=[];let release;let concurrent=0,max=0;
 const queue=new DraftSaveQueue(async value=>{concurrent++;max=Math.max(max,concurrent);saved.push(value);if(value.qty===1)await new Promise(resolve=>release=resolve);concurrent--;return true});
 queue.update({qty:1});const first=queue.flush();queue.update({qty:2});const closing=queue.flush();release();
 assert.equal(await first,true);assert.equal(await closing,true);assert.deepEqual(saved,[{qty:1},{qty:2}]);assert.equal(max,1);assert.equal(queue.dirty,false);
 queue.update({qty:2});await queue.flush();assert.equal(saved.length,2);
 let works=false;const failed=new DraftSaveQueue(async()=>works);failed.update({qty:3});assert.equal(await failed.flush(),false);assert.equal(failed.dirty,true);works=true;assert.equal(await failed.flush(),true);assert.equal(failed.dirty,false);
 console.log('PASS: edits during saving are persisted in order; closing waits for latest edit; unchanged drafts do not resave; failed saves stay dirty and can retry');
}finally{await rm(dir,{recursive:true,force:true})}
