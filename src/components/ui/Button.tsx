import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from 'react';

export type ButtonVariant = 'primary' | 'secondary' | 'quiet' | 'danger';
export type ButtonSize = 'compact' | 'comfortable';

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  loading?: boolean;
  loadingLabel?: string;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { children, className, disabled, loading = false, loadingLabel = 'Loading…', size = 'comfortable', variant = 'secondary', ...props },
  ref,
) {
  const classes = ['ui-button', `ui-button--${variant}`, `ui-button--${size}`, className].filter(Boolean).join(' ');
  return (
    <button ref={ref} className={classes} disabled={disabled || loading} aria-busy={loading || undefined} {...props}>
      {loading ? <><span className="ui-button__spinner" aria-hidden />{loadingLabel}</> : children}
    </button>
  );
});

interface IconButtonProps extends Omit<ButtonProps, 'children'> {
  label: string;
  children: ReactNode;
}

export const IconButton = forwardRef<HTMLButtonElement, IconButtonProps>(function IconButton(
  { children, className, label, ...props },
  ref,
) {
  return <Button ref={ref} className={['ui-icon-button', className].filter(Boolean).join(' ')} aria-label={label} {...props}>{children}</Button>;
});
