import { forwardRef, useId, type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes, type TextareaHTMLAttributes } from 'react';

interface FieldProps {
  label: string;
  labelHidden?: boolean;
  help?: ReactNode;
  error?: string;
  required?: boolean;
  children: (props: { id: string; 'aria-describedby'?: string; 'aria-invalid'?: true }) => ReactNode;
}

export function Field({ children, error, help, label, labelHidden = false, required = false }: FieldProps) {
  const id = useId();
  const helpId = useId();
  const errorId = useId();
  const describedBy = [help && helpId, error && errorId].filter(Boolean).join(' ') || undefined;
  return (
    <div className="ui-field">
      <label className={`ui-field__label${labelHidden ? ' ui-field__label--sr-only' : ''}`} htmlFor={id}>{label}{required && <span aria-hidden="true"> *</span>}</label>
      {children({ id, 'aria-describedby': describedBy, 'aria-invalid': error ? true : undefined })}
      {help && <div id={helpId} className="ui-field__help">{help}</div>}
      {error && <div id={errorId} className="ui-field__error">{error}</div>}
    </div>
  );
}

export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(function Input({ className, ...props }, ref) {
  return <input ref={ref} className={['ui-input', className].filter(Boolean).join(' ')} {...props} />;
});

export const Select = forwardRef<HTMLSelectElement, SelectHTMLAttributes<HTMLSelectElement>>(function Select({ className, ...props }, ref) {
  return <select ref={ref} className={['ui-input', className].filter(Boolean).join(' ')} {...props} />;
});

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaHTMLAttributes<HTMLTextAreaElement>>(function Textarea({ className, ...props }, ref) {
  return <textarea ref={ref} className={['ui-input', 'ui-textarea', className].filter(Boolean).join(' ')} {...props} />;
});

export interface FormIssue { id: string; message: string; }

export function focusFirstInvalid(issues: readonly FormIssue[]): void {
  if (issues[0]) document.getElementById(issues[0].id)?.focus();
}

export function FormSummary({ issues }: { issues: readonly FormIssue[] }) {
  if (issues.length === 0) return null;
  return (
    <section className="ui-form-summary" role="alert" tabIndex={-1}>
      <strong>Check the highlighted fields.</strong>
      <ul>{issues.map((issue) => <li key={issue.id}><a href={`#${issue.id}`}>{issue.message}</a></li>)}</ul>
    </section>
  );
}
