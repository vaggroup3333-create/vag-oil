'use client';
import {useState} from 'react';

export function AdminCredentialsSettings(){
 const [open,setOpen]=useState(false),[login,setLogin]=useState('administrator'),[password,setPassword]=useState(''),[repeat,setRepeat]=useState(''),[current,setCurrent]=useState(''),[busy,setBusy]=useState(false),[error,setError]=useState(''),[done,setDone]=useState(false);
 return <div><h3>Учётная запись администратора</h3><p>Администратор может менять товары и документы. Выручка, прибыль и суммы касс скрыты; проводить платежи и кассовые операции может только директор.</p>{done?<p role="status">Доступ администратора сохранён для логина <b>{login}</b>.</p>:!open?<button onClick={()=>setOpen(true)}>Создать или изменить доступ администратора</button>:<form className="passwordSettings" onSubmit={async e=>{e.preventDefault();if(busy)return;setError('');if(password!==repeat){setError('Пароли не совпадают');return}setBusy(true);try{const r=await fetch('/vag-oil/api/auth',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'set_admin_credentials',login,password,confirmPassword:repeat,currentPassword:current})});const data:any=await r.json();if(!r.ok)throw Error(data.error||'Не удалось сохранить доступ');setPassword('');setRepeat('');setCurrent('');setDone(true)}catch(e){setError((e as Error).message)}finally{setBusy(false)}}}>
  <label>Логин<input autoComplete="username" required minLength={3} maxLength={32} value={login} onChange={e=>setLogin(e.target.value)}/></label>
  <label>Пароль администратора<input type="password" autoComplete="new-password" required minLength={4} maxLength={256} value={password} onChange={e=>setPassword(e.target.value)}/><small>4 цифры или минимум 10 символов</small></label>
  <label>Повтор пароля<input type="password" autoComplete="new-password" required minLength={4} maxLength={256} value={repeat} onChange={e=>setRepeat(e.target.value)}/></label>
  <label>Ваш текущий пароль директора<input type="password" autoComplete="current-password" required maxLength={256} value={current} onChange={e=>setCurrent(e.target.value)}/></label>
  {error&&<p className="error" role="alert">{error}</p>}<button className="green" disabled={busy}>{busy?'Сохранение…':'Сохранить доступ'}</button> <button type="button" disabled={busy} onClick={()=>{setOpen(false);setPassword('');setRepeat('');setCurrent('');setError('')}}>Отмена</button>
 </form>}</div>;
}
