import {env} from 'cloudflare:workers';
import {backupStatus,createBackup,verifyBackup,recordBackupSchedule} from '../../lib/server-backup';
export const dynamic='force-dynamic';
// The identity headers are supplied by Sites dispatch, never by browser JS.
const ownerEmail='vaggroup3333@gmail.com';
const tools=[
 {name:'backup_status',description:'Read VAG Oil backup status. Owner only. No business data is returned.',inputSchema:{type:'object',properties:{},additionalProperties:false}},
 {name:'create_daily_backup',description:'Copy both VAG Oil ledgers, posted/draft documents, sync receipts and referenced photo files into private backup storage. Verify copied files and retain 30 days. Idempotent per Dushanbe date. Never modifies live business records.',inputSchema:{type:'object',properties:{},additionalProperties:false}},
 {name:'verify_backup',description:'Read and verify an existing backup and every photo checksum without changing live records.',inputSchema:{type:'object',properties:{id:{type:'string'}},required:['id'],additionalProperties:false}},
 {name:'record_backup_schedule',description:'Record the ID of an already-created Sites backup automation for display in director settings. Does not create a schedule. Call only after confirmed schedule creation.',inputSchema:{type:'object',properties:{automationId:{type:'string'}},required:['automationId'],additionalProperties:false}}
];
export async function POST(req:Request){
 let body:any;try{body=await req.json()}catch{return Response.json({jsonrpc:'2.0',id:null,error:{code:-32700,message:'Parse error'}},{status:400})}
 const reply=(result:unknown)=>Response.json({jsonrpc:'2.0',id:body.id??null,result});
 if(body.method==='server/discover')return reply({supportedVersions:['2026-07-28'],capabilities:{tools:{}}});
 if(body.method==='initialize')return reply({protocolVersion:'2025-03-26',capabilities:{tools:{}},serverInfo:{name:'vag-oil-backups',version:'1.0.0'}});
 if(body.method==='notifications/initialized')return new Response(null,{status:202});
 if(body.method==='tools/list')return reply({tools});
 if(body.method!=='tools/call')return Response.json({jsonrpc:'2.0',id:body.id??null,error:{code:-32601,message:'Method not found'}});
 if(!req.headers.get('oai-authenticated-user-id')||req.headers.get('oai-authenticated-user-email')?.toLowerCase()!==ownerEmail)return reply({isError:true,content:[{type:'text',text:'Доступ только владельцу VAG Oil. Подключите приложение под учётной записью владельца.'}]});
 try{const name=body.params?.name,args=body.params?.arguments||{};let result:unknown;
  if(name==='backup_status')result=await backupStatus(env);
  else if(name==='create_daily_backup')result=await createBackup(env);
  else if(name==='verify_backup')result=await verifyBackup(env,args.id);
  else if(name==='record_backup_schedule')result=await recordBackupSchedule(env,args.automationId);
  else throw Error('Unknown tool');
  return reply({content:[{type:'text',text:JSON.stringify(result)}]});
 }catch(e){return reply({isError:true,content:[{type:'text',text:'Копирование/проверка не завершены: '+(e instanceof Error?e.message:'ошибка хранилища')}]})}
}
