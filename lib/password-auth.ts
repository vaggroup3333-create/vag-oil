import {isSameOrigin} from './request-security';
export type AuthEnv={DB?:D1Database,POS_LOGIN?:string,POS_PASSWORD_HASH?:string,POS_PASSWORD_SALT?:string,POS_LEDGER_OWNER?:string,POS_CASHIER_LOGIN?:string,POS_CASHIER_PASSWORD_HASH?:string,POS_CASHIER_PASSWORD_SALT?:string};
const cookieName='__Host-vag-oil-session',lifetime=8*60*60*1000;
const encoder=new TextEncoder();
const hex=(bytes:ArrayBuffer)=>Array.from(new Uint8Array(bytes),x=>x.toString(16).padStart(2,'0')).join('');
export async function passwordHash(password:string,salt:string){const key=await crypto.subtle.importKey('raw',encoder.encode(password),'PBKDF2',false,['deriveBits']);return hex(await crypto.subtle.deriveBits({name:'PBKDF2',hash:'SHA-256',salt:encoder.encode(salt),iterations:100000},key,256));}
export const digest=async(value:string)=>hex(await crypto.subtle.digest('SHA-256',encoder.encode(value)));
export function secureEqual(a:string,b:string){if(a.length!==b.length)return false;let difference=0;for(let i=0;i<a.length;i++)difference|=a.charCodeAt(i)^b.charCodeAt(i);return difference===0;}
export const configured=(env:AuthEnv)=>!!(env.DB&&env.POS_LOGIN&&env.POS_PASSWORD_HASH&&env.POS_PASSWORD_SALT&&env.POS_LEDGER_OWNER);
export function sessionToken(req:Request){const value=req.headers.get('cookie')?.split(';').map(s=>s.trim()).find(s=>s.startsWith(cookieName+'='))?.slice(cookieName.length+1)||'';return /^[a-f0-9]{64}$/.test(value)?value:'';}
const prepared=new WeakMap<D1Database,Promise<unknown>>();
export async function prepareAuth(db:D1Database){let ready=prepared.get(db);if(!ready){ready=db.batch([db.prepare('CREATE TABLE IF NOT EXISTS pos_sessions (token_hash TEXT PRIMARY KEY, expires INTEGER NOT NULL)'),db.prepare('CREATE TABLE IF NOT EXISTS pos_credentials (id INTEGER PRIMARY KEY CHECK(id=1), hash TEXT NOT NULL, salt TEXT NOT NULL)'),db.prepare('CREATE TABLE IF NOT EXISTS pos_cashier_credentials (id INTEGER PRIMARY KEY CHECK(id=1), hash TEXT NOT NULL, salt TEXT NOT NULL)'),db.prepare('CREATE TABLE IF NOT EXISTS pos_admin_credentials (id INTEGER PRIMARY KEY CHECK(id=1), login TEXT NOT NULL, hash TEXT NOT NULL, salt TEXT NOT NULL)'),db.prepare('CREATE TABLE IF NOT EXISTS pos_session_roles (token_hash TEXT PRIMARY KEY, role TEXT NOT NULL)'),db.prepare('CREATE TABLE IF NOT EXISTS pos_login_limits (key TEXT PRIMARY KEY, failures INTEGER NOT NULL, started INTEGER NOT NULL)'),db.prepare('CREATE TABLE IF NOT EXISTS pos_cashiers (id TEXT PRIMARY KEY, login TEXT NOT NULL UNIQUE COLLATE NOCASE, name TEXT NOT NULL, hash TEXT NOT NULL, salt TEXT NOT NULL, active INTEGER NOT NULL DEFAULT 1, revision INTEGER NOT NULL DEFAULT 1, created_at TEXT NOT NULL, updated_at TEXT NOT NULL)'),db.prepare('CREATE TABLE IF NOT EXISTS pos_session_cashiers (token_hash TEXT PRIMARY KEY, cashier_id TEXT NOT NULL)')]);prepared.set(db,ready)}try{await ready}catch(e){prepared.delete(db);throw e}}
export type Principal={owner:string,role:'director'|'cashier'|'administrator',login:string,userId?:string,name?:string};
export async function sessionPrincipal(req:Request,env:AuthEnv):Promise<Principal|null>{
 if(!configured(env))return null;const token=sessionToken(req);if(!token)return null;await prepareAuth(env.DB!);
 const row=await env.DB!.prepare("SELECT expires,COALESCE((SELECT role FROM pos_session_roles WHERE token_hash=pos_sessions.token_hash),'director') AS role FROM pos_sessions WHERE token_hash=?").bind(await digest(token)).first<{expires:number,role:string}>();
 if(!row||row.expires<=Date.now())return null;
 const role=row.role==='cashier'?'cashier':row.role==='administrator'?'administrator':'director';
 if(role==='cashier'){
  const link=await env.DB!.prepare('SELECT cashier_id FROM pos_session_cashiers WHERE token_hash=?').bind(await digest(token)).first<{cashier_id:string}>();
  if(link){const user=await env.DB!.prepare('SELECT id,login,name,active FROM pos_cashiers WHERE id=?').bind(link.cashier_id).first<{id:string,login:string,name:string,active:number}>();if(!user||!user.active)return null;return {owner:env.POS_LEDGER_OWNER!,role,login:user.login,userId:user.id,name:user.name};}
  return {owner:env.POS_LEDGER_OWNER!,role,login:env.POS_CASHIER_LOGIN||'cashier',userId:'legacy-cashier',name:'Общий кассир'};
 }
 const admin=role==='administrator'?await env.DB!.prepare('SELECT login FROM pos_admin_credentials WHERE id=1').first<{login:string}>():null;
 return {owner:env.POS_LEDGER_OWNER!,role,login:role==='administrator'?(admin?.login||'administrator'):env.POS_LOGIN!,userId:role,name:role==='administrator'?'Администратор':'Директор'};
}
export async function ledgerOwner(req:Request,env:AuthEnv){return (await sessionPrincipal(req,env))?.owner||null;}
export async function authenticate(req:Request,env:AuthEnv){
 const headers={'Cache-Control':'no-store'};
 if(!configured(env))return Response.json({error:'Вход ещё не настроен'},{status:503,headers});
 if(req.method==='GET'){const principal=await sessionPrincipal(req,env);return Response.json({authenticated:!!principal,role:principal?.role,login:principal?.login,actor:principal?{id:principal.userId!,name:principal.name!,login:principal.login,role:principal.role}:undefined,workspaceKey:principal?await digest(principal.owner):undefined},{headers});}
 if(req.method!=='POST'||!isSameOrigin(req)||!req.headers.get('content-type')?.startsWith('application/json'))return Response.json({error:'Запрос отклонён'},{status:403,headers});
 if(Number(req.headers.get('content-length'))>4096)return Response.json({error:'Запрос слишком большой'},{status:413,headers});
 let body:any;try{body=await req.json()}catch{return Response.json({error:'Некорректный запрос'},{status:400,headers})}
 await prepareAuth(env.DB!);
 if(body.action==='logout'){const token=sessionToken(req);if(token)await env.DB!.prepare('DELETE FROM pos_sessions WHERE token_hash=?').bind(await digest(token)).run();return Response.json({authenticated:false},{headers:{...headers,'Set-Cookie':cookieName+'=; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=0'}})}
 if(body.action==='set_admin_credentials'){
  const principal=await sessionPrincipal(req,env);if(!principal)return Response.json({error:'Войдите в систему'},{status:401,headers});if(principal.role!=='director')return Response.json({error:'Настроить администратора может только директор'},{status:403,headers});
  const login=typeof body.login==='string'?body.login.trim().slice(0,32):'',password=typeof body.password==='string'&&body.password.length<=256?body.password:'';
  if(!/^[a-zA-Z0-9._-]{3,32}$/.test(login))return Response.json({error:'Логин: 3–32 латинских буквы, цифры, точка, дефис или подчёркивание'},{status:400,headers});
  if([env.POS_LOGIN,env.POS_CASHIER_LOGIN].some(value=>value?.toLowerCase()===login.toLowerCase())||await env.DB!.prepare('SELECT id FROM pos_cashiers WHERE login=? COLLATE NOCASE').bind(login).first())return Response.json({error:'Этот логин уже занят'},{status:409,headers});
  if(typeof body.currentPassword!=='string')return Response.json({error:'Введите текущий пароль директора'},{status:400,headers});
  const director=await env.DB!.prepare('SELECT hash,salt FROM pos_credentials WHERE id=1').first<{hash:string,salt:string}>();if(!director||!secureEqual(await passwordHash(body.currentPassword,director.salt),director.hash))return Response.json({error:'Неверный пароль директора'},{status:401,headers});
  if((!/^\d{4}$/.test(password)&&password.length<10)||!password.trim())return Response.json({error:'Пароль: 4 цифры или не менее 10 символов'},{status:400,headers});if(password!==body.confirmPassword)return Response.json({error:'Пароли не совпадают'},{status:400,headers});
  const salt=hex(crypto.getRandomValues(new Uint8Array(32)).buffer),hash=await passwordHash(password,salt);await env.DB!.batch([env.DB!.prepare('INSERT INTO pos_admin_credentials (id,login,hash,salt) VALUES (1,?,?,?) ON CONFLICT(id) DO UPDATE SET login=excluded.login,hash=excluded.hash,salt=excluded.salt').bind(login,hash,salt),env.DB!.prepare("DELETE FROM pos_sessions WHERE token_hash IN (SELECT token_hash FROM pos_session_roles WHERE role='administrator')")]);return Response.json({message:'Учётная запись администратора сохранена',login},{headers});
 }
 if(body.action!=='login'&&body.action!=='change_password'&&body.action!=='change_cashier_password')return Response.json({error:'Неизвестная операция'},{status:400,headers});
 const changing=body.action==='change_password'||body.action==='change_cashier_password',changingCashier=body.action==='change_cashier_password';
 if(changing){const principal=await sessionPrincipal(req,env);if(!principal)return Response.json({error:'Войдите в систему'},{status:401,headers});if(principal.role!=='director')return Response.json({error:'Смена пароля директора доступна только директору'},{status:403,headers});}
 await env.DB!.prepare('INSERT OR IGNORE INTO pos_credentials (id,hash,salt) VALUES (1,?,?)').bind(env.POS_PASSWORD_HASH!,env.POS_PASSWORD_SALT!).run();
 const credentials=await env.DB!.prepare('SELECT hash,salt FROM pos_credentials WHERE id=1').first<{hash:string,salt:string}>();
 if(!credentials)return Response.json({error:'Вход ещё не настроен'},{status:503,headers});
 const ip=await digest((req.headers.get('cf-connecting-ip')||'unknown')+':'+env.POS_PASSWORD_SALT),now=Date.now();
 const limit=await env.DB!.prepare('SELECT failures,started FROM pos_login_limits WHERE key=?').bind(ip).first<{failures:number,started:number}>();
 if(limit&&limit.started>now-600000&&limit.failures>=5)return Response.json({error:'Слишком много попыток входа. Повторите через 10 минут.'},{status:429,headers});
 const login=typeof body.login==='string'?body.login.trim().slice(0,128):'',password=typeof (changing?body.currentPassword:body.password)==='string'&&(changing?body.currentPassword:body.password).length<=256?(changing?body.currentPassword:body.password):'';
 const cashierConfigured=!!(env.POS_CASHIER_LOGIN&&env.POS_CASHIER_PASSWORD_HASH&&env.POS_CASHIER_PASSWORD_SALT);
 if(cashierConfigured)await env.DB!.prepare('INSERT OR IGNORE INTO pos_cashier_credentials (id,hash,salt) VALUES (1,?,?)').bind(env.POS_CASHIER_PASSWORD_HASH!,env.POS_CASHIER_PASSWORD_SALT!).run();
 const cashierCredentials=cashierConfigured?await env.DB!.prepare('SELECT hash,salt FROM pos_cashier_credentials WHERE id=1').first<{hash:string,salt:string}>():null;
 const adminCredentials=await env.DB!.prepare('SELECT login,hash,salt FROM pos_admin_credentials WHERE id=1').first<{login:string,hash:string,salt:string}>();
 const namedCashier=!changing?await env.DB!.prepare('SELECT id,login,name,hash,salt,active FROM pos_cashiers WHERE login=? COLLATE NOCASE').bind(login).first<{id:string,login:string,name:string,hash:string,salt:string,active:number}>():null;
 const isCashier=!changing&&(!!namedCashier||(cashierConfigured&&secureEqual(login,env.POS_CASHIER_LOGIN!)));
 const isAdmin=!changing&&!isCashier&&!!adminCredentials&&secureEqual(login,adminCredentials.login);
 const selectedCredentials=namedCashier|| (isCashier?cashierCredentials!:isAdmin?adminCredentials!:credentials);
 const computed=await passwordHash(password,selectedCredentials.salt);
 if((namedCashier&&!namedCashier.active)||(!changing&&!isCashier&&!isAdmin&&!secureEqual(login,env.POS_LOGIN!))||!secureEqual(computed,selectedCredentials.hash)){
 await env.DB!.prepare('INSERT INTO pos_login_limits (key,failures,started) VALUES (?,1,?) ON CONFLICT(key) DO UPDATE SET failures=CASE WHEN started<=? THEN 1 ELSE failures+1 END,started=CASE WHEN started<=? THEN excluded.started ELSE started END').bind(ip,now,now-600000,now-600000).run();
 return Response.json({error:changing?'Неверный текущий пароль':'Неверный логин или пароль'},{status:401,headers});
 }
 if(changing){
 const next=body.newPassword;
 if(typeof next!=='string'||(!/^\d{4}$/.test(next)&&next.length<10)||next.length>256||!next.trim())return Response.json({error:'Укажите 4 цифры или пароль от 10 до 256 символов'},{status:400,headers});
 if(next!==body.confirmPassword)return Response.json({error:'Новые пароли не совпадают'},{status:400,headers});
 if(next===password)return Response.json({error:'Новый пароль должен отличаться от текущего'},{status:400,headers});
 const salt=hex(crypto.getRandomValues(new Uint8Array(32)).buffer),hash=await passwordHash(next,salt);
 if(changingCashier){
 if(!cashierCredentials)return Response.json({error:'Учётная запись кассира ещё не настроена'},{status:503,headers});
 const result=await env.DB!.batch([
 env.DB!.prepare('UPDATE pos_cashier_credentials SET hash=?,salt=? WHERE id=1 AND EXISTS (SELECT 1 FROM pos_credentials WHERE id=1 AND hash=?)').bind(hash,salt,credentials.hash),
 env.DB!.prepare("DELETE FROM pos_sessions WHERE token_hash IN (SELECT token_hash FROM pos_session_roles WHERE role='cashier') AND token_hash NOT IN (SELECT token_hash FROM pos_session_cashiers) AND EXISTS (SELECT 1 FROM pos_cashier_credentials WHERE id=1 AND hash=?)").bind(hash),
 env.DB!.prepare('DELETE FROM pos_login_limits WHERE key=?').bind(ip)]);
 if(!result[0].meta.changes)return Response.json({error:'Пароль директора изменён. Повторите вход.'},{status:409,headers});
 return Response.json({authenticated:true,message:'Пароль кассира изменён'},{headers});
 }
 const result=await env.DB!.batch([
 env.DB!.prepare('UPDATE pos_credentials SET hash=?,salt=? WHERE id=1 AND hash=?').bind(hash,salt,credentials.hash),
 env.DB!.prepare('DELETE FROM pos_sessions WHERE EXISTS (SELECT 1 FROM pos_credentials WHERE id=1 AND hash=?)').bind(hash),
 env.DB!.prepare('DELETE FROM pos_login_limits WHERE key=?').bind(ip)]);
 if(!result[0].meta.changes)return Response.json({error:'Пароль уже изменён. Войдите заново.'},{status:409,headers});
 return Response.json({authenticated:false,message:'Пароль изменён. Войдите с новым паролем.'},{headers:{...headers,'Set-Cookie':cookieName+'=; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=0'}});
 }
 const bytes=crypto.getRandomValues(new Uint8Array(32)),token=hex(bytes.buffer),expires=now+lifetime;
 const tokenHash=await digest(token);const result=await env.DB!.batch([namedCashier?env.DB!.prepare('INSERT INTO pos_sessions (token_hash,expires) SELECT ?,? WHERE EXISTS (SELECT 1 FROM pos_cashiers WHERE id=? AND hash=? AND active=1)').bind(tokenHash,expires,namedCashier.id,namedCashier.hash):isCashier||isAdmin?env.DB!.prepare('INSERT INTO pos_sessions (token_hash,expires) VALUES (?,?)').bind(tokenHash,expires):env.DB!.prepare('INSERT INTO pos_sessions (token_hash,expires) SELECT ?,? WHERE EXISTS (SELECT 1 FROM pos_credentials WHERE id=1 AND hash=?)').bind(tokenHash,expires,credentials.hash),env.DB!.prepare('INSERT INTO pos_session_roles (token_hash,role) SELECT ?,? WHERE EXISTS (SELECT 1 FROM pos_sessions WHERE token_hash=?)').bind(tokenHash,isCashier?'cashier':isAdmin?'administrator':'director',tokenHash),env.DB!.prepare('INSERT INTO pos_session_cashiers (token_hash,cashier_id) SELECT ?,? WHERE ? IS NOT NULL AND EXISTS (SELECT 1 FROM pos_sessions WHERE token_hash=?)').bind(tokenHash,namedCashier?.id||null,namedCashier?.id||null,tokenHash),env.DB!.prepare('DELETE FROM pos_login_limits WHERE key=?').bind(ip),env.DB!.prepare('DELETE FROM pos_sessions WHERE expires<?').bind(now),env.DB!.prepare('DELETE FROM pos_session_cashiers WHERE token_hash NOT IN (SELECT token_hash FROM pos_sessions)')]);
 if(!result[0].meta.changes)return Response.json({error:'Пароль изменён. Повторите вход.'},{status:401,headers});
 return Response.json({authenticated:true,role:isCashier?'cashier':isAdmin?'administrator':'director',login:namedCashier?.login||(isCashier?env.POS_CASHIER_LOGIN:isAdmin?adminCredentials!.login:env.POS_LOGIN),actor:{id:namedCashier?.id||(isCashier?'legacy-cashier':isAdmin?'administrator':'director'),name:namedCashier?.name||(isCashier?'Общий кассир':isAdmin?'Администратор':'Директор'),login:namedCashier?.login||(isCashier?env.POS_CASHIER_LOGIN:isAdmin?adminCredentials!.login:env.POS_LOGIN),role:isCashier?'cashier':isAdmin?'administrator':'director'},workspaceKey:await digest(env.POS_LEDGER_OWNER!)},{headers:{...headers,'Set-Cookie':cookieName+'='+token+'; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age='+lifetime/1000}});
}
