// Server only. Backups never write to the live ledger or original photos.
export type BackupEnv={DB?:D1Database,BUCKET?:R2Bucket,POS_LEDGER_OWNER?:string};
type LedgerRow={id:string,data:string,version:number};
type Photo={source:string,key:string,sha256:string,size:number};
export type BackupManifest={format:'vag-oil-backup-v1',id:string,createdAt:string,ledgers:LedgerRow[],operations:Record<string,unknown>[],resets:Record<string,unknown>[],photos:Photo[],counts:{products:number,documents:number,photos:number},exclusions:string[]};
const retentionDays=30;
const hash=async(bytes:ArrayBuffer)=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)),x=>x.toString(16).padStart(2,'0')).join('');
function storage(env:BackupEnv){if(!env.DB||!env.BUCKET||!env.POS_LEDGER_OWNER)throw Error('Хранилище резервных копий недоступно');return {db:env.DB,bucket:env.BUCKET,owner:env.POS_LEDGER_OWNER,prefix:'ledger-backups/'+encodeURIComponent(env.POS_LEDGER_OWNER)+'/'};}
export function backupDay(now:Date){return new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Dushanbe',year:'numeric',month:'2-digit',day:'2-digit'}).format(now);}
export function validateSnapshot(value:BackupManifest,owner:string){
 if(value.format!=='vag-oil-backup-v1'||!Array.isArray(value.ledgers)||!value.ledgers.some(x=>x.id===owner+':live'))throw Error('Неполная резервная копия');
 const ids=new Set<string>();
 for(const row of value.ledgers){if(![owner+':live',owner+':demo'].includes(row.id)||ids.has(row.id)||!Number.isInteger(row.version))throw Error('Неверная область копии');ids.add(row.id);const s=JSON.parse(row.data);if(!Array.isArray(s.products)||!Array.isArray(s.entries))throw Error('Повреждены данные учёта');}
 for(const row of [...value.operations,...value.resets])if(!ids.has(String(row.ledger_id)))throw Error('Неверная область операций');
}
async function listManifests(bucket:R2Bucket,prefix:string){const objects:R2Object[]=[];let cursor:string|undefined;do{const page=await bucket.list({prefix,cursor});objects.push(...page.objects.filter(o=>o.key.endsWith('/manifest.json')));cursor=page.truncated?page.cursor:undefined;}while(cursor);return objects.sort((a,b)=>b.uploaded.getTime()-a.uploaded.getTime());}
function validId(id:string){if(!/^(daily-\d{4}-\d{2}-\d{2}|manual-[a-f0-9-]{36})$/.test(id))throw Error('Неверный номер копии');return id;}
export async function verifyBackup(env:BackupEnv,id:string){
 const {bucket,prefix,owner}=storage(env);const directory=prefix+validId(id)+'/';const object=await bucket.get(directory+'manifest.json');if(!object)throw Error('Копия не найдена');
 const manifest=await object.json<BackupManifest>();validateSnapshot(manifest,owner);if(manifest.id!==id)throw Error('Неверный номер копии');
 const expected=new Set<string>();for(const row of manifest.ledgers){const mode=row.id===owner+':live'?'live':'demo';for(const p of JSON.parse(row.data).products)if(p.imageKey)expected.add('product-photos/'+encodeURIComponent(owner)+'/'+mode+'/'+p.imageKey);}
 if(expected.size!==manifest.photos.length)throw Error('Неполный набор фотографий');
 for(const photo of manifest.photos){if(!expected.delete(photo.source)||!photo.key.startsWith(directory+'photos/'))throw Error('Неверная фотография');const saved=await bucket.get(photo.key);if(!saved)throw Error('Фотография отсутствует в копии');const bytes=await saved.arrayBuffer();if(bytes.byteLength!==photo.size||await hash(bytes)!==photo.sha256)throw Error('Проверка фотографии не пройдена');}
 return {id,createdAt:manifest.createdAt,verifiedAt:new Date().toISOString(),counts:manifest.counts};
}
export async function backupStatus(env:BackupEnv){const {bucket,prefix}=storage(env);const rows=await listManifests(bucket,prefix);const latest=rows[0]?await bucket.get(rows[0].key):null;const value=latest?await latest.json<BackupManifest>():null;const schedule=await bucket.get(prefix+'schedule.json');return {latest:value?{id:value.id,createdAt:value.createdAt,counts:value.counts}:null,retentionDays,schedule:schedule?await schedule.json():null};}
async function prune(env:BackupEnv,now:Date,keep:string){const {bucket,prefix}=storage(env);const cutoff=now.getTime()-retentionDays*86400000;for(const row of await listManifests(bucket,prefix)){if(row.uploaded.getTime()>=cutoff||row.key===prefix+keep+'/manifest.json')continue;const directory=row.key.slice(0,-'manifest.json'.length);let cursor:string|undefined;do{const page=await bucket.list({prefix:directory,cursor});if(page.objects.length)await bucket.delete(page.objects.map(o=>o.key));cursor=page.truncated?page.cursor:undefined;}while(cursor);}}
export async function createBackup(env:BackupEnv,kind:'daily'|'manual'='daily',now=new Date()){
 const {db,bucket,owner,prefix}=storage(env);const id=kind==='daily'?'daily-'+backupDay(now):'manual-'+crypto.randomUUID();const directory=prefix+id+'/';
 if(await bucket.head(directory+'manifest.json')){const result=await verifyBackup(env,id);await prune(env,now,id);return result;}
 // One D1 batch reads ledger and sync receipts in the same transaction.
 const tables=await db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name IN ('pos_cashier_operations','pos_ledger_resets')").all<{name:string}>();const present=new Set(tables.results.map(x=>x.name));
 const queries=[db.prepare('SELECT id,data,version FROM ledgers WHERE id IN (?,?)').bind(owner+':live',owner+':demo')];
 for(const table of ['pos_cashier_operations','pos_ledger_resets'])queries.push(db.prepare(present.has(table)?'SELECT * FROM '+table+' WHERE ledger_id IN (?,?)':'SELECT ? AS ledger_id WHERE ? IS NULL').bind(owner+':live',owner+':demo'));
 const rows=await db.batch<Record<string,unknown>>(queries);
 const manifest:BackupManifest={format:'vag-oil-backup-v1',id,createdAt:now.toISOString(),ledgers:rows[0].results as LedgerRow[],operations:rows[1].results,resets:rows[2].results,photos:[],counts:{products:0,documents:0,photos:0},exclusions:['Пароли и сеансы входа','Неотправленные чеки и несохранённые формы на устройствах','Исходный код программы (хранится отдельно)']};
 validateSnapshot(manifest,owner);const seen=new Set<string>();
 for(const row of manifest.ledgers){const state=JSON.parse(row.data),mode=row.id===owner+':live'?'live':'demo';manifest.counts.products+=state.products.length;manifest.counts.documents+=state.entries.length;
  for(const p of state.products){if(!p.imageKey)continue;if(!/^[a-f0-9-]{36}\.(jpg|png|webp|gif)$/.test(p.imageKey))throw Error('Некорректная ссылка на фото');const source='product-photos/'+encodeURIComponent(owner)+'/'+mode+'/'+p.imageKey;if(seen.has(source))continue;seen.add(source);const original=await bucket.get(source);if(!original)throw Error('Не найдена фотография товара: '+p.name);const bytes=await original.arrayBuffer();const key=directory+'photos/'+mode+'/'+p.imageKey;await bucket.put(key,bytes,{httpMetadata:original.httpMetadata});const saved=await bucket.get(key);if(!saved||await hash(await saved.arrayBuffer())!==await hash(bytes))throw Error('Фотография не сохранилась');manifest.photos.push({source,key,sha256:await hash(bytes),size:bytes.byteLength});}
 }
 manifest.counts.photos=manifest.photos.length;
 // Commit marker only after every photo has been copied and checked.
 const encoded=JSON.stringify(manifest);await bucket.put(directory+'manifest.json',encoded,{onlyIf:{etagDoesNotMatch:'*'},httpMetadata:{contentType:'application/json'}});
 const result=await verifyBackup(env,id);await prune(env,now,id);return result;
}
export async function recordBackupSchedule(env:BackupEnv,automationId:string){const {bucket,prefix}=storage(env);if(!automationId||automationId.length>200)throw Error('Неверный номер расписания');await bucket.put(prefix+'schedule.json',JSON.stringify({automationId,time:'03:00',timezone:'Asia/Dushanbe',configuredAt:new Date().toISOString()}));return backupStatus(env);}
