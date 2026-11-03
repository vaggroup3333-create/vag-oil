import assert from 'node:assert/strict';
import ts from 'typescript';
import {readFile,writeFile,mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';
const dir=await mkdtemp(join(tmpdir(),'vag-report-ui-'));
try{
 const compile=source=>ts.transpileModule(source,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext,jsx:ts.JsxEmit.React,jsxFactory:'__h',jsxFragmentFactory:'__Fragment'}}).outputText;
 const factory="const __h=(type,props,...children)=>({type,props:props||{},children});const __Fragment='fragment';\n";
 const names=['ledger','legacy-ledger','packaging','opening-stock','paid-stock','paid-stock-costs','paid-stock-draft','draft-stock','stock-advances','stock-sources','invoice-duplicates','reporting'];
 for(const name of names){let source=compile(await readFile(new URL('../lib/'+name+'.ts',import.meta.url),'utf8'));source=source.replace(/from '\.\/([^']+)'/g,"from './$1.mjs'");await writeFile(join(dir,name+'.mjs'),source)}
 await writeFile(join(dir,'hooks.mjs'),'export const useState=x=>[typeof x==="function"?x():x,()=>{}];');
 let extra=await readFile(new URL('../components/extra-reports.tsx',import.meta.url),'utf8');
 extra=extra.replace("import {SafeInput} from '@/components/safe-input';","const SafeInput='input';").replace("from 'react'","from './hooks.mjs'").replace(/from '\.\.\/lib\/([^']+)'/g,"from './$1.mjs'");
 await writeFile(join(dir,'extra.mjs'),factory+compile(extra));
 const {ExtraReport,extraReportNames}=await import(pathToFileURL(join(dir,'extra.mjs')));
 const L=await import(pathToFileURL(join(dir,'ledger.mjs'))),R=await import(pathToFileURL(join(dir,'reporting.mjs')));
 let s=L.initial(false);
 s=L.apply(s,{type:'product',name:'Test filter',article:'333',unit:'шт',category:'Фильтры',price:25},{id:'filter'});
 s=L.apply(s,{type:'party',name:'Supplier',kind:'supplier'},{id:'supplier'});
 s=L.apply(s,{type:'party',name:'Client',kind:'client'},{id:'client'});
 const act=(a,day)=>s=L.apply(s,a,{role:'director',now:'2026-10-'+day+'T09:00:00Z'});
 act({type:'purchase',partyId:'supplier',lines:[{id:'filter',qty:10,price:10}],paid:0},'01');
 act({type:'sale',partyId:'client',lines:[{id:'filter',qty:2,price:25}],paid:20,account:'cash'},'02');
 const sale=s.entries.at(-1).id;
 act({type:'payment',target:sale,amount:30,account:'cash'},'03');
 act({type:'return',target:sale,lines:[{id:'filter',qty:1}],account:'cash'},'04');
 const props={s,entries:s.entries,products:s.products,from:'2026-10-01',to:'2026-10-31',query:'',Table:'table',money:n=>String(n),number:n=>String(n),date:d=>d};
 const nodes=node=>!node||typeof node!=='object'?[]:Array.isArray(node)?node.flatMap(nodes):[node,...nodes(node.children||[])];
 function validate(tree){assert.doesNotMatch(JSON.stringify(tree),/NaN|Infinity/);const tables=nodes(tree).filter(n=>n.type==='table');assert.ok(tables.length);for(const table of tables)for(const row of table.props.rows)assert.equal(row.cells.length,table.props.heads.length)}
 for(const view of extraReportNames){validate(ExtraReport({...props,view}));console.log('PASS render '+view)}
 const history=nodes(ExtraReport({...props,view:'История оплаты долга'})).find(n=>n.type==='table');
 assert.equal(history.props.rows.length,1);assert.equal(history.props.rows[0].cells[4],'30');
 const methods=nodes(ExtraReport({...props,view:'Продажа по способам оплаты'})).find(n=>n.type==='table');
 assert.equal(methods.props.rows[0].cells[6],'25');
 const page=await readFile(new URL('../app/page.tsx',import.meta.url),'utf8');
 const body=page.slice(page.indexOf(' function renderReport(view:string){')).trimEnd().slice(0,-1);
 const docs=page.split('\n').find(l=>l.startsWith(' const docs='));
 const imports="import {inventoryValue,pendingStockCount} from './draft-stock.mjs';import {posted,debt,round,balance,totals} from './ledger.mjs';import {localDay,productSales,partyStatement,documentPayments,stockMovement} from './reporting.mjs';";
 const wrapper=imports+factory+"export function render(s,view,options={}){const from=options.from||'',to=options.to||'',query=options.query||'',partyFilter=options.partyFilter||'';const match=v=>v.toLowerCase().includes(query.toLowerCase());const inRange=d=>(!from||localDay(d)>=from)&&(!to||localDay(d)<=to);const products=s.products.filter(p=>match([p.name,p.code,p.article].join(' ')));const period=totals(s,from,to);const Table='table',X='icon',extraReportNames=[],setReportView=()=>{},setQuery=()=>{},setPartyFilter=()=>{},setFrom=()=>{},setTo=()=>{},open=()=>{},setDetailId=()=>{},go=()=>{},statusBadge=()=>'',docNames={sale:'Sale',purchase:'Purchase',sale_return:'Return'},money=n=>String(n),number=n=>String(n),date=d=>d;"+docs+body+"return renderReport(view)}";
 await writeFile(join(dir,'main.mjs'),compile(wrapper));
 const {render}=await import(pathToFileURL(join(dir,'main.mjs')));
 const views=['Продажа по чекам','Наш долг поставщикам','Должники','Выписка контрагентов','Выписка клиентов','Движение кассы','Остатки товаров','Движение товаров','Прибыль по дням','Прибыль по товарам','Продажа по товарам'];
 for(const view of views){validate(render(s,view));console.log('PASS render '+view)}
 const movement=nodes(render(s,'Движение товаров',{query:'333'})).find(n=>n.type==='table');
 assert.equal(movement.props.rows.length,3);
 const statement=nodes(render(s,'Выписка клиентов',{partyFilter:'client'})).find(n=>n.type==='table');
 assert.equal(statement.props.rows.at(-1).cells[5],'0');
 assert.equal(nodes(render(s,'Должники')).find(n=>n.type==='table').props.rows.length,0);
 for(const view of [...extraReportNames,...views]){
  const empty=L.initial(false);validate(extraReportNames.includes(view)?ExtraReport({...props,view,s:empty,entries:[],products:[]}):render(empty,view));
 }
 console.log('REPORT UI: 21 reports rendered with populated and empty data; refund totals, search and debt-only filters passed');
}finally{await rm(dir,{recursive:true,force:true})}
