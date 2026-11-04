'use client';
import {useEffect,useState} from 'react';
import {Plus,Users,KeyRound,Receipt,RefreshCw,X} from 'lucide-react';
type Account={id:string;name:string;login:string;active:number;revision:number};
type Draft={id:string;revision:number;name:string;login:string;password:string;confirmPassword:string;currentPassword:string;active:boolean};
const blank=():Draft=>({id:'',revision:0,name:'',login:'',password:'',confirmPassword:'',currentPassword:'',active:true});
export function CashierAccounts({onSales}:{onSales:(id:string)=>void}){
 const [accounts,setAccounts]=useState<Account[]>([]),[loaded,setLoaded]=useState(false),[loading,setLoading]=useState(false),[busy,setBusy]=useState(false),[error,setError]=useState(''),[message,setMessage]=useState(''),[draft,setDraft]=useState<Draft|null>(null),[legacyLogin,setLegacyLogin]=useState('');
 async function load(){setLoading(true);setError('');try{const response=await fetch('/vag-oil/api/cashiers',{cache:'no-store'}),data:any=await response.json();if(!response.ok){if(response.status===401)window.dispatchEvent(new Event('pos-session-expired'));throw Error(data.error||'Не удалось загрузить кассиров');}setAccounts(data.cashiers);setLegacyLogin(data.legacyLogin||'');setLoaded(true);}catch(e){setError((e as Error).message);}finally{setLoading(false);}}
 useEffect(()=>{void load()},[]);
 function edit(account?:Account){setError('');setMessage('');setDraft(account?{...blank(),id:account.id,revision:account.revision,name:account.name,login:account.login,active:!!account.active}:blank());}
 function field<K extends keyof Draft>(key:K,value:Draft[K]){setDraft(current=>current?{...current,[key]:value}:current);}
 async function save(event:React.FormEvent){event.preventDefault();if(!draft||busy)return;setBusy(true);setError('');setMessage('');try{const response=await fetch('/vag-oil/api/cashiers',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(draft)}),data:any=await response.json();if(!response.ok)throw Error(data.error||'Не удалось сохранить кассира');setAccounts(data.cashiers);setMessage(data.message);setDraft(null);}catch(e){setError((e as Error).message);}finally{setBusy(false);}}
 return <section className="panel cashierAccounts">
  <div className="cashierAccountsHead"><div><h2><Users size={24}/> Кассиры</h2><p>Личный вход для каждого сотрудника. Имя сохраняется в новых чеках.</p></div><div className="cashierAccountsActions"><button type="button" disabled={loading||busy||!!draft} aria-label="Обновить список кассиров" onClick={()=>void load()}><RefreshCw size={17}/></button><button type="button" className="green" disabled={!loaded||busy||!!draft} onClick={()=>edit()}><Plus size={18}/>Добавить кассира</button></div></div>
  {message&&<p className="notice" role="status">{message}</p>}
  {error&&<p className="error" role="alert">{error}</p>}
  {draft&&<form className="cashierAccountForm" onSubmit={save}>
   <div className="cashierAccountsHead"><h3><KeyRound size={19}/>{draft.id?'Изменить доступ':'Новый кассир'}</h3><button type="button" className="icon" disabled={busy} aria-label="Закрыть форму кассира" onClick={()=>setDraft(null)}><X size={20}/></button></div>
   <div className="cashierAccountFields">
    <label>Имя кассира<input autoFocus required maxLength={80} autoComplete="off" placeholder="Например, Фирдавс" disabled={busy} value={draft.name} onChange={e=>field('name',e.target.value)}/></label>
    <label>Логин<input required minLength={3} maxLength={32} pattern="[a-zA-Z0-9._\-]{3,32}" autoComplete="off" autoCapitalize="none" spellCheck={false} placeholder="Например, firdavs" disabled={busy} value={draft.login} onChange={e=>field('login',e.target.value)}/><small>Латинские буквы и цифры, от 3 символов.</small></label>
    <label>{draft.id?'Новый пароль — если нужно изменить':'Пароль кассира'}<input type="password" autoComplete="new-password" required={!draft.id} maxLength={256} disabled={busy} value={draft.password} onChange={e=>field('password',e.target.value)}/><small>4 цифры или не менее 10 символов.{draft.id?' Пустое поле сохранит прежний пароль.':''}</small></label>
    <label>Повторите пароль<input type="password" autoComplete="new-password" required={!draft.id||!!draft.password} maxLength={256} disabled={busy} value={draft.confirmPassword} onChange={e=>field('confirmPassword',e.target.value)}/></label>
    <label>Ваш пароль директора<input type="password" autoComplete="current-password" required maxLength={256} disabled={busy} value={draft.currentPassword} onChange={e=>field('currentPassword',e.target.value)}/><small>Подтверждает изменение доступа сотрудника.</small></label>
    <label className="cashierAccountEnabled"><input type="checkbox" disabled={busy} checked={draft.active} onChange={e=>field('active',e.target.checked)}/>Доступ к кассе включён</label>
   </div>
   <div className="cashierAccountFormFoot"><small>После изменения сотруднику нужно войти заново. Отключение доступа на устройстве без интернета сработает при подключении.</small><button type="button" disabled={busy} onClick={()=>setDraft(null)}>Отмена</button><button className="green" disabled={busy}>{busy?'Сохранение…':'Сохранить кассира'}</button></div>
  </form>}
  {loading&&!loaded?<p role="status">Загрузка кассиров…</p>:loaded&&accounts.length===0?<div className="cashierAccountsEmpty"><Users size={30}/><h3>Добавьте первого кассира</h3><p>Задайте имя, логин и пароль. Сотрудник сможет войти в кассу на своём телефоне или компьютере.</p></div>:<div className="cashierAccountsTable"><table><thead><tr><th>Сотрудник</th><th>Логин</th><th>Доступ</th><th>Действия</th></tr></thead><tbody>{accounts.map(account=><tr key={account.id}><td><b>{account.name}</b></td><td><span className="cashierLogin">{account.login}</span></td><td><span className={'cashierAccessBadge '+(account.active?'enabled':'disabled')}>{account.active?'Включён':'Отключён'}</span></td><td><div className="cashierAccountsActions"><button type="button" disabled={busy||!!draft} onClick={()=>edit(account)}><KeyRound size={16}/>Изменить</button><button type="button" disabled={busy||!!draft} onClick={()=>onSales(account.id)}><Receipt size={16}/>Продажи</button></div></td></tr>)}</tbody></table></div>}
  <div className="cashierAccountsHelp"><b>Как увидеть, кто продал товар</b><p>Откройте «История продаж» и выберите кассира. В каждом новом чеке также будет его имя. Сотрудникам нужно входить под своим логином.</p>{legacyLogin&&<p>Прежний общий вход <b>{legacyLogin}</b> работает с подписью «Общий кассир». У старых чеков без автора будет «Не указан».</p>}</div>
 </section>;
}
