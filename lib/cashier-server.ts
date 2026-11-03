import {initial,normalize,apply,State,round} from './ledger';
import {workingModeError} from './working-ledger';
import {cashierProjection,validateCashierAction,cleanCashierAction,uuidPattern,applyCashierAction} from './cashier-protocol';
import {digest} from './password-auth';
import {isSameOrigin} from './request-security';
const headers={'Cache-Control':'no-store'};
export async function prepareCashier(db:D1Database){await db.prepare('CREATE TABLE IF NOT EXISTS pos_cashier_operations (ledger_id TEXT NOT NULL, op_id TEXT NOT NULL, payload_hash TEXT NOT NULL, entry_id TEXT NOT NULL, received_at TEXT NOT NULL, PRIMARY KEY(ledger_id,op_id))').run()}
async function read(db:D1Database,key:string,demo:boolean){
 await db.prepare('INSERT OR IGNORE INTO ledgers (id,data,version) VALUES (?,?,0)').bind(key,JSON.stringify(initial(demo))).run();
 const row=await db.prepare('SELECT data,version FROM ledgers WHERE id=?').bind(key).first<{data:string,version:number}>();if(!row)throw Error('Учёт не найден');return {...row,data:normalize(JSON.parse(row.data))};
}
const response=(data:State,version:number,ackId?:string)=>Response.json({data:cashierProjection(data),version,ackId},{headers});
export async function cashierStore(req:Request,db:D1Database,owner:string){
 const modeError=workingModeError(req);if(modeError)return modeError;const demo=false,key=owner+':live';
 try{
  await prepareCashier(db);await db.prepare('CREATE TABLE IF NOT EXISTS pos_ledger_resets (ledger_id TEXT PRIMARY KEY, reset_at TEXT NOT NULL, reset_id TEXT NOT NULL)').run();const reset=await db.prepare('SELECT reset_at FROM pos_ledger_resets WHERE ledger_id=?').bind(key).first<{reset_at:string}>();const resetAt=reset?.reset_at||'';
  const respond=(data:State,version:number,ackId?:string)=>Response.json({data:cashierProjection(data),version,ackId,resetAt},{headers});
  if(req.method==='GET'){const row=await read(db,key,demo);return respond(row.data,row.version)}
  if(req.method!=='POST'||!isSameOrigin(req))return Response.json({error:'Запрос отклонён'},{status:403,headers});
  if(!req.headers.get('content-type')?.startsWith('application/json')||Number(req.headers.get('content-length'))>131072)return Response.json({error:'Некорректный запрос'},{status:400,headers});
  const body:any=await req.json(),op=body.operation;if(resetAt&&((body.resetAt||'')!==resetAt||Date.parse(op?.createdAt)<Date.parse(resetAt)))throw Error('Учёт очищен директором. Обновите кассу: старые чеки не будут восстановлены.');
  if(!op||!uuidPattern.test(op.id)||typeof op.createdAt!=='string'||!Number.isFinite(Date.parse(op.createdAt))||Date.parse(op.createdAt)>Date.now()+300000||Date.parse(op.createdAt)<Date.now()-90*86400000)throw Error('Неверный номер или дата операции кассы');
  const payloadHash=await digest(JSON.stringify({createdAt:op.createdAt,action:op.action}));
  for(let retry=0;retry<5;retry++){
   const existing=await db.prepare('SELECT payload_hash,entry_id FROM pos_cashier_operations WHERE ledger_id=? AND op_id=?').bind(key,op.id).first<{payload_hash:string,entry_id:string}>();
   if(existing){if(existing.payload_hash!==payloadHash)return Response.json({error:'Номер операции уже использован для другого чека'},{status:409,headers});const row=await read(db,key,demo);return respond(row.data,row.version,op.id)}
   const row=await read(db,key,demo);validateCashierAction(row.data,op.action);
   if(row.data.entries.some(e=>e.id===op.id))throw Error('Номер чека уже существует');
   const action=cleanCashierAction(op.action),data=applyCashierAction(row.data,action,{id:op.id,now:op.createdAt});
   const previousPayments=new Set(row.data.payments.map(p=>p.id)),newCash=data.payments.filter(p=>!previousPayments.has(p.id)&&p.account==='cash');
   for(const shift of data.shifts.filter(shift=>shift.closed&&shift.expected!==undefined)){shift.expected=round(shift.expected!+newCash.filter(p=>Date.parse(p.date)<=Date.parse(shift.closed!)).reduce((sum,p)=>sum+p.amount,0));}

   // The ledger and acknowledgment commit in one transaction. A lost response is safe to retry.
   const result=await db.batch([
    db.prepare('UPDATE ledgers SET data=?,version=version+1 WHERE id=? AND version=?').bind(JSON.stringify(data),key,row.version),
    db.prepare('INSERT INTO pos_cashier_operations (ledger_id,op_id,payload_hash,entry_id,received_at) SELECT ?,?,?,?,? WHERE changes()=1').bind(key,op.id,payloadHash,op.id,new Date().toISOString())
   ]);
   if(result[0].meta.changes)return respond(data,row.version+1,op.id);
  }
  return Response.json({error:'Учёт занят. Чек сохранён на устройстве, повторите синхронизацию.'},{status:409,headers});
 }catch(e){return Response.json({error:(e as Error).message},{status:422,headers})}
}
