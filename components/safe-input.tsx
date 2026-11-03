'use client';

import {useEffect, useRef, useState, type InputHTMLAttributes} from 'react';

type Props = InputHTMLAttributes<HTMLInputElement>;

function DecimalInput({value, min, max, step, onChange, ...props}: Props) {
  const [text, setText] = useState(String(value ?? ''));
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => setText(String(value ?? '')), [value]);

  const validate = (raw: string) => {
    if (!raw) return '';
    const normalized = raw.replace(',', '.');
    if (!/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?$/i.test(normalized) || !Number.isFinite(Number(normalized))) {
      return 'Введите число';
    }
    // Use native numeric constraints without displaying a spinbutton.
    const probe = document.createElement('input');
    probe.type = 'number';
    if (min !== undefined) probe.min = String(min);
    if (max !== undefined) probe.max = String(max);
    if (step !== undefined) probe.step = String(step);
    probe.value = String(Number(normalized));
    return probe.validationMessage;
  };
  useEffect(() => {
    input.current?.setCustomValidity(validate(text));
  }, [text, min, max, step]);

  return <input {...props} ref={input} type="text" inputMode="decimal"
    value={text} onChange={event => {
      const raw = event.currentTarget.value;
      const normalized = raw.replace(',', '.');
      setText(raw);
      event.currentTarget.setCustomValidity(validate(raw));
      if (!raw || (/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?$/i.test(normalized) && Number.isFinite(Number(normalized)))) {
        event.currentTarget.value = normalized;
        onChange?.(event);
      }
    }}/>;
}

export function SafeInput(props: Props) {
  return props.type === 'number' ? <DecimalInput {...props}/> : <input {...props}/>;
}
