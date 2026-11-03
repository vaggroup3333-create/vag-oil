'use client';
import {useEffect,useRef,useState} from 'react';
import {DraftSaveQueue} from '../lib/draft-autosave';
export function useDraftAutosave(enabled:boolean,key:string,action:any,busy:boolean,save:(action:any)=>Promise<unknown>){
 const [status,setStatus]=useState('');const failed=useRef('');const callback=useRef(save);callback.current=save;
 const queue=useRef<{key:string,queue:DraftSaveQueue<any>}|null>(null);
 if(enabled&&queue.current?.key!==key)queue.current={key,queue:new DraftSaveQueue(async value=>{setStatus('Сохранение черновика…');let ok=false;try{ok=!!await callback.current(value)}catch{}failed.current=ok?'':JSON.stringify(value);setStatus(ok?'Черновик сохранён автоматически':'Не удалось сохранить. Проверьте поля и соединение.');return ok})};
 const signature=JSON.stringify(action);
 useEffect(()=>{
  if(!enabled)return;
  const q=queue.current!.queue;q.update(action);if(!q.dirty||failed.current===signature)return;
  setStatus('Изменения ожидают сохранения…');if(busy)return;
  const timer=setTimeout(()=>void q.flush(),800);return()=>clearTimeout(timer);
 },[enabled,key,signature,busy]);
 useEffect(()=>{if(!enabled)return;const warn=(e:BeforeUnloadEvent)=>{if(queue.current?.queue.dirty){e.preventDefault();e.returnValue=''}};window.addEventListener('beforeunload',warn);return()=>window.removeEventListener('beforeunload',warn)},[enabled]);
 useEffect(()=>{if(!enabled)return;const retry=()=>void queue.current?.queue.flush();window.addEventListener('online',retry);return()=>window.removeEventListener('online',retry)},[enabled]);
 return {status,async flush(){if(!enabled)return true;queue.current!.queue.update(action);return queue.current!.queue.flush()}};
}
