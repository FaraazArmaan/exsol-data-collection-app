import { useState } from 'react';

interface Props {
  value: { name: string; phone: string; email: string };
  onChange: (patch: Partial<Props['value']>) => void;
}

export function CustomerForm({ value, onChange }: Props) {
  const [errors, setErrors] = useState<{ name?: string; phone?: string; email?: string }>({});
  const blurValidate = (k: 'name' | 'phone' | 'email') => () => {
    if (k === 'name'  && !value.name.trim())  return setErrors((e) => ({ ...e, name:  'Required' }));
    if (k === 'phone' && !value.phone.trim()) return setErrors((e) => ({ ...e, phone: 'Required' }));
    if (k === 'email' && value.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.email)) {
      return setErrors((e) => ({ ...e, email: 'Invalid email' }));
    }
    setErrors((e) => ({ ...e, [k]: undefined }));
  };
  return (
    <div className="pos-customer-form">
      <label>
        Name *
        <input value={value.name}  onChange={(e) => onChange({ name:  e.target.value })} onBlur={blurValidate('name')}  />
        {errors.name  ? <span className="err">{errors.name}</span>  : null}
      </label>
      <label>
        Phone *
        <input value={value.phone} onChange={(e) => onChange({ phone: e.target.value })} onBlur={blurValidate('phone')} />
        {errors.phone ? <span className="err">{errors.phone}</span> : null}
      </label>
      <label>
        Email
        <input value={value.email} onChange={(e) => onChange({ email: e.target.value })} onBlur={blurValidate('email')} />
        {errors.email ? <span className="err">{errors.email}</span> : null}
      </label>
    </div>
  );
}
