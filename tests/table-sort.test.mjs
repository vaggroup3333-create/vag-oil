import assert from 'node:assert/strict';
import {readFile,writeFile,mkdtemp,rm} from 'node:fs/promises';
import {stripTypeScriptTypes} from 'node:module';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';
const dir=await mkdtemp(join(tmpdir(),'vag-report-sort-'));
try{
 await writeFile(join(dir,'sort.mjs'),stripTypeScriptTypes(await readFile(new URL('../lib/table-sort.ts',import.meta.url),'utf8')));
 const {compareReportCells:cmp}=await import(pathToFileURL(join(dir,'sort.mjs')));
 const ordered=['31.12.2025, 23:59','01.01.2026, 00:00','30.09.2026, 13:00','01.10.2026, 09:00','01.10.2026, 12:00'];
 assert.deepEqual(ordered.slice().reverse().sort(cmp),ordered);
 assert.ok(cmp('2026-09-30','2026-10-01')<0);
 assert.ok(cmp('-1 200,5 TJS','50 TJS')<0);
 assert.ok(cmp('590','1 000')<0);
 assert.ok(cmp('10 шт.','2 шт.')>0);
 assert.ok(cmp('SB333','SB123')>0);
 assert.equal(cmp('0','0'),0);
 const page=await readFile(new URL('../app/page.tsx',import.meta.url),'utf8');
 assert.ok(page.includes('setHidden([]);setPage(0);setSort(null)'));
 assert.ok(page.includes('compareReportCells(x,y)'));
 console.log('PASS: chronological dates across months/years, numeric money/quantity, article sorting, column settings reset for different reports');
}finally{await rm(dir,{recursive:true,force:true})}
