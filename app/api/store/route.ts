import {draftStock} from '../../../lib/draft-stock';
import { env } from 'cloudflare:workers';
import {savePaidStockDraft} from '../../../lib/paid-stock-store';
import {workingModeError} from '../../../lib/working-ledger';
import {sessionPrincipal} from '../../../lib/password-auth';
import {isSameOrigin} from '../../../lib/request-security';
import {initial,apply,normalize,purchaseUnpostReason} from '../../../lib/ledger';
export const dynamic='force-dynamic';
export async function GET(req:Request){return handle(req,false)}
export async function POST(req:Request){return handle(req,true)}
async function handle(req:Request,write:boolean){
 const principal=await sessionPrincipal(req,env);if(!principal)return Response.json({error:'Войдите по логину и паролю'},{status:401});
 if(principal.role==='cashier')return Response.json({error:'Кассиру доступен только интерфейс кассы'},{status:403});
 const user=principal.owner;
 const modeError=workingModeError(req);if(modeError)return modeError;const key=user+':live';const db=env.DB!;
 try{
 await db.prepare('INSERT OR IGNORE INTO ledgers (id,data,version) VALUES (?,?,0)').bind(key,JSON.stringify(initial(false))).run();
 const row=await db.prepare('SELECT data,version FROM ledgers WHERE id=?').bind(key).first<{data:string,version:number}>();
 if(!row)throw Error('Не удалось открыть учёт');let data=normalize(JSON.parse(row.data));
 if(write){if(!isSameOrigin(req))return Response.json({error:'Запрос отклонён'},{status:403});const body=await req.json() as any;if(body.action?.type==='paid_stock_draft_save'&&principal.role==='director'){const saved=await savePaidStockDraft(db,key,body.action,principal.login);return Response.json(saved,{headers:{'Cache-Control':'no-store'}});}if(body.version!==row.version)return Response.json({error:'Данные изменились. Обновите страницу и повторите.'},{status:409});if(principal.role==='administrator'){const action=body.action as any,allowed=['cancel_draft','category','draft_new','draft_post','draft_save','favorite','inventory','party','product','sale','service','unpost_purchase','writeoff'];if(!action||!allowed.includes(action.type))return Response.json({error:'Эта операция доступна только директору'},{status:403});if(action.type==='unpost_purchase'){const entry=data.entries.find((e:any)=>e.id===action.id&&e.type==='purchase');if(!entry||Number(entry.paid||0)!==0||Number(entry.initialPaid||0)!==0||data.payments.some((p:any)=>p.target===entry.id))return Response.json({error:'Администратор может возвращать в черновик только накладные без платежей. Денежные операции выполняет директор.'},{status:403});const reason=purchaseUnpostReason(data,entry);if(reason)return Response.json({error:reason},{status:403});}if(action.type==='draft_post'&&Number(data.entries.find((e:any)=>e.id===action.id)?.draftPaid||0)!==0)return Response.json({error:'В черновике запланирована оплата. Проведение доступно директору.'},{status:403});if(['sale','draft_post'].includes(action.type)){const paid=Number(action.paid||0),received=Number(action.received||0),expenses=(action.lines||[]).reduce((n:number,line:any)=>n+Number(line.expense||0)*Number(line.qty||0),0);if(paid!==0||received!==0||expenses!==0||action.paymentMethod&&action.paymentMethod!=='debt')return Response.json({error:'Администратор может оформлять документы без оплаты и расхода из кассы. Денежные операции выполняет директор.'},{status:403});}}if(principal.role==='administrator'&&body.action.type==='draft_save'){const draft=data.entries.find((e:any)=>e.id===body.action.id&&e.status==='draft');body.action.paid=draft?.draftPaid??0;}data=apply(data,body.action,{role:principal.role,actor:principal.login});const r=await db.prepare('UPDATE ledgers SET data=?,version=version+1 WHERE id=? AND version=?').bind(JSON.stringify(data),key,row.version).run();if(!r.meta.changes)return Response.json({error:'Данные изменились. Обновите страницу.'},{status:409});}
 return Response.json({data:principal.role==='administrator'?hideFinancialData(data):data,version:row.version+(write?1:0)},{headers:{'Cache-Control':'no-store'}});
 }catch(e){return Response.json({error:(e as Error).message},{status:(e as any).code==='PAID_DRAFT_CONFLICT'?409:400});}
}

function hideFinancialData(state:any){
 const copy=structuredClone(state),moneyFields=['total','paid','credit','cost','service','discount','discountValue','expenses','received','change','draftPaid','initialPaid','refund','variance','beforeCost','afterCost','returnCostRounding'];
 copy.cashierIncomingStock=draftStock(state);
 for(const p of copy.products||[])if(p.stockValue!==undefined)p.stockValue=0;
 if(copy.stockAdvances)copy.stockAdvances=copy.stockAdvances.map((x:any)=>({...x,estimate:0,settlements:x.settlements.map((r:any)=>({...r,cost:0}))}));
 delete copy.paidStockDrafts;
 for(const entry of copy.entries||[]){
  const hideAmounts=['sale','sale_return','purchase_return','purchase_return_reversal','opening_stock','opening_stock_reversal','expense','income','receipt','payout','transfer','cash_in','cash_out','inventory','writeoff'].includes(entry.type);
  if(hideAmounts){for(const key of moneyFields)if(key in entry)entry[key]=0;for(const line of entry.lines||[]){for(const key of ['price','cost','returnCostAmount','discount','expense','retail','wholesale'])if(key in line)line[key]=0;if(line.packaging)line.packaging.unitPrice=0;}}
  else for(const key of ['paid','initialPaid','draftPaid'])if(key in entry)entry[key]=0;
  if(entry.openingStockSnapshot){entry.openingStockSnapshot.beforeCost=0;entry.openingStockSnapshot.afterCost=0;}
  for(const snapshot of entry.openingStockSnapshots||[]){snapshot.beforeCost=0;snapshot.afterCost=0;}
  for(const payment of entry.deletedPayments||[])payment.amount=0;
  for(const stock of entry.deletionStock||[])for(const key of ['beforeCost','afterCost'])stock[key]=0;
 }
 for(const payment of copy.payments||[])payment.amount=0;
 for(const shift of copy.shifts||[]){delete shift.expected;delete shift.actual;}
 return copy;
}
