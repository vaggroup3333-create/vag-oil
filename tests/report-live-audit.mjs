// Read-only server audit. No row payloads, identities or credentials are emitted.
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {stripTypeScriptTypes} from 'node:module';
import {readdir,readFile,writeFile,mkdtemp,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {pathToFileURL} from 'node:url';
import {createHash} from 'node:crypto';
const temp=await mkdtemp(join(tmpdir(),'vag-report-audit-'));
try{
 for(const name of ['legacy-ledger','packaging','opening-stock','paid-stock','paid-stock-costs','paid-stock-draft','draft-stock','stock-advances','stock-sources','invoice-duplicates','ledger','reporting']){
  const source=await readFile(new URL('../lib/'+name+'.ts',import.meta.url),'utf8');
  await writeFile(join(temp,name+'.mjs'),stripTypeScriptTypes(source).replace(/from '\.\/([^']+)'/g,"from './$1.mjs'"));
 }
 const L=await import(pathToFileURL(join(temp,'ledger.mjs'))),R=await import(pathToFileURL(join(temp,'reporting.mjs')));
 const folder='/var/lib/vag-oil/state/v3/d1/miniflare-D1DatabaseObject';
 const rows=[];
 for(const name of await readdir(folder)){
  if(!name.endsWith('.sqlite'))continue;
  const db=new DatabaseSync(join(folder,name),{readOnly:true});
  try{if(db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='ledgers'").get())rows.push(...db.prepare("SELECT data,version FROM ledgers WHERE id LIKE '%:live'").all())}finally{db.close()}
 }
 assert.equal(rows.length,1);
 const {data:raw,version}=rows[0],s=L.normalize(JSON.parse(raw)),before=JSON.stringify(s),issues={};let checks=0;
 const near=(a,b,name)=>{checks++;if(Math.abs(a-b)>.021)issues[name]=(issues[name]||0)+1};
 const t=L.totals(s),b=R.balanceAt(s,''),capital=L.round(t.stock+t.cash+t.customerDebt-t.supplierDebt);
 for(const key of ['stock','cash','customerDebt','supplierDebt'])near(t[key],b[key],'current_balance_'+key);
 let supplierStatement=0,clientStatement=0;
 for(const party of s.parties){
  const kind=party.kind==='supplier'?'purchase':'sale',statement=R.partyStatement(s,kind,party.id);
  near(statement.closing,statement.currentDebt,'party_statement_closing');
  if(kind==='purchase')supplierStatement+=statement.closing;else clientStatement+=statement.closing;
 }
 near(supplierStatement,t.supplierDebt,'supplier_statement_total');near(clientStatement,t.customerDebt,'customer_statement_total');
 const days=[...new Set([...s.entries.filter(L.posted).map(e=>R.localDay(e.date)),...s.payments.map(p=>R.localDay(p.date))])].sort();
 const contributions=day=>s.entries.filter(e=>L.posted(e)&&(!day||R.localDay(e.date)<=day)).reduce((n,e)=>n+(['cash_in','opening_stock'].includes(e.type)?e.total:['cash_out','opening_stock_reversal'].includes(e.type)?-e.total:0),0);
 const baseline=L.round(capital-t.profit-contributions(''));
 let dailyProfit=0,dailyRevenue=0;
 for(const day of days){const daily=L.totals(s,day,day);dailyProfit+=daily.profit;dailyRevenue+=daily.revenue;near(R.balanceAt(s,day).capital,baseline+L.totals(s,'',day).profit+contributions(day),'historical_capital');}
 near(dailyProfit,t.profit,'daily_profit');near(dailyRevenue,t.revenue,'daily_revenue');
 const metrics=s.products.map(p=>R.productSales(s.entries,p.id));
 const serviceRevenue=L.round(t.revenue-metrics.reduce((n,p)=>n+p.revenue,0));
 near(metrics.reduce((n,p)=>n+p.cost,0),t.cost,'product_cost_total');
 for(const e of s.entries.filter(e=>L.posted(e)&&['purchase','sale'].includes(e.type))){const p=R.documentPayments(s,e);near(p.net+L.debt(e),e.total-e.credit,'payment_refund_debt_equation');}
 assert.equal(JSON.stringify(s),before,'Audit helpers changed the in-memory input');
 console.log(JSON.stringify({readOnly:true,checkedUtc:new Date().toISOString(),version,sha256:createHash('sha256').update(raw).digest('hex'),checks,issues,daysChecked:days.length,totals:{...t,capital,serviceRevenue,legacyOpeningCapital:baseline}},null,2));
 if(Object.keys(issues).length)process.exitCode=1;
}finally{await rm(temp,{recursive:true,force:true})}
