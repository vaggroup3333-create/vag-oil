export type Product={id:string,name:string,category:string,unit:string,qty:number,cost:number,price:number};
export type Entry={id:string,date:string,type:string,party:string,car?:string,mileage?:string,phone?:string,lines?:{id:string,name:string,qty:number,price:number,cost:number}[],total:number,paid:number,cost:number,service?:number,note?:string,target?:string};
export type State={products:Product[],entries:Entry[]};
export const round=(x:number)=>Math.round(x*100)/100;
export function initial(demo:boolean):State{return {products:demo?[{id:'oil',name:'Shell Helix Ultra 5W-40',category:'Масло',unit:'л',qty:120,cost:65,price:95},{id:'filter',name:'MANN W 712/95',category:'Фильтры',unit:'шт',qty:18,cost:45,price:80},{id:'cool',name:'Антифриз G12+ красный',category:'Антифриз',unit:'л',qty:24,cost:22,price:40},{id:'brake',name:'Тормозная жидкость DOT 4',category:'Жидкости',unit:'шт',qty:4,cost:35,price:60}]:[],entries:[]};}
function num(x:any,min=0){const n=Number(x);if(!Number.isFinite(n)||n<min||n>1e9)throw Error('Проверьте числовые значения');return n;}
function str(x:any,required=false){const s=String(x??'').trim().slice(0,300);if(required&&!s)throw Error('Заполните обязательные поля');return s;}
export function apply(s:State,a:any):State{
 s=structuredClone(s);const id=crypto.randomUUID(),date=new Date().toISOString();
 if(a.type==='product'){s.products.push({id,name:str(a.name,true),category:str(a.category,true),unit:a.unit==='л'?'л':'шт',qty:0,cost:0,price:round(num(a.price))});return s;}
 if(a.type==='payment'){const e=s.entries.find(e=>e.id===a.target&&(e.type==='sale'||e.type==='purchase'));if(!e)throw Error('Документ не найден');const amount=round(num(a.amount,0.01));if(amount>round(e.total-e.paid))throw Error('Платёж больше долга');e.paid=round(e.paid+amount);s.entries.push({id,date,type:e.type==='sale'?'receipt':'payout',party:e.party,total:amount,paid:amount,cost:0,target:e.id});return s;}
 if(a.type==='expense'){const total=round(num(a.total,0.01));s.entries.push({id,date,type:'expense',party:str(a.party,true),note:str(a.note),total,paid:total,cost:0});return s;}
 if(a.type!=='sale'&&a.type!=='purchase')throw Error('Неизвестная операция');
 const seen=new Set();const lines=(Array.isArray(a.lines)?a.lines:[]).map((l:any)=>{const p=s.products.find(p=>p.id===l.id);if(!p||seen.has(p.id))throw Error('Проверьте товары');seen.add(p.id);const qty=num(l.qty,0.001);if(p.unit==='шт'&&!Number.isInteger(qty))throw Error('Штучный товар продаётся целиком');const price=round(num(l.price));if(a.type==='sale'&&qty>p.qty+0.00001)throw Error('Недостаточно товара: '+p.name);const cost=a.type==='sale'?p.cost:price;if(a.type==='purchase'){p.cost=(p.qty*p.cost+qty*price)/(p.qty+qty);p.qty=Math.round((p.qty+qty)*1000)/1000;}else p.qty=Math.round((p.qty-qty)*1000)/1000;return {id:p.id,name:p.name,qty,price,cost};});
 const service=a.type==='sale'?round(num(a.service)):0;
 const total=round(lines.reduce((v:number,l:any)=>v+l.qty*l.price,0)+service);if(total<=0)throw Error('Добавьте товары или услугу');
 const paid=round(num(a.paid));if(paid>total)throw Error('Оплата больше суммы документа');
 s.entries.push({id,date,type:a.type,party:str(a.party,true),phone:str(a.phone),car:str(a.car),mileage:str(a.mileage),lines,total,paid,cost:round(lines.reduce((v:number,l:any)=>v+l.qty*l.cost,0)),service,note:str(a.note)});return s;
}
