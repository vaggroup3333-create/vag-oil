'use client';
import {ReactNode,useEffect,useState} from 'react';
import {deviceRead,deviceUpdate,OfflineGrant} from '../lib/cashier-device';
import {Droplets,LockKeyhole} from 'lucide-react';
import {InstallAppButton} from './install-app';
import {readAuthResponse} from '../lib/auth-response';
export async function cashierLogout(){
 await deviceUpdate('offline-grant',()=>undefined);
 try{await fetch('/vag-oil/api/auth',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'logout'}),signal:AbortSignal.timeout(5000)})}catch{}
 window.dispatchEvent(new Event('pos-session-expired'));
}
export function CashierAccess({children}:{children:(grant:OfflineGrant)=>ReactNode}){
 const [grant,setGrant]=useState<OfflineGrant|null>(null),[checking,setChecking]=useState(true),[busy,setBusy]=useState(false),[login,setLogin]=useState(''),[password,setPassword]=useState(''),[error,setError]=useState('');
 async function remember(data:any){if(data.role==='administrator'){await deviceUpdate('offline-grant',()=>undefined);window.location.replace('/vag-oil/administrator');return;}if(!['director','cashier'].includes(data.role))throw Error('Войдите в систему заново');const value:OfflineGrant={workspaceKey:data.workspaceKey,role:data.role,login:data.login,actor:data.actor};if(!value.workspaceKey)throw Error('Войдите в кассу заново');await deviceUpdate('offline-grant',()=>value);setGrant(value)}
 useEffect(()=>{let active=true;(async()=>{try{const response=await fetch('/vag-oil/api/auth',{cache:'no-store',signal:AbortSignal.timeout(8000)});const data:any=await readAuthResponse(response);if(!response.ok)throw Error(data.error||'Ошибка входа');if(active&&data.authenticated)await remember(data);else if(active)await deviceUpdate('offline-grant',()=>undefined)}catch(e){if(!active)return;try{const saved=await deviceRead<OfflineGrant>('offline-grant');if(saved&&['director','cashier'].includes(saved.role))setGrant(saved);else setError('Для первого входа и подготовки кассы нужен интернет.')}catch{setError((e as Error).message)}}finally{if(active)setChecking(false)}})();
  const expired=()=>{setGrant(null);setPassword('');setError('Войдите снова. Неотправленные чеки сохранены на устройстве.');void deviceUpdate('offline-grant',()=>undefined)};window.addEventListener('pos-session-expired',expired);return()=>{active=false;window.removeEventListener('pos-session-expired',expired)};
 },[]);
 if(grant)return <>{children(grant)}</>;
 return <div className="posLogin"><form autoComplete="on" onSubmit={async e=>{
  e.preventDefault();if(busy)return;
  // Password managers may fill the inputs without updating React state first.
  const fields=new FormData(e.currentTarget),submittedLogin=String(fields.get('username')??login),submittedPassword=String(fields.get('password')??password);
  setBusy(true);setError('');
  try{
   const response=await fetch('/vag-oil/api/auth',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'login',login:submittedLogin,password:submittedPassword}),signal:AbortSignal.timeout(15000)});
   const data:any=await readAuthResponse(response);if(!response.ok)throw Error(data.error||'Не удалось войти');
   await remember(data);setPassword('');
  }catch(e){setError((e as Error).message)}finally{setBusy(false)}
 }}>
  <div className="posLoginBrand"><Droplets size={42}/><h1>VAG OIL · КАССА</h1></div>
  <h2><LockKeyhole size={20}/> Вход кассира</h2>
  <p>Введите личный логин и пароль или выберите сохранённый пароль на устройстве.</p>
  <div className="loginRoleLinks"><a className="green" href="/vag-oil/administrator">Вход администратора</a><a href="/vag-oil/?switch=1">Вход директора</a></div>
  {error&&<div className="error" role="alert">{error}</div>}
  {checking?<p>Проверка устройства…</p>:<>
   <label htmlFor="cashier-username">Логин<input id="cashier-username" name="username" type="text" required autoComplete="username" autoCapitalize="none" autoCorrect="off" spellCheck={false} value={login} onChange={e=>setLogin(e.target.value)}/></label>
   <label htmlFor="cashier-password">Пароль<input id="cashier-password" name="password" type="password" required autoComplete="current-password" value={password} onChange={e=>setPassword(e.target.value)}/></label>
   <button type="submit" className="green" disabled={busy}>{busy?'Вход…':'Войти в кассу'}</button>
   <details className="loginFaceIdGuide">
    <summary>iPhone: вход с Face ID</summary>
    <ol>
     <li>Откройте кассу в Safari. При первом входе сохраните свой логин и пароль.</li>
     <li>В настройках iPhone включите автозаполнение паролей и разрешите его для Face ID.</li>
     <li>В следующий раз нажмите поле логина, выберите сохранённый пароль, подтвердите Face ID и нажмите «Войти в кассу».</li>
    </ol>
    <p>Пока ваш вход действует, касса открывается сразу. Face ID подтверждает подстановку пароля средствами iPhone.</p>
   </details>
  </>}
  <InstallAppButton cashier/>
 </form></div>;
}
