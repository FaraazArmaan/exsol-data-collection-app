import { useEffect, useMemo, useState } from 'react';
import { Button } from './Button';
import { Field } from './Field';
import { Overlay } from './Overlay';

interface BasePickerProps {
  disabled?: boolean;
  label: string;
  labelHidden?: boolean;
  required?: boolean;
}

function useNativePicker() {
  const query = '(max-width: 720px), (pointer: coarse)';
  const [native, setNative] = useState(() => typeof window !== 'undefined' && window.matchMedia?.(query).matches === true);
  useEffect(() => {
    const media = window.matchMedia?.(query);
    if (!media) return;
    const update = () => setNative(media.matches);
    update();
    media.addEventListener('change', update);
    return () => media.removeEventListener('change', update);
  }, []);
  return native;
}

function dateFromIso(value: string) {
  return new Date(`${value}T12:00:00`);
}

function todayIso() {
  return isoDate(new Date());
}

function hasDate(value: string) {
  return /^\d{4}-\d{2}-\d{2}$/.test(value);
}

function isoDate(date: Date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

function dateLabel(value: string) {
  if (!hasDate(value)) return 'Choose date';
  return dateFromIso(value).toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' });
}

function timeLabel(value: string) {
  if (!/^\d{2}:\d{2}$/.test(value)) return 'Choose time';
  const [hour, minute] = value.split(':').map(Number);
  return new Date(2000, 0, 1, hour, minute).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
}

export function DateField({ disabled = false, label, labelHidden = false, onChange, required = false, value }: BasePickerProps & { onChange: (value: string) => void; value: string }) {
  const native = useNativePicker();
  const [open, setOpen] = useState(false);
  const selected = hasDate(value) ? dateFromIso(value) : dateFromIso(todayIso());
  const [month, setMonth] = useState(() => new Date(selected.getFullYear(), selected.getMonth(), 1));

  useEffect(() => setMonth(new Date(selected.getFullYear(), selected.getMonth(), 1)), [value]);

  const days = useMemo(() => {
    const start = (month.getDay() + 6) % 7;
    const total = new Date(month.getFullYear(), month.getMonth() + 1, 0).getDate();
    return Array.from({ length: start + total }, (_, index) => index < start ? null : new Date(month.getFullYear(), month.getMonth(), index - start + 1));
  }, [month]);

  return <>
    <Field label={label} labelHidden={labelHidden} required={required}>{({ id, ...aria }) => native ? <input id={id} className="ui-input" type="date" value={value} disabled={disabled} required={required} onChange={(event) => onChange(event.target.value)} {...aria} /> : <Button id={id} variant="secondary" disabled={disabled} aria-label={`${label}: ${dateLabel(value)}`} onClick={() => setOpen(true)} {...aria}>{dateLabel(value)}</Button>}</Field>
    <Overlay open={open} title={`Choose ${label.toLowerCase()}`} onClose={() => setOpen(false)}>
      <div className="ui-picker-dialog">
        <div className="ui-picker-dialog__head"><Button size="compact" variant="quiet" aria-label="Previous month" onClick={() => setMonth((current) => new Date(current.getFullYear(), current.getMonth() - 1, 1))}>‹</Button><strong>{month.toLocaleDateString(undefined, { month: 'long', year: 'numeric' })}</strong><Button size="compact" variant="quiet" aria-label="Next month" onClick={() => setMonth((current) => new Date(current.getFullYear(), current.getMonth() + 1, 1))}>›</Button></div>
        <div className="ui-date-grid" role="grid" aria-label={month.toLocaleDateString(undefined, { month: 'long', year: 'numeric' })}>
          {['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map((day) => <span key={day}>{day}</span>)}
          {days.map((day, index) => day ? <Button key={isoDate(day)} size="compact" variant={isoDate(day) === value ? 'primary' : 'quiet'} aria-pressed={isoDate(day) === value} onClick={() => { onChange(isoDate(day)); setOpen(false); }}>{day.getDate()}</Button> : <span key={`blank-${index}`} aria-hidden />)}
        </div>
      </div>
    </Overlay>
  </>;
}

export function TimeField({ disabled = false, label, labelHidden = false, onChange, required = false, stepMinutes = 15, value }: BasePickerProps & { onChange: (value: string) => void; stepMinutes?: number; value: string }) {
  const native = useNativePicker();
  const [open, setOpen] = useState(false);
  const times = useMemo(() => Array.from({ length: Math.ceil(1440 / stepMinutes) }, (_, index) => {
    const minutes = index * stepMinutes;
    return `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;
  }), [stepMinutes]);

  return <>
    <Field label={label} labelHidden={labelHidden} required={required}>{({ id, ...aria }) => native ? <input id={id} className="ui-input" type="time" step={stepMinutes * 60} value={value} disabled={disabled} required={required} onChange={(event) => onChange(event.target.value)} {...aria} /> : <Button id={id} variant="secondary" disabled={disabled} aria-label={`${label}: ${timeLabel(value)}`} onClick={() => setOpen(true)} {...aria}>{timeLabel(value)}</Button>}</Field>
    <Overlay open={open} title={`Choose ${label.toLowerCase()}`} onClose={() => setOpen(false)}>
      <div className="ui-picker-dialog">
        <p className="ui-picker-dialog__hint">Select a time in {stepMinutes}-minute increments.</p>
        <div className="ui-time-grid" role="listbox" aria-label={`${label} times`}>
          {times.map((time) => <Button key={time} size="compact" variant={time === value ? 'primary' : 'quiet'} role="option" aria-selected={time === value} onClick={() => { onChange(time); setOpen(false); }}>{timeLabel(time)}</Button>)}
        </div>
      </div>
    </Overlay>
  </>;
}
