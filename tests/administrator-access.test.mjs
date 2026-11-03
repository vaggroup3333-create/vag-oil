import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {stripTypeScriptTypes} from 'node:module';
import {readFile,writeFile,mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';

const dir=await mkdtemp(join(tmpdir(),'vag-admin-access-'));
try {
 for(const name of ['request-security','password-auth','legacy-ledger','packaging','opening-stock','paid-stock','paid-stock-costs','paid-stock-draft','paid-stock-store','paid-stock-save-recovery','draft-stock','stock-advances','stock-sources','invoice-duplicates','working-ledger','ledger']) {
  const source=await readFile(new URL('../lib/'+name+'.ts',import.meta.url),'utf8');
  const js=stripTypeScriptTypes(source).replace(/from '\.\/([^']+)'/g,"from './$1.mjs'");
  await writeFile(join(dir,name+'.mjs'),js);
 }
 const auth=await import(pathToFileURL(join(dir,'password-auth.mjs')));
 const ledger=await import(pathToFileURL(join(dir,'ledger.mjs')));
 class Database {
  sql=new DatabaseSync(':memory:');
  prepare(query){const db=this;return {args:[],bind(...args){this.args=args;return this},async first(){return db.sql.prepare(query).get(...this.args)||null},async run(){const r=db.sql.prepare(query).run(...this.args);return {meta:{changes:Number(r.changes)},success:true}}}}
  async batch(statements){this.sql.exec('BEGIN');try{const results=[];for(const s of statements)results.push(await s.run());this.sql.exec('COMMIT');return results}catch(e){this.sql.exec('ROLLBACK');throw e}}
 }
 const db=new Database(),password='Director-test-only',salt='administrator-test-salt';
 const env={DB:db,POS_LOGIN:'owner',POS_PASSWORD_HASH:await auth.passwordHash(password,salt),POS_PASSWORD_SALT:salt,POS_LEDGER_OWNER:'owner-ledger'};
 globalThis.__vagAdminTestEnv=env;
 let route=await readFile(new URL('../app/api/store/route.ts',import.meta.url),'utf8');
 route=route.replace("import { env } from 'cloudflare:workers';",'const env=globalThis.__vagAdminTestEnv;').replace(/from '\.\.\/\.\.\/\.\.\/lib\/([^']+)'/g,"from './$1.mjs'");
 await writeFile(join(dir,'store.mjs'),stripTypeScriptTypes(route));
 const store=await import(pathToFileURL(join(dir,'store.mjs')));
 const req=(path,body,cookie='')=>new Request('https://test.invalid'+path,{method:body?'POST':'GET',headers:{host:'test.invalid','content-type':'application/json',origin:'https://test.invalid','cf-connecting-ip':'admin-test',cookie},...(body?{body:JSON.stringify(body)}:{})});
 const login=await auth.authenticate(req('/api/auth',{action:'login',login:'owner',password}),env);
 assert.equal(login.status,200);const ownerCookie=login.headers.get('set-cookie');
 const setup={action:'set_admin_credentials',login:'manager',password:'Admin-test-only',confirmPassword:'Admin-test-only',currentPassword:password};
 assert.equal((await auth.authenticate(req('/api/auth',setup),env)).status,401);
 assert.equal((await auth.authenticate(req('/api/auth',setup,ownerCookie),env)).status,200);
 const adminLogin=await auth.authenticate(req('/api/auth',{action:'login',login:'manager',password:setup.password}),env);
 assert.equal(adminLogin.status,200);const adminCookie=adminLogin.headers.get('set-cookie');
 assert.equal((await adminLogin.json()).role,'administrator');
 assert.equal((await auth.authenticate(req('/api/auth',setup,adminCookie),env)).status,403);
 assert.equal((await auth.authenticate(req('/api/auth',{action:'change_password',currentPassword:password,newPassword:'New-test-only',confirmPassword:'New-test-only'},adminCookie),env)).status,403);
 db.sql.exec('CREATE TABLE ledgers (id TEXT PRIMARY KEY,data TEXT NOT NULL,version INTEGER NOT NULL)');
 const state=ledger.initial(false);
 state.products=[{id:'oil',code:'100001',name:'Oil',article:'',barcode:'',category:'Oil',unit:'л',qty:10,cost:30,price:50,wholesale:45,location:'',min:0,favorite:false,wholeOnly:false}];
 state.parties=[{id:'supplier',name:'Supplier',phone:'',kind:'supplier',note:''}];
 const base={number:'000001',date:'2026-10-23',createdAt:'2026-10-23',status:'posted',party:'Client',lines:[],total:600,paid:400,credit:0,cost:300,service:20,discount:10,discountValue:10,note:''};
 state.entries=[{...base,id:'sale',type:'sale',lines:[{id:'oil',name:'Oil',qty:12,price:50,cost:25,discount:10,packaging:{kind:'canister',volume:4,count:3,unitPrice:200}}]},{...base,id:'draft',type:'purchase',status:'draft',party:'Supplier',partyId:'supplier',paid:0,draftPaid:70,lines:[{id:'oil',name:'Oil',qty:2,price:30,cost:30,expense:0}]}];
 state.payments=[{id:'payment',date:'2026-10-23',amount:400,account:'cash',kind:'receipt',party:'Client',target:'sale',note:''}];
 delete state.stockSources; // Reconstruct legacy fixture sources after replacing its records.
 state.shifts=[{id:'shift',opened:'2026-10-23',closed:'2026-10-23',expected:400,actual:390}];
 db.sql.prepare('INSERT INTO ledgers VALUES (?,?,0)').run('owner-ledger:live',JSON.stringify(ledger.normalize(state)));
 const read=async cookie=>await (await store.GET(req('/api/store?mode=live',null,cookie))).json();
 const admin=await read(adminCookie),director=await read(ownerCookie);
 assert.equal(director.data.entries[0].total,600);assert.equal(director.data.payments[0].amount,400);
 assert.equal(admin.data.entries[0].total,0);assert.equal(admin.data.entries[0].discountValue,0);
 assert.equal(admin.data.entries[0].lines[0].packaging.unitPrice,0);assert.equal(admin.data.payments[0].amount,0);
 assert.equal(admin.data.shifts[0].actual,undefined);assert.equal(admin.data.entries[1].draftPaid,0);
 assert.equal((await store.GET(req('/api/store?mode=live'))).status,401);
 const post=action=>store.POST(req('/api/store?mode=live',{version:db.sql.prepare('SELECT version FROM ledgers').get().version,action},adminCookie));
 for(const type of ['payment','cash_in','cash_out','transfer','income','expense','shift_close','settings','account','delete_purchase','restore_purchase','return'])assert.equal((await post({type})).status,403,type);
 assert.equal((await post({type:'sale',paid:1,lines:[]})).status,403);
 assert.equal((await post({type:'draft_post',id:'draft',paid:0,lines:[]})).status,403);
 const original=JSON.parse(db.sql.prepare('SELECT data FROM ledgers').get().data);
 assert.equal((await post({type:'product',...state.products[0],name:'Updated Oil'})).status,200);
 assert.equal((await post({type:'draft_save',id:'draft',partyId:'supplier',paid:0,lines:state.entries[1].lines,note:'Updated note'})).status,200);
 const saved=JSON.parse(db.sql.prepare('SELECT data FROM ledgers').get().data);
 assert.equal(saved.products[0].name,'Updated Oil');assert.equal(saved.entries[1].note,'Updated note');assert.equal(saved.entries[1].draftPaid,70);
 assert.deepEqual(saved.entries[0],original.entries[0]);assert.deepEqual(saved.payments,original.payments);
 const paidId=crypto.randomUUID(),directorPost=async(action,version=0)=>store.POST(req('/api/store?mode=live',{version,action},ownerCookie));
 let version=db.sql.prepare('SELECT version FROM ledgers').get().version;
 assert.equal((await directorPost({type:'paid_stock_draft_new',id:paidId},version)).status,200);
 const paidSave={type:'paid_stock_draft_save',id:paidId,revision:0,title:'Unfinished draft',date:'2026-10-30',note:'',rows:[]};
 assert.equal((await directorPost(paidSave,0)).status,200,'unrelated store revision must not block paid draft save');
 const committed=await read(ownerCookie);
 assert.equal((await directorPost(paidSave,0)).status,200,'lost acknowledgement may retry an old revision');
 assert.equal((await read(ownerCookie)).version,committed.version,'retry is a no-op');
 assert.equal((await post(paidSave)).status,403,'administrator cannot use draft save branch');
 assert.equal((await store.POST(req('/api/store?mode=live',{version:0,action:paidSave}))).status,401);
 const crossOrigin=req('/api/store?mode=live',{version:0,action:paidSave},ownerCookie);crossOrigin.headers.set('origin','https://other.invalid');
 assert.equal((await store.POST(crossOrigin)).status,403,'new save branch enforces origin check');
 assert.equal((await auth.authenticate(req('/api/auth',{...setup,password:'Replacement-admin',confirmPassword:'Replacement-admin'},ownerCookie),env)).status,200);
 assert.equal((await store.GET(req('/api/store?mode=live',null,adminCookie))).status,401);
 console.log('PASS: administrator login and revocation; director-only credentials; hidden money including packaging; server-side action restrictions; product/draft edits preserve original cash and hidden planned payment.');
 db.sql.close();
}finally{delete globalThis.__vagAdminTestEnv;await rm(dir,{recursive:true,force:true});}
