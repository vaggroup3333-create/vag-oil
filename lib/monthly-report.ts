import type {State} from './ledger';
import {posted,round,totals} from './ledger';
import {balanceAt,inPeriod,localDay,partyStatement} from './reporting';
import {supplierSales,supplierRowsSummary} from './supplier-sales';
import {csvCell} from './csv-export';

export function monthRange(month:string){
 if(!/^[1-9]\d{3}-(0[1-9]|1[0-2])$/.test(month))throw new Error('Выберите месяц отчёта');
 const [year,m]=month.split('-').map(Number);
 return {from:month+'-01',to:new Date(Date.UTC(year,m,0)).toISOString().slice(0,10),previousDay:new Date(Date.UTC(year,m-1,0)).toISOString().slice(0,10)};
}
export function shiftMonth(month:string,delta:number){const {from}=monthRange(month);const d=new Date(from+'T12:00:00Z');d.setUTCMonth(d.getUTCMonth()+delta);return d.toISOString().slice(0,7)}
export const monthName=(month:string)=>new Date(monthRange(month).from+'T12:00:00Z').toLocaleDateString('ru-RU',{month:'long',year:'numeric',timeZone:'Asia/Dushanbe'});
export const monthlyMoney=(value:number)=>new Intl.NumberFormat('ru-RU',{minimumFractionDigits:2,maximumFractionDigits:2}).format(value)+' с';
export const monthlyQty=(values:Record<string,number>)=>Object.entries(values).filter(([,value])=>value!==0).map(([unit,value])=>new Intl.NumberFormat('ru-RU',{maximumFractionDigits:3}).format(value)+' '+unit).join(' · ')||'0';
export const monthlyDate=(value:string)=>value.slice(0,10).split('-').reverse().join('.');

export function monthlyReport(s:State,month:string,generatedAt=new Date().toISOString()){
 const range=monthRange(month),today=localDay(generatedAt);
 if(range.from>today)throw new Error('Этот месяц ещё не начался');
 const to=range.to>today?today:range.to,ongoing=month===today.slice(0,7);
 const period=totals(s,range.from,to),opening=balanceAt(s,range.previousDay),closing=balanceAt(s,to);
 // Internal transfers are excluded from both flow columns, while the net cash balance remains identical.
 const payments=s.payments.filter(p=>inPeriod(p.date,range.from,to)&&p.kind!=='transfer');
 const incoming=round(payments.reduce((sum,p)=>sum+Math.max(0,p.amount),0));
 const outgoing=round(payments.reduce((sum,p)=>sum+Math.max(0,-p.amount),0));
 const draftCount=s.entries.filter(e=>e.type==='purchase'&&e.status==='draft'&&localDay(e.date)<=to).length+(s.paidStockDrafts||[]).filter(d=>d.rows.length>0&&d.date.slice(0,10)<=to).length;
 const pendingIds=new Set((s.stockAdvances||[]).filter(a=>a.remaining>.000001).map(a=>a.saleId));
 const pendingCount=s.entries.filter(e=>posted(e)&&inPeriod(e.date,range.from,to)&&(e.costPending||pendingIds.has(e.id))).length;
 const suppliers=supplierSales(s,range.from,to).map(g=>({id:g.id,name:g.name,...supplierRowsSummary(g.rows)}));
 const debts=s.parties.filter(p=>p.kind==='supplier'||p.kind==='client').map(p=>{
  const st=partyStatement(s,p.kind==='supplier'?'purchase':'sale',p.id,range.from,to);
  return {id:p.id,name:p.name,kind:p.kind,opening:st.opening,closing:st.closing};
 }).filter(p=>p.opening!==0||p.closing!==0);
 const warnings=[...(ongoing?['Месяц ещё не закончен. Показаны операции по '+monthlyDate(to)+'.']:[]),...(pendingCount?['Продажи до прихода: '+pendingCount+'. Себестоимость и прибыль предварительные. Проведите соответствующие накладные.']:[]),...(draftCount?['Непроведённые накладные с датой до конца периода: '+draftCount+'. Они не включены в отчёт. Проверьте фактически полученные товары.']:[])];
 return {month,title:monthName(month),shop:s.settings.name,generatedAt,from:range.from,to,monthEnd:range.to,ongoing,period,opening,closing,cash:{opening:opening.cash,incoming,outgoing,closing:closing.cash},suppliers,debts,draftCount,pendingCount,warnings};
}
export type MonthlyReportData=ReturnType<typeof monthlyReport>;
export function monthlySections(r:MonthlyReportData){return [
 {title:'Результат месяца',heads:['Показатель','Сумма'],rows:[['Выручка за вычетом возвратов',r.period.revenue],['Себестоимость проданного',r.period.cost],['Расходы магазина',r.period.expenses],['Прочие доходы',r.period.income],['Результат корректировок склада',r.period.adjustments],['Прибыль',r.period.profit]].map(([label,value])=>[String(label),monthlyMoney(Number(value))])},
 {title:'Деньги во всех кассах',heads:['Показатель','Сумма'],rows:[['На начало месяца',r.cash.opening],['Поступило за период',r.cash.incoming],['Списано за период',r.cash.outgoing],['На конец периода',r.cash.closing]].map(([label,value])=>[String(label),monthlyMoney(Number(value))])},
 {title:'Остатки и долги',heads:['Показатель','На начало','На конец'],rows:[['Товары по себестоимости','stock'],['Клиенты должны магазину','customerDebt'],['Магазин должен поставщикам и владельцу','supplierDebt']].map(([label,key])=>[label,monthlyMoney(r.opening[key as 'stock'|'customerDebt'|'supplierDebt']),monthlyMoney(r.closing[key as 'stock'|'customerDebt'|'supplierDebt'])])},
 {title:'Продажи по поставщикам',heads:['Поставщик','Продано за вычетом возвратов','Себестоимость','Продажи'],rows:r.suppliers.map(g=>[g.name,monthlyQty(g.net),monthlyMoney(g.cost),monthlyMoney(g.revenue)])},
 {title:'Кому должен магазин',heads:['Поставщик / владелец','На начало','На конец'],rows:r.debts.filter(p=>p.kind==='supplier').map(p=>[p.name,monthlyMoney(p.opening),monthlyMoney(p.closing)])},
 {title:'Кто должен магазину',heads:['Клиент','На начало','На конец'],rows:r.debts.filter(p=>p.kind==='client').map(p=>[p.name,monthlyMoney(p.opening),monthlyMoney(p.closing)])},
 ];}
export const monthlyExplanation='Прибыль учитывает продажи в долг. Деньги в кассах показаны отдельно. Оплата поставщикам и возврат долга владельцу уменьшают кассу и долг, но не уменьшают прибыль повторно. Переводы между своими кассами не включены в поступления и списания.';
export const monthlySourceNote='Расчёт по датам документов и оплат, часовой пояс Душанбе (UTC+5). Сохранённый файл — копия на момент формирования; документы месяца не блокируются. Последующие исправления могут изменить отчёт в программе. Продажи по поставщикам не включают услуги; неопределённые источники показаны отдельно.';
export function monthlyCSV(r:MonthlyReportData){
 const rows:(string|number)[][]=[['Месячный отчёт',r.title],['Магазин',r.shop],['Период',monthlyDate(r.from)+' — '+monthlyDate(r.to)],['Сформирован',r.generatedAt],['Чеков продажи',r.period.count],...r.warnings.map(w=>['Примечание',w])];
 for(const section of monthlySections(r))rows.push([], [section.title],section.heads,...section.rows);
 rows.push([], [monthlyExplanation],[monthlySourceNote]);
 return '\uFEFF'+rows.map(row=>row.map(csvCell).join(';')).join('\r\n');
}
const escapeHTML=(v:unknown)=>String(v).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]!));
export function monthlyHTML(r:MonthlyReportData){
 const h=escapeHTML;
 return '<!doctype html><html lang="ru"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>'+h(r.shop)+' — '+h(r.title)+'</title><style>body{font:16px/1.5 system-ui,sans-serif;color:#203d47;background:#f2f6f8;margin:0;padding:24px}main{max-width:980px;margin:auto;background:white;padding:28px;border-radius:16px}h1{margin:0;color:#15565c}h2{font-size:20px;margin-top:28px}p{color:#536773}.warn{background:#fff3d6;padding:12px;border-radius:8px}table{width:100%;border-collapse:collapse;font-size:14px}th,td{text-align:left;padding:10px;border:1px solid #dce5eb;overflow-wrap:anywhere}th{background:#edf5f6}td:not(:first-child){font-variant-numeric:tabular-nums}section{overflow-x:auto}small{color:#566a74}@media(max-width:500px){body{padding:6px}main{padding:12px}th,td{padding:6px;font-size:12px}}@media print{body{background:white;padding:0}main{padding:0}thead{display:table-header-group}tr{break-inside:avoid}h2{break-after:avoid}section{overflow:visible}@page{size:A4;margin:12mm}}</style></head><body><main><h1>Месячный отчёт · '+h(r.title)+'</h1><p>'+h(r.shop)+' · '+h(monthlyDate(r.from))+' — '+h(monthlyDate(r.to))+'</p><p>Сформирован: '+h(new Date(r.generatedAt).toLocaleString('ru-RU',{timeZone:'Asia/Dushanbe'}))+' (Душанбе). Чеков продажи: '+r.period.count+'.</p>'+r.warnings.map(w=>'<p class="warn">'+h(w)+'</p>').join('')+monthlySections(r).map(section=>'<section><h2>'+h(section.title)+'</h2><table><thead><tr>'+section.heads.map(c=>'<th>'+h(c)+'</th>').join('')+'</tr></thead><tbody>'+(section.rows.length?section.rows.map(row=>'<tr>'+row.map(c=>'<td>'+h(c)+'</td>').join('')+'</tr>').join(''):'<tr><td colspan="'+section.heads.length+'">Нет данных за период</td></tr>')+'</tbody></table></section>').join('')+'<p>'+h(monthlyExplanation)+'</p><small>'+h(monthlySourceNote)+'</small></main></body></html>';
}
