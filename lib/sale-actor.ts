import type {Principal} from './password-auth';
export type SaleActor={id:string;name:string;login:string;role:'director'|'cashier'|'administrator'};
export function principalActor(principal:Principal):SaleActor{
 return {id:principal.userId||(principal.role==='cashier'?'legacy-cashier':principal.role),name:principal.name||(principal.role==='cashier'?'Общий кассир':principal.role==='director'?'Директор':'Администратор'),login:principal.login,role:principal.role};
}
export const actorLabel=(actor?:SaleActor)=>actor?.name||'Не указан';
// Submitted names are never trusted. Old unsent checks remain unattributed.
export async function operationActor(db:D1Database,principal:Principal,id:unknown):Promise<SaleActor|undefined>{
 if(id===undefined)return undefined;
 const current=principalActor(principal);
 if(id===current.id)return current;
 if(principal.role!=='director')throw Error('Этот чек принадлежит другому кассиру. Войдите под его логином или как директор.');
 if(id==='legacy-cashier')return {id,name:'Общий кассир',login:'cashier',role:'cashier'};
 if(id==='administrator')return {id,name:'Администратор',login:'administrator',role:'administrator'};
 if(typeof id!=='string')throw Error('Не удалось определить кассира');
 const user=await db.prepare('SELECT id,login,name FROM pos_cashiers WHERE id=?').bind(id).first<{id:string,login:string,name:string}>();
 if(!user)throw Error('Учётная запись автора чека не найдена');
 return {...user,role:'cashier'};
}
