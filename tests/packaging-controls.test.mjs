import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {mkdtemp,writeFile,rm} from 'node:fs/promises';
import {pathToFileURL} from 'node:url';
const require=createRequire(import.meta.url);
const {build}=require(require.resolve('esbuild',{paths:[require.resolve('vite')]}));
const dir=await mkdtemp(new URL('./.pack-controls-',import.meta.url));
try {
 const result=await build({entryPoints:[new URL('../components/packaging-controls.tsx',import.meta.url).pathname],bundle:true,write:false,platform:'node',format:'esm',packages:'external',jsx:'automatic',loader:{'.css':'empty'}});
 await writeFile(dir+'/controls.mjs',result.outputFiles[0].text);
 const {PackagingControls,PurchasePackagingPanel}=await import(pathToFileURL(dir+'/controls.mjs'));
 const p={id:'oil',name:'Test oil',unit:'л',wholeOnly:false,price:100,wholesale:90,qty:10};
 const s={products:[p],packageLots:[{id:'lot',productId:'oil',kind:'canister',volume:5,sealed:2,opened:[]}]};
 function findSelect(node){if(!node||typeof node!=='object')return; if(node.type==='select')return node; for(const child of [node.props?.children].flat(Infinity)){const found=findSelect(child);if(found)return found;}}
 function change(line,value,purchase=false){let next;const tree=PackagingControls({s,p,line,purchase,onChange:v=>{next=v;}});findSelect(tree).props.onChange({target:{value}});return next;}
 // Exercise the real UI handler: wholesale and manually negotiated prices
 // must survive switching sale mode on both desktop and mobile controls.
 for(const price of [90,100,96,0]){
  const sealed=change({id:'oil',qty:2,price},'canister:5');
  assert.equal(sealed.packaging.unitPrice,price*5);
  assert.equal(sealed.price,price);
  const bulk=change(sealed,'bulk');
  assert.equal(bulk.price,price);
  assert.equal(bulk.packaging,undefined);
  assert.equal(bulk.saleMode,'bulk');
 }
 const React=await import('react');
 const {renderToStaticMarkup}=await import('react-dom/server');
 const render=props=>renderToStaticMarkup(React.createElement(PurchasePackagingPanel,props));
 const empty=render({s,lines:[],onChange:()=>{}});
 assert.match(empty,/Сначала сохраните карточку/);
 const before=structuredClone(s);
 const oilLine={id:'oil',qty:1,price:60};
 const visible=render({s,lines:[oilLine],onChange:()=>{}});
 assert.match(visible,/Тип упаковки/);assert.match(visible,/Канистры/);assert.match(visible,/Бочки/);
 let received;
 const panel=PurchasePackagingPanel({s,lines:[oilLine],onChange:x=>{received=x;}});
 const holder=panel.props.children[1][0];
 const control=holder.props.children[1];
 findSelect(PackagingControls(control.props)).props.onChange({target:{value:'barrel'}});
 assert.equal(received[0].packaging.volume,200);assert.equal(received[0].qty,200);
 const packed=render({s,lines:received,onChange:()=>{}});
 for(const label of ['Объём одной упаковки','Количество упаковок','Закупочная цена','Общий объём','Закупочная стоимость литра'])assert.ok(packed.includes(label));
 assert.deepEqual(s,before);
 assert.match(render({s:{...s,products:[{...p,wholeOnly:true}]},lines:[oilLine],onChange:()=>{}}),/отключите его в карточке товара/);
 const {readFile}=await import('node:fs/promises');
 const page=await readFile(new URL('../app/page.tsx',import.meta.url),'utf8');
 assert.ok(page.includes("modal==='draft_edit'&&<PackagingControls")&&page.includes("line={l} purchase compact disabled={busy}"),'Real purchase form mounts compact packaging controls');
 const purchase=change({id:'oil',qty:1,price:60},'canister',true);
 assert.equal(purchase.packaging.unitPrice,300);
 assert.equal(purchase.qty,5);
 assert.equal(change(purchase,'bulk',true).price,60);
 console.log('Packaging controls preserve wholesale, retail, negotiated and zero prices; purchase unaffected.');
} finally {await rm(dir,{recursive:true,force:true});}
