'use client';
import {useEffect,useState} from 'react';
import {createPortal} from 'react-dom';
import {Download,X} from 'lucide-react';
export function InstallAppButton({cashier=false}:{cashier?:boolean}){
 const [prompt,setPrompt]=useState<any>(null),[open,setOpen]=useState(false),[platform,setPlatform]=useState('browser'),[installed,setInstalled]=useState(false),[origin,setOrigin]=useState('');
 const appHref=cashier?'/vag-oil/cashier':'/vag-oil/';
 useEffect(()=>{
  setOrigin(window.location.origin);
  const ios=/iPhone|iPad|iPod/.test(navigator.userAgent)||(navigator.platform==='MacIntel'&&navigator.maxTouchPoints>1);setPlatform(ios?'ios':/Android/.test(navigator.userAgent)?'android':'desktop');
  const link=document.querySelector<HTMLLinkElement>('link[rel="manifest"]');if(link)link.href=cashier?'/vag-oil/cashier.webmanifest':'/vag-oil/director.webmanifest';
  const media=matchMedia('(display-mode: standalone)');setInstalled(media.matches||(navigator as any).standalone===true);
  const before=(e:Event)=>{e.preventDefault();setPrompt(e)};const done=()=>{setInstalled(true);setPrompt(null);setOpen(false)};
  window.addEventListener('beforeinstallprompt',before);window.addEventListener('appinstalled',done);return()=>{window.removeEventListener('beforeinstallprompt',before);window.removeEventListener('appinstalled',done)};
 },[cashier]);
 if(installed)return null;
 return <><button type="button" className="installAppButton" title="Установить VAG Oil" onClick={async()=>{if(prompt){await prompt.prompt();const result=await prompt.userChoice;if(result.outcome==='accepted')setInstalled(true);setPrompt(null)}else setOpen(true)}}><Download size={17}/><span>Установить</span></button>{open&&createPortal(<div className="overlay"><div className="modal installGuide" role="dialog" aria-modal="true" aria-labelledby="install-guide-title"><div className="modalhead"><h2 id="install-guide-title">Установить {cashier?'кассу':'кабинет'} VAG Oil</h2><button type="button" className="icon" aria-label="Закрыть инструкцию установки" onClick={()=>setOpen(false)}><X size={21}/></button></div><div className="modalbody"><p>Приложение появится на главном экране и будет открываться отдельным значком.</p>{platform==='ios'?<ol><li>Откройте эту страницу в <b>Safari</b>.</li><li>Нажмите <b>«Поделиться»</b> — квадрат со стрелкой вверх.</li><li>Выберите <b>«На экран Домой»</b>. Если доступно, включите «Открывать как веб-приложение».</li><li>Нажмите <b>«Добавить»</b>.</li></ol>:platform==='android'?<ol><li>Откройте страницу в <b>Chrome</b>.</li><li>Откройте меню <b>⋮</b>.</li><li>Выберите <b>«Установить приложение»</b> или «Добавить на главный экран».</li></ol>:<ol><li>Откройте страницу в <b>Chrome или Edge</b>.</li><li>Нажмите значок установки в адресной строке или выберите установку приложения в меню браузера.</li><li>Подтвердите установку. Появится отдельный значок VAG Oil.</li></ol>}<p><b>Адрес:</b><br/><a href={appHref}>{origin+appHref}</a></p>{cashier?<p>После установки войдите с интернетом и дождитесь «Касса готова без интернета». Перед работой без связи проверьте, что товары загрузились.</p>:<p>Для кабинета директора нужен интернет. Для продаж без связи установите отдельно кассу.</p>}<small>Доступ остаётся по логину и паролю. Установка не переносит неотправленные чеки между браузерами и устройствами — сначала синхронизируйте их в прежней кассе.</small></div><div className="modalfoot"><button className="green" onClick={()=>setOpen(false)}>Понятно</button></div></div></div>,document.body)}</>;
}
