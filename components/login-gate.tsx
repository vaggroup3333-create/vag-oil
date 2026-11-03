'use client';
import {ReactNode,useEffect,useState} from 'react';
import {Droplets,LockKeyhole} from 'lucide-react';
import {readAuthResponse} from '../lib/auth-response';
export async function logout(){
 const response=await fetch('/vag-oil/api/auth',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'logout'})});
 const data=await readAuthResponse(response);if(!response.ok)throw Error(data.error||'Не удалось выйти');
 location.reload();
}
export function LoginGate({children,preferredRole}:{children:ReactNode,preferredRole?:'director'|'administrator'}){
 const administrator=preferredRole==='administrator';
 const [role,setRole]=useState('director'),[authenticated,setAuthenticated]=useState(false),[checking,setChecking]=useState(true),[busy,setBusy]=useState(false),[login,setLogin]=useState(administrator?'':'director'),[password,setPassword]=useState(''),[error,setError]=useState('');
 useEffect(()=>{
  try{const saved=localStorage.getItem(administrator?'vag-oil-administrator-login':'vag-oil-director-login');if(saved)setLogin(saved)}catch{}
  let active=true;
  fetch('/vag-oil/api/auth',{cache:'no-store'}).then(async response=>{const data=await readAuthResponse(response);if(!response.ok)throw Error(data.error);if(active){setRole(data.role||'director');setAuthenticated(!!data.authenticated)}}).catch(e=>{if(active)setError(e.message)}).finally(()=>{if(active)setChecking(false)});
  return()=>{active=false};
 },[administrator]);
 useEffect(()=>{const expired=()=>setAuthenticated(false);window.addEventListener('pos-session-expired',expired);return()=>window.removeEventListener('pos-session-expired',expired)},[]);
 async function switchAccount(){
  if(busy)return;setBusy(true);setError('');
  try{
   const response=await fetch('/vag-oil/api/auth',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'logout'})});
   const data=await readAuthResponse(response);if(!response.ok)throw Error(data.error||'Не удалось выйти');
   setAuthenticated(false);setPassword('');setLogin(administrator?'':'director');
  }catch(e){setError((e as Error).message)}finally{setBusy(false)}
 }
 if(authenticated&&(role==='cashier'||(administrator&&role!=='administrator')))return <div className="posLogin"><div className="loginAccountPanel"><div className="posLoginBrand"><Droplets size={42}/><h1>VAG OIL POS</h1></div><h2>{administrator?'Вход администратора':'Вы уже вошли'}</h2><p>Сейчас открыт вход {role==='cashier'?'кассира':'директора'}. Чтобы войти под другим пользователем, нажмите кнопку ниже.</p>{error&&<div className="error" role="alert">{error}</div>}<button type="button" className="green" disabled={busy} onClick={()=>void switchAccount()}>{busy?'Выход…':administrator?'Войти под администратором':'Сменить пользователя'}</button><p><a href={role==='cashier'?'/vag-oil/cashier':'/vag-oil/'}>Вернуться в свой кабинет</a></p>{!administrator&&<a href="/vag-oil/administrator">Вход администратора →</a>}</div></div>;
 if(authenticated)return <>{children}</>;
 return <div className="posLogin"><form onSubmit={async e=>{
  e.preventDefault();if(busy)return;setBusy(true);setError('');
  try{
   const response=await fetch('/vag-oil/api/auth',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'login',login,password})});
   const data=await readAuthResponse(response);if(!response.ok)throw Error(data.error);
   if(data.role==='director'||data.role==='administrator'){try{localStorage.setItem('vag-oil-'+data.role+'-login',login.trim())}catch{}}
   setPassword('');setRole(data.role||'director');setAuthenticated(true);
  }catch(e){setError((e as Error).message)}finally{setBusy(false)}
 }}><div className="posLoginBrand"><Droplets size={42}/><h1>VAG OIL POS</h1></div><h2><LockKeyhole size={20}/> {administrator?'Вход администратора':'Вход директора или администратора'}</h2><p>{administrator?'Введите логин и пароль, которые создал директор в настройках.':'Введите логин и пароль своей учётной записи.'}</p><div className="loginRoleLinks">{!administrator&&<a className="green" href="/vag-oil/administrator">Вход администратора</a>}{administrator&&<a href="/vag-oil/">Вход директора</a>}<a href="/vag-oil/cashier">Вход кассира</a></div>{error&&<div className="error" role="alert">{error}</div>}{checking?<p>Проверка входа…</p>:<><label>Логин<input autoComplete="username" autoCapitalize="none" spellCheck={false} required value={login} onChange={e=>setLogin(e.target.value)} /></label><label>Пароль<input type="password" autoComplete="current-password" required value={password} onChange={e=>setPassword(e.target.value)}/></label><button className="green" disabled={busy}>{busy?'Вход…':administrator?'Войти как администратор':'Войти'}</button></>}</form></div>;
}
