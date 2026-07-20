import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { Button } from './Button';

interface SectionSwitcherProps {
  activeLabel: string;
  children: ReactNode;
  label: string;
}

export function SectionSwitcher({ activeLabel, children, label }: SectionSwitcherProps) {
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLElement>(null);
  const panelId = useId();

  useEffect(() => {
    if (!open) return;
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const focusables = () => Array.from(panelRef.current?.querySelectorAll<HTMLElement>('a[href], button:not([disabled]), [tabindex]:not([tabindex="-1"])') ?? []);
    panelRef.current?.querySelector<HTMLElement>('[data-section-switcher-close]')?.focus();
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') { event.preventDefault(); setOpen(false); return; }
      if (event.key !== 'Tab') return;
      const items = focusables();
      const first = items[0];
      const last = items.at(-1);
      if (!first || !last) return;
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    }
    document.addEventListener('keydown', onKeyDown);
    return () => { document.removeEventListener('keydown', onKeyDown); previous?.focus(); };
  }, [open]);

  return (
    <div className="ui-section-switcher">
      <Button ref={triggerRef} variant="secondary" aria-controls={panelId} aria-expanded={open} onClick={() => setOpen(true)}>{label} · {activeLabel} <span aria-hidden>⌄</span></Button>
      {open && <button className="ui-section-switcher__backdrop" type="button" aria-label={`Close ${label}`} onClick={() => setOpen(false)} />}
      <section ref={panelRef} id={panelId} className={`ui-section-switcher__panel${open ? ' is-open' : ''}`} role={open ? 'dialog' : undefined} aria-label={open ? label : undefined} aria-modal={open || undefined} onClick={(event) => { if ((event.target as HTMLElement).closest('a[href]')) setOpen(false); }}>
        <header><strong>{label}</strong><Button data-section-switcher-close variant="quiet" size="compact" onClick={() => setOpen(false)}>Close</Button></header>
        {children}
      </section>
    </div>
  );
}
