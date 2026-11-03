import {readFile,writeFile,readdir,mkdir,cp} from 'node:fs/promises';
import {createHash} from 'node:crypto';
const root=new URL('../dist/client/',import.meta.url),template=await readFile(new URL('../public/cashier-sw.js',import.meta.url),'utf8');
const files=await readdir(root,{recursive:true});
const base='vag-oil';
// vinext already puts compiled chunks under basePath. Public files need the
// same physical prefix for Wrangler's local asset server to return their bytes.
const assets=Array.from(new Set(files.map(name=>name.replaceAll('\\','/')).filter(name=>name.startsWith(base+'/_next/static/')&&/\.(js|css|woff2?)$/.test(name)).map(name=>'/'+name.slice(base.length+1)))).sort();
if(!assets.length)throw Error('No cashier assets were found');
const version=createHash('sha256').update(template+JSON.stringify(assets)).digest('hex').slice(0,16);
await writeFile(new URL('cashier-sw.js',root),template.replace('__CASHIER_BUILD_VERSION__',version).replace('/*__CASHIER_ASSETS__*/[]',JSON.stringify(assets)));
await mkdir(new URL(base+'/',root),{recursive:true});
const publicEntries=await readdir(new URL('../public/',import.meta.url));
for(const name of publicEntries){
 if(name.startsWith('.')||['_headers','_redirects'].includes(name))continue;
 await cp(new URL(name,root),new URL(base+'/'+name,root),{recursive:true,force:true});
}
console.log('Offline cashier prepared: '+assets.length+' assets, version '+version);
console.log('Public cashier files published under /'+base+'/');
