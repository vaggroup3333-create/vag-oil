import {env} from 'cloudflare:workers';
import {sessionPrincipal} from '../../../lib/password-auth';
import {backupStatus,createBackup} from '../../../lib/server-backup';
import {isSameOrigin} from '../../../lib/request-security';
export const dynamic='force-dynamic';
export async function GET(req:Request){const p=await sessionPrincipal(req,env);if(p?.role!=='director')return Response.json({error:'Доступно только директору'},{status:403});try{return Response.json(await backupStatus(env),{headers:{'Cache-Control':'no-store'}})}catch{return Response.json({error:'Не удалось прочитать состояние копий'},{status:503})}}
export async function POST(req:Request){const p=await sessionPrincipal(req,env);if(p?.role!=='director'||!isSameOrigin(req))return Response.json({error:'Доступ запрещён'},{status:403});try{return Response.json(await createBackup(env,'manual'),{headers:{'Cache-Control':'no-store'}})}catch{return Response.json({error:'Копия не завершена. Повторите попытку; при повторной ошибке обратитесь к администратору.'},{status:503})}}
