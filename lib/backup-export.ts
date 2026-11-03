import {normalize} from './ledger';

// Read a fresh server snapshot. Never fall back to stale browser state.
export async function fetchBackup(mode:string,request:typeof fetch=fetch){
 if(mode!=='live')throw Error('Доступен только рабочий учёт');
 const response=await request('/vag-oil/api/store?mode='+mode,{cache:'no-store'});
 const snapshot:any=await response.json();
 if(!response.ok)throw Error(snapshot.error||'Не удалось получить резервную копию');
 if(!snapshot.data||!Array.isArray(snapshot.data.products)||!Array.isArray(snapshot.data.entries)||!Number.isInteger(snapshot.version))throw Error('Получена неполная резервная копия');
 return {...normalize(snapshot.data),mode,version:snapshot.version,exported:new Date().toISOString()};
}
