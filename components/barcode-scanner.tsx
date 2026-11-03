'use client';
import {useEffect,useRef,useState} from 'react';
import {Camera,Flashlight,RefreshCw,X,Plus,ScanLine} from 'lucide-react';
import type {Product} from '../lib/ledger';

type Detection={rawValue:string;format?:string};
type NativeDetector={detect:(video:HTMLVideoElement)=>Promise<Detection[]>};
type DetectorConstructor={new(options:{formats:string[]}):NativeDetector;getSupportedFormats:()=>Promise<string[]>};
type ZXingReader={decode:(video:HTMLVideoElement)=>{getText:()=>string;getBarcodeFormat:()=>number};reset:()=>void};
type ZXingLibrary={BrowserMultiFormatReader:new(hints:Map<unknown,unknown>)=>ZXingReader;DecodeHintType:Record<string,number>;BarcodeFormat:Record<string,number>};
type CameraWindow=Window&{BarcodeDetector?:DetectorConstructor;ZXing?:ZXingLibrary};
let decoderLoad:Promise<ZXingLibrary>|undefined;
function loadDecoder(){
 const w=window as CameraWindow;
 if(w.ZXing)return Promise.resolve(w.ZXing);
 if(!decoderLoad)decoderLoad=new Promise<ZXingLibrary>((resolve,reject)=>{
  const script=document.createElement('script');script.src='/vag-oil/vendor/zxing-0.21.3.min.js?v=0.52.1';script.async=true;
  const fail=(message:string)=>{clearTimeout(timer);script.remove();reject(Error(message))};
  const timer=setTimeout(()=>fail('Загрузка сканера заняла слишком много времени. Проверьте интернет и нажмите «Повторить».'),15000);
  script.onload=()=>{clearTimeout(timer);if(typeof w.ZXing?.BrowserMultiFormatReader==='function')resolve(w.ZXing);else fail('Не загрузился модуль распознавания. Обновите кассу с интернетом и повторите.')};
  script.onerror=()=>fail('Откройте кассу с интернетом один раз для загрузки сканера.');
  document.head.appendChild(script);
 }).catch(e=>{decoderLoad=undefined;throw e});
 return decoderLoad;
}
const normalize=(value:string)=>value.trim().toLocaleLowerCase('ru');
// UPC-A and the same barcode represented as EAN-13 with a leading zero.
function sameBarcode(a:string,b:string){
 a=normalize(a);b=normalize(b);
 if(!a||!b)return false;
 if(a===b)return true;
 const upc=(v:string)=>/^0\d{12}$/.test(v)?v.slice(1):v;
 return /^\d{12,13}$/.test(a)&&/^\d{12,13}$/.test(b)&&upc(a)===upc(b);
}
const money=(n:number)=>new Intl.NumberFormat('ru-RU',{maximumFractionDigits:2}).format(n)+' TJS';
type ScannerProps={products:Product[];availableQuantities?:Record<string,number>;wholesale?:boolean;disabled:boolean;onAdd?:(id:string)=>boolean;onClose:()=>void;mode?:'cashier'|'purchase'|'capture';captureFormat?:'qr'|'barcode';selectedIds?:string[];onCapture?:(code:string)=>void;onCreate?:(code:string,format?:string)=>void};
export function BarcodeScanner({products,availableQuantities,wholesale=false,disabled,onAdd,onClose,mode='cashier',captureFormat,selectedIds=[],onCapture,onCreate}:ScannerProps){
 const video=useRef<HTMLVideoElement>(null),stream=useRef<MediaStream|null>(null),dialog=useRef<HTMLDivElement>(null);
 const [code,setCode]=useState<string|null>(null),[manual,setManual]=useState(''),[error,setError]=useState(''),[errorKind,setErrorKind]=useState('camera'),[status,setStatus]=useState('Открываем камеру…'),[attempt,setAttempt]=useState(0),[torchAvailable,setTorchAvailable]=useState(false),[torch,setTorch]=useState(false);
 const [detectedFormat,setDetectedFormat]=useState<string|undefined>();
 const closeRef=useRef(onClose);closeRef.current=onClose;
 const exact=code?products.filter(p=>sameBarcode(p.barcode||'',code)||!!p.qrCode&&p.qrCode.trim()===code.trim()):[];
 const matches=exact.length?exact:code?products.filter(p=>[p.code,p.article].some(v=>normalize(v||'')===normalize(code))):[];
 useEffect(()=>{
  const previous=document.activeElement as HTMLElement|null;
  dialog.current?.querySelector<HTMLButtonElement>('button')?.focus();
  const key=(e:KeyboardEvent)=>{
   if(e.key==='Escape'){e.preventDefault();e.stopImmediatePropagation();closeRef.current();return}
   if(e.key!=='Tab')return;
   const items=Array.from(dialog.current?.querySelectorAll<HTMLElement>('button:not(:disabled),input:not(:disabled),a[href]')||[]).filter(el=>el.getClientRects().length>0);
   const first=items[0],last=items.at(-1);if(!first)return;
   if(e.shiftKey&&document.activeElement===first){e.preventDefault();last?.focus()}else if(!e.shiftKey&&document.activeElement===last){e.preventDefault();first.focus()}
  };
  document.addEventListener('keydown',key,true);return()=>{document.removeEventListener('keydown',key,true);previous?.focus()};
 },[]);
 useEffect(()=>{
  if(code!==null)return;
  let active=true,timer:ReturnType<typeof setTimeout>|undefined,reader:ZXingReader|undefined;
  const stop=()=>{active=false;clearTimeout(timer);stream.current?.getTracks().forEach(t=>t.stop());stream.current=null;reader?.reset();if(video.current)video.current.srcObject=null};
  setError('');setErrorKind('camera');setStatus('Подготовка сканера…');setTorch(false);setTorchAvailable(false);
  let phase='camera';
  const fallback=async()=>{
   const z=await loadDecoder();
   const names=captureFormat==='qr'?['QR_CODE']:['EAN_13','EAN_8','UPC_A','UPC_E','CODE_128','CODE_39','CODE_93','ITF','CODABAR',...(captureFormat==='barcode'?[]:['QR_CODE'])];
   const formats=names.map(v=>z.BarcodeFormat[v]);reader?.reset();
   reader=new z.BrowserMultiFormatReader(new Map([[z.DecodeHintType.POSSIBLE_FORMATS,formats]]));
   return async(el:HTMLVideoElement):Promise<Detection[]>=>{try{const result=reader!.decode(el);return [{rawValue:result.getText(),format:result.getBarcodeFormat()===z.BarcodeFormat.QR_CODE?'qr_code':'barcode'}]}catch{return []}};
  };
  const run=async()=>{
   try{
    if(!window.isSecureContext||!navigator.mediaDevices?.getUserMedia)throw Error('Для камеры откройте кассу по защищённой ссылке HTTPS в Safari на iPhone или Chrome на Android. Пока можно ввести код товара ниже.');
    let detect:((el:HTMLVideoElement)=>Promise<Detection[]>)|undefined;
    const Constructor=(window as CameraWindow).BarcodeDetector;
    if(Constructor){try{const allowed=await Constructor.getSupportedFormats();const wanted=captureFormat==='qr'?['qr_code']:['ean_13','ean_8','upc_a','upc_e','code_128','code_39','code_93','itf','codabar',...(captureFormat==='barcode'?[]:['qr_code'])];const formats=wanted.filter(f=>allowed.includes(f));if(formats.length&&(captureFormat==='barcode'||formats.includes('qr_code'))){const detector=new Constructor({formats});detect=el=>detector.detect(el)}}catch{}}
    if(!detect){phase='decoder';detect=await fallback()}
    if(!active)return;
    phase='camera';setStatus('Разрешите доступ к камере');
    const media=await navigator.mediaDevices.getUserMedia({audio:false,video:{facingMode:{ideal:'environment'},width:{ideal:1920},height:{ideal:1080}}});
    if(!active){media.getTracks().forEach(t=>t.stop());return}
    stream.current=media;
    const el=video.current;if(!el){stop();return}el.srcObject=media;await el.play();if(!active)return;
    const capabilities=media.getVideoTracks()[0]?.getCapabilities?.() as MediaTrackCapabilities&{torch?:boolean};
    setTorchAvailable(!!capabilities?.torch);setStatus('Наведите камеру на штрихкод или QR товара');
    const tick=async()=>{
     if(!active)return;
     try{
      if(el.readyState>=2){const found=await detect!(el);if(!active)return;const detected=found.find(r=>r.rawValue?.trim()),value=detected?.rawValue.trim();if(value){if(value.length>300){setError('Код длиннее 300 символов. Используйте артикул товара или другой код.');stop();return}setDetectedFormat(detected?.format);setCode(value);setManual(value);navigator.vibrate?.(60);stop();return}}
     }catch{try{detect=await fallback()}catch(e){if(active){setErrorKind('decoder');setError((e as Error).message)}stop();return}}
     if(active)timer=setTimeout(()=>void tick(),250);
    };
    void tick();
   }catch(e){if(!active)return;setErrorKind(phase);const name=(e as Error).name;setError(name==='NotAllowedError'?'Разрешите камеру для этого сайта в настройках Safari или Chrome и нажмите «Повторить».':name==='NotFoundError'?'Камера не найдена. Введите код товара ниже.':name==='NotReadableError'?'Камера занята другим приложением. Закройте его и повторите.':(e as Error).message);stop()}
  };
  void run();
  const hidden=()=>{if(document.hidden&&active){stop();setError('Камера остановлена. Нажмите «Повторить», чтобы продолжить.')}};
  document.addEventListener('visibilitychange',hidden);
  return()=>{stop();document.removeEventListener('visibilitychange',hidden)};
 },[code,attempt,captureFormat]);
 async function toggleTorch(){try{const track=stream.current?.getVideoTracks()[0];if(!track)return;await track.applyConstraints({advanced:[{torch:!torch} as MediaTrackConstraintSet]});setTorch(!torch)}catch{setTorchAvailable(false)}}
 const again=()=>{setCode(null);setDetectedFormat(undefined);setManual('');setAttempt(n=>n+1)};
 return <div className="overlay barcodeOverlay"><div ref={dialog} className="modal barcodeModal" role="dialog" aria-modal="true" aria-labelledby="barcode-title"><div className="modalhead"><h2 id="barcode-title"><ScanLine size={23}/> {captureFormat==='qr'?'Сканировать QR-код':captureFormat==='barcode'?'Сканировать штрихкод':'Штрихкод / QR'}</h2><button type="button" className="icon" onClick={onClose} aria-label="Закрыть сканер"><X/></button></div><div className="modalbody">
  {code===null?<><div className="barcodeViewport"><video ref={video} autoPlay playsInline muted/><div className={captureFormat==='qr'?'barcodeFrame qrFrame':'barcodeFrame'} aria-hidden="true"/><span>{error?(errorKind==='decoder'?'Не загрузился сканер':'Камера остановлена'):status}</span></div><p className="barcodeHint">{captureFormat==='qr'?'Поместите QR-код целиком в рамку.':'Поместите штрихкод или QR целиком в рамку.'} Держите телефон ровно и добавьте света.</p>{torchAvailable&&!error&&<button type="button" onClick={()=>void toggleTorch()} aria-pressed={torch}><Flashlight size={18}/>{torch?'Выключить фонарик':'Включить фонарик'}</button>}</>:<div className="barcodeResult" aria-live="polite"><small>{detectedFormat==='qr_code'?'Считан QR-код':'Считан код'}</small><strong className="barcodeValue">{code}</strong>
   {mode==='capture'?<><p>Код будет внесён в карточку. Затем сохраните товар.</p><button type="button" className="green" disabled={disabled} onClick={()=>onCapture?.(code)}>Использовать этот код</button></>:matches.length===0?<div className="barcodeNotFound"><h3>Товар не найден</h3><p>{mode==='purchase'?'Можно создать новый товар с этим кодом. Если товар уже есть, откройте его карточку и добавьте код.':'Добавьте этот штрихкод или QR в карточку товара в кабинете директора или администратора.'}</p>{mode==='purchase'&&onCreate&&<button type="button" className="green" disabled={disabled} onClick={()=>onCreate(code,detectedFormat)}><Plus size={18}/> Новый товар с этим кодом</button>}</div>:<><p>{matches.length>1?'Этот код подходит к нескольким товарам. Выберите нужный.':'Товар найден — проверьте перед добавлением.'}</p>{matches.map(p=>{const selected=selectedIds.includes(p.id),unavailable=mode==='cashier'&&(availableQuantities?.[p.id]??p.qty)<=0;return <article key={p.id}><small>{p.code} · {p.article}</small><h3>{p.name}</h3>{mode==='cashier'&&<strong>{money(wholesale?p.wholesale:p.price)} / {p.unit}</strong>}<p>На складе: {new Intl.NumberFormat('ru-RU',{maximumFractionDigits:3}).format(p.qty)} {p.unit}</p>{mode==='cashier'&&(availableQuantities?.[p.id]??p.qty)>Math.max(0,p.qty)&&<p>Доступно с учётом черновиков: {availableQuantities?.[p.id]} {p.unit}</p>}<button type="button" className="green" disabled={disabled||selected||unavailable} onClick={()=>{if(onAdd?.(p.id))onClose();else setError(mode==='purchase'?'Не удалось добавить товар. Проверьте накладную и повторите.':'Не удалось добавить: проверьте остаток и количество в чеке.')}}><Plus size={20}/>{selected?'Уже в накладной':unavailable?'Нет в наличии':mode==='purchase'?'Добавить в накладную':'Добавить в чек'}</button></article>})}</>}
   <button type="button" className="barcodeAgain" onClick={again}><Camera size={20}/>Сканировать другой код</button></div>}
  {error&&<div className="error" role="alert">{error}{code===null&&<button type="button" onClick={again}><RefreshCw size={18}/>Повторить</button>}</div>}
  <form className="barcodeManual" onSubmit={e=>{e.preventDefault();if(manual.trim()){setError('');setDetectedFormat(captureFormat==='qr'?'qr_code':undefined);setCode(manual.trim())}}}><label htmlFor="manual-barcode">Или введите код вручную</label><div><input id="manual-barcode" inputMode="text" autoComplete="off" maxLength={300} value={manual} onChange={e=>setManual(e.target.value)} placeholder="Например, MDJ-005"/><button type="submit" disabled={!manual.trim()||disabled}>{mode==='capture'?'Прочитать':'Найти'}</button></div></form><small className="barcodePrivacy">Изображение обрабатывается на устройстве и не отправляется на сервер.</small>
 </div></div></div>;
}
