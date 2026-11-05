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
 const [switchRequested,setSwitchRequested]=useState(false);
 useEffect(()=>{
  setSwitchRequested(new URLSearchParams(window.location.search).get('switch')==='1');
  try{const saved=localStorage.getItem(administrator?'vag-oil-administrator-login':'vag-oil-director-login');if(saved)setLogin(saved)}catch{}
  let active=true;
  fetch('/vag-oil/api/auth',{cache:'no-store'}).then(async response=>{const data=await readAuthResponse(response);if(!response.ok)throw Error(data.error);if(active){setRole(data.role||'director');setAuthenticated(!!data.authenticated)}}).catch(e=>{if(active)setError(e.message)}).finally(()=>{if(active)setChecking(false)});
  return()=>{active=false};
 },[administrator]);
 useEffect(()=>{const expired=()=>setAuthenticated(false);window.addEventListener('pos-session-expired',expired);return()=>window.removeEventListener('pos-session-expired',expired)},[]);
 useEffect(()=>{
  if(authenticated&&role==='cashier'&&!administrator&&!switchRequested)window.location.replace('/vag-oil/cashier');
 },[authenticated,role,administrator,switchRequested]);
 async function switchAccount(){
  if(busy)return;setBusy(true);setError('');
  try{
   const response=await fetch('/vag-oil/api/auth',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'logout'})});
   const data=await readAuthResponse(response);if(!response.ok)throw Error(data.error||'Не удалось выйти');
   setAuthenticated(false);setPassword('');setLogin(administrator?'':'director');
  }catch(e){setError((e as Error).message)}finally{setBusy(false)}
 }
 if(authenticated&&role==='cashier'&&!administrator&&!switchRequested)return <div className="posLogin"><div className="loginAccountPanel"><div className="posLoginBrand"><Droplets size={42}/><h1>VAG OIL POS</h1></div><h2>Открываем кассу…</h2><p>Ваш вход сохранён.</p><a className="green" href="/vag-oil/cashier">Открыть кассу</a><p><a href="/vag-oil/?switch=1">Сменить пользователя</a></p></div></div>;
 if(authenticated&&(role==='cashier'||(administrator&&role!=='administrator')))return <div className="posLogin"><div className="loginAccountPanel"><div className="posLoginBrand"><Droplets size={42}/><h1>VAG OIL POS</h1></div><h2>{administrator?'Вход администратора':'Сменить пользователя'}</h2><p>Сейчас открыт вход {role==='cashier'?'кассира':'директора'}. Чтобы войти под другим пользователем, нажмите кнопку ниже.</p>{error&&<div className="error" role="alert">{error}</div>}<button type="button" className="green" disabled={busy} onClick={()=>void switchAccount()}>{busy?'Выход…':administrator?'Войти под администратором':'Сменить пользователя'}</button><p><a href={role==='cashier'?'/vag-oil/cashier':'/vag-oil/'}>Вернуться в свой кабинет</a></p>{!administrator&&<a href="/vag-oil/administrator">Вход администратора →</a>}</div></div>;
 if(authenticated)return <>{children}</>;
 return <div className="posLogin"><form autoComplete="on" onSubmit={async e=>{
  e.preventDefault();if(busy)return;
  const fields=new FormData(e.currentTarget),submittedLogin=String(fields.get('username')??login),submittedPassword=String(fields.get('password')??password);
  setBusy(true);setError('');
  try{
   const response=await fetch('/vag-oil/api/auth',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'login',login:submittedLogin,password:submittedPassword})});
   const data=await readAuthResponse(response);if(!response.ok)throw Error(data.error);
   if(data.role==='director'||data.role==='administrator'){try{localStorage.setItem('vag-oil-'+data.role+'-login',submittedLogin.trim())}catch{}}
   if(data.role==='cashier'&&!administrator)window.location.replace('/vag-oil/cashier');
   setPassword('');setRole(data.role||'director');setAuthenticated(true);
  }catch(e){setError((e as Error).message)}finally{setBusy(false)}
 }}><div className="posLoginBrand"><Droplets size={42}/><h1>VAG OIL POS</h1></div><h2><LockKeyhole size={20}/> {administrator?'Вход администратора':'Вход директора или администратора'}</h2><p>{administrator?'Введите логин и пароль, которые создал директор в настройках.':'Введите логин и пароль своей учётной записи.'}</p><div className="loginRoleLinks">{!administrator&&<a className="green" href="/vag-oil/administrator">Вход администратора</a>}{administrator&&<a href="/vag-oil/?switch=1">Вход директора</a>}<a href="/vag-oil/cashier">Вход кассира</a></div>{error&&<div className="error" role="alert">{error}</div>}{checking?<p>Проверка входа…</p>:<><label htmlFor="account-username">Логин<input id="account-username" name="username" type="text" autoCorrect="off" autoComplete="username" autoCapitalize="none" spellCheck={false} required value={login} onChange={e=>setLogin(e.target.value)} /></label><label htmlFor="account-password">Пароль<input id="account-password" name="password" type="password" autoComplete="current-password" required value={password} onChange={e=>setPassword(e.target.value)}/></label><button className="green" disabled={busy}>{busy?'Вход…':administrator?'Войти как администратор':'Войти'}</button></>}</form></div>;
}
