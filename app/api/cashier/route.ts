import {env} from 'cloudflare:workers';
import {sessionPrincipal} from '../../../lib/password-auth';
import {cashierStore} from '../../../lib/cashier-server';
export const dynamic='force-dynamic';
async function handle(req:Request){const principal=await sessionPrincipal(req,env);if(!principal)return Response.json({error:'Войдите в кассу. Сохранённые чеки останутся на устройстве.'},{status:401});if(principal.role==='administrator')return Response.json({error:'Администратору касса недоступна'},{status:403});return cashierStore(req,env.DB!,principal.owner,principal)}
export const GET=handle;
export const POST=handle;
