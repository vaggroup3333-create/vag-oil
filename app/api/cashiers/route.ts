import {env} from 'cloudflare:workers';
import {passwordHash,secureEqual,sessionPrincipal} from '../../../lib/password-auth';
import {isSameOrigin} from '../../../lib/request-security';
export const dynamic='force-dynamic';
const headers={'Cache-Control':'no-store'};
const reply=(error:string,status=400)=>Response.json({error},{status,headers});
async function list(){return (await env.DB!.prepare('SELECT id,login,name,active,revision,created_at,updated_at FROM pos_cashiers ORDER BY active DESC,name COLLATE NOCASE').all()).results;}
export async function GET(req:Request){
 const principal=await sessionPrincipal(req,env);
 if(!principal)return reply('Войдите как директор',401);
 if(principal.role!=='director')return reply('Управлять кассирами может только директор',403);
 return Response.json({cashiers:await list(),legacyLogin:env.POS_CASHIER_LOGIN||''},{headers});
}
export async function POST(req:Request){
 if(!isSameOrigin(req)||!req.headers.get('content-type')?.startsWith('application/json'))return reply('Запрос отклонён',403);
 if(Number(req.headers.get('content-length'))>8192)return reply('Запрос слишком большой',413);
 const principal=await sessionPrincipal(req,env);
 if(!principal)return reply('Войдите как директор',401);
 if(principal.role!=='director')return reply('Управлять кассирами может только директор',403);
 try{
  const body:any=await req.json();
  const name=typeof body.name==='string'?body.name.trim():'',login=typeof body.login==='string'?body.login.trim():'';
  const password=typeof body.password==='string'?body.password:'';
  if(!name||name.length>80)return reply('Укажите имя кассира: до 80 символов');
  if(!/^[a-zA-Z0-9._-]{3,32}$/.test(login))return reply('Логин: 3–32 латинских буквы, цифры, точка, дефис или подчёркивание');
  if(typeof body.active!=='boolean')return reply('Укажите статус доступа');
  if(typeof body.currentPassword!=='string'||body.currentPassword.length>256)return reply('Введите пароль директора');
  const director=await env.DB!.prepare('SELECT hash,salt FROM pos_credentials WHERE id=1').first<{hash:string,salt:string}>();
  if(!director||!secureEqual(await passwordHash(body.currentPassword,director.salt),director.hash))return reply('Неверный пароль директора',401);
  const id=typeof body.id==='string'?body.id:'';
  const old=id?await env.DB!.prepare('SELECT id,revision,hash,salt FROM pos_cashiers WHERE id=?').bind(id).first<{id:string,revision:number,hash:string,salt:string}>():null;
  if(id&&!old)return reply('Кассир не найден',404);
  if(old&&old.revision!==body.revision)return reply('Доступ уже изменён. Обновите список кассиров.',409);
  if(!old||password){
   if(password.length>256||(!/^\d{4}$/.test(password)&&password.length<10)||!password.trim())return reply('Пароль: 4 цифры или от 10 до 256 символов');
   if(password!==body.confirmPassword)return reply('Пароли не совпадают');
  }else if(body.confirmPassword)return reply('Введите новый пароль или очистите оба поля пароля');
  const admin=await env.DB!.prepare('SELECT login FROM pos_admin_credentials WHERE id=1').first<{login:string}>();
  if([env.POS_LOGIN,env.POS_CASHIER_LOGIN,admin?.login].some(value=>value?.toLowerCase()===login.toLowerCase()))return reply('Этот логин уже занят',409);
  if(await env.DB!.prepare('SELECT id FROM pos_cashiers WHERE login=? COLLATE NOCASE AND id<>?').bind(login,id).first())return reply('Этот логин уже занят другим кассиром',409);
  const salt=password?Array.from(crypto.getRandomValues(new Uint8Array(32)),x=>x.toString(16).padStart(2,'0')).join(''):old!.salt;
  const hash=password?await passwordHash(password,salt):old!.hash;
  const userId=old?.id||crypto.randomUUID(),now=new Date().toISOString();
  const write=old?env.DB!.prepare('UPDATE pos_cashiers SET login=?,name=?,hash=?,salt=?,active=?,revision=revision+1,updated_at=? WHERE id=? AND revision=? AND EXISTS (SELECT 1 FROM pos_credentials WHERE id=1 AND hash=?)').bind(login,name,hash,salt,body.active?1:0,now,userId,old.revision,director.hash):
   env.DB!.prepare('INSERT INTO pos_cashiers (id,login,name,hash,salt,active,revision,created_at,updated_at) SELECT ?,?,?,?,?,?,1,?,? WHERE EXISTS (SELECT 1 FROM pos_credentials WHERE id=1 AND hash=?)').bind(userId,login,name,hash,salt,body.active?1:0,now,now,director.hash);
  const result=await env.DB!.batch([write,env.DB!.prepare('DELETE FROM pos_sessions WHERE token_hash IN (SELECT token_hash FROM pos_session_cashiers WHERE cashier_id=?) AND changes()=1').bind(userId)]);
  if(!result[0].meta.changes)return reply('Данные доступа изменились. Обновите страницу и повторите.',409);
  return Response.json({cashiers:await list(),message:old?'Доступ кассира обновлён':'Кассир добавлен'},{headers});
 }catch(e){
  if(String(e).includes('UNIQUE constraint'))return reply('Этот логин уже занят',409);
  return reply('Не удалось сохранить кассира. Обновите страницу и повторите.',400);
 }
}
