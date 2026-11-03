import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
const source=await readFile(new URL('../public/cashier-sw.js',import.meta.url),'utf8');
const handlers={},cache=new Map();let online=true;
const storage={async addAll(paths){for(const path of paths)cache.set(path,new Response('cached:'+path))},async put(key,value){cache.set(typeof key==='string'?key:new URL(key.url).pathname,value)}};
const context={self:{location:{origin:'https://shop.invalid'},clients:{claim:async()=>{}},addEventListener:(name,handler)=>handlers[name]=handler},caches:{open:async()=>storage,match:async key=>cache.get(typeof key==='string'?key:new URL(key.url).pathname)?.clone()},fetch:async request=>{if(!online)throw Error('Offline');return new Response('online:'+request.url)},URL,Response};
vm.runInNewContext(source,context);
let installed;handlers.install({waitUntil:promise=>installed=promise});await installed;assert.ok(cache.has('/vag-oil/cashier'));
async function load(path,mode='navigate'){let result;handlers.fetch({request:{url:'https://shop.invalid'+path,method:'GET',mode},respondWith:promise=>result=promise});return result}
online=false;assert.equal(await (await load('/vag-oil/cashier')).text(),'cached:/vag-oil/cashier');
assert.equal(await load('/vag-oil/api/cashier','cors'),undefined);assert.equal(await load('/vag-oil/api/auth','cors'),undefined);assert.equal(await load('/vag-oil/'),undefined);
cache.clear();const unavailable=await load('/vag-oil/cashier');assert.equal(unavailable.status,503);
console.log('PASS: cashier shell available without network after install; authentication and business APIs are never cached; director navigation has no cashier fallback; unprepared device gets clear error');
