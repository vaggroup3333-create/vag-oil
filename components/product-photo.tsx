'use client';

import {useState} from 'react';
import {Dialog} from 'radix-ui';
import {ImagePlus, X, ZoomIn} from 'lucide-react';

/** Viewing a photo never opens or saves the product editor. */
export function ProductPhoto({src, name, className = '', onAdd}: {
  src?: string;
  name: string;
  className?: string;
  onAdd?: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [failed, setFailed] = useState(false);

  if (!src) return <button type="button" className={className}
    aria-label={'Добавить фото: ' + name} title="Добавить фото товара"
    onClick={event => {event.stopPropagation(); onAdd?.();}}
    onDoubleClick={event => event.stopPropagation()}><ImagePlus size={25}/></button>;

  return <Dialog.Root open={open} onOpenChange={value => {setOpen(value); setFailed(false);}}>
    <Dialog.Trigger asChild>
      <button type="button" className={'productPhotoTrigger ' + className}
        aria-label={'Увеличить фото: ' + name} title="Нажмите, чтобы увеличить фото"
        onClick={event => event.stopPropagation()} onDoubleClick={event => event.stopPropagation()}>
        <img src={src} alt={name} loading="lazy"/>
        <span className="productPhotoHint" aria-hidden="true"><ZoomIn size={15}/></span>
      </button>
    </Dialog.Trigger>
    <Dialog.Portal>
      <Dialog.Overlay className="productPhotoBackdrop"/>
      <Dialog.Content className="productPhotoViewer"
        onClick={event => event.stopPropagation()} onDoubleClick={event => event.stopPropagation()}>
        <div className="productPhotoHeading">
          <Dialog.Title className="productPhotoTitle">{name}</Dialog.Title>
          <Dialog.Close asChild><button type="button" className="productPhotoClose" aria-label="Закрыть фото" title="Закрыть фото (Esc)"><X size={24}/></button></Dialog.Close>
        </div>
        <div className="productPhotoStage">
          {failed ? <p role="alert" className="productPhotoError">Не удалось загрузить фото. Закройте окно и попробуйте ещё раз.</p>
            : <img src={src} alt={name} onError={() => setFailed(true)}/>}
        </div>
        <Dialog.Description className="productPhotoCaption">Фото товара · Закрыть — крестик или Esc</Dialog.Description>
      </Dialog.Content>
    </Dialog.Portal>
  </Dialog.Root>;
}
