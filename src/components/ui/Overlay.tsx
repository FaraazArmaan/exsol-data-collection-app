import { useEffect, useId, useRef, type ReactNode, type RefObject } from 'react';
import { createPortal } from 'react-dom';
import { IconButton } from './Button';

export interface OverlayProps {
  open: boolean;
  title: string;
  description?: string;
  children: ReactNode;
  footer?: ReactNode;
  onClose: () => void;
  variant?: 'dialog' | 'drawer';
  dismissible?: boolean;
  initialFocusRef?: RefObject<HTMLElement | null>;
}

const focusableSelector = 'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

export function Overlay({ children, description, dismissible = true, footer, initialFocusRef, onClose, open, title, variant = 'dialog' }: OverlayProps) {
  const panelRef = useRef<HTMLDivElement>(null);
  const titleId = useId();
  const descriptionId = useId();

  useEffect(() => {
    if (!open) return;
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const previousOverflow = document.body.style.overflow;
    const panel = panelRef.current;
    const focusables = () => panel ? Array.from(panel.querySelectorAll<HTMLElement>(focusableSelector)) : [];
    (initialFocusRef?.current ?? focusables()[0] ?? panel)?.focus();
    document.body.style.overflow = 'hidden';

    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape' && dismissible) { event.preventDefault(); onClose(); return; }
      if (event.key !== 'Tab') return;
      const items = focusables();
      if (items.length === 0) { event.preventDefault(); panel?.focus(); return; }
      const first = items[0];
      const last = items[items.length - 1];
      if (first && last && event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      if (first && last && !event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    }

    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      document.removeEventListener('keydown', onKeyDown);
      previous?.focus();
    };
  }, [dismissible, initialFocusRef, onClose, open]);

  if (!open) return null;
  return createPortal(
    <div className={`ui-overlay ui-overlay--${variant}`} onMouseDown={(event) => { if (dismissible && event.target === event.currentTarget) onClose(); }}>
      <div ref={panelRef} className="ui-overlay__panel" role="dialog" aria-modal="true" aria-labelledby={titleId} aria-describedby={description ? descriptionId : undefined} tabIndex={-1}>
        <header className="ui-overlay__header">
          <div><h2 id={titleId}>{title}</h2>{description && <p id={descriptionId}>{description}</p>}</div>
          {dismissible && <IconButton variant="quiet" label={`Close ${title}`} onClick={onClose}>×</IconButton>}
        </header>
        <div className="ui-overlay__body">{children}</div>
        {footer && <footer className="ui-overlay__footer">{footer}</footer>}
      </div>
    </div>,
    document.body,
  );
}
