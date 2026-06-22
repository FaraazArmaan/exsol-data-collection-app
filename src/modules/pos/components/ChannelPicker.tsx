const opts = [
  { v: 'instore', label: 'Instore' },
  { v: 'online',  label: 'Online' },
  { v: 'pickup',  label: 'Pickup' },
] as const;

export function ChannelPicker(props: {
  value: 'instore' | 'online' | 'pickup';
  onChange: (v: 'instore' | 'online' | 'pickup') => void;
}) {
  return (
    <div role="radiogroup" className="pos-channel">
      {opts.map((o) => (
        <button
          key={o.v}
          role="radio"
          aria-checked={props.value === o.v}
          aria-label={o.label}
          onClick={() => props.onChange(o.v)}
          className={props.value === o.v ? 'is-active' : ''}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}
