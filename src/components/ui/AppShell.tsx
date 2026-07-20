import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { IconButton } from './Button';

interface AppShellProps {
  navigation: ReactNode;
  banner?: ReactNode;
  header?: ReactNode;
  children: ReactNode;
  mobileNavigation?: ReactNode;
}

export function AppShell({ banner, children, header, mobileNavigation, navigation }: AppShellProps) {
  const [mobileNavigationOpen, setMobileNavigationOpen] = useState(false);
  const navigationRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const navigationId = useId();

  useEffect(() => {
    if (!mobileNavigationOpen) return;
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const focusables = () => Array.from(navigationRef.current?.querySelectorAll<HTMLElement>('a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])') ?? []);
    navigationRef.current?.querySelector<HTMLElement>('[data-mobile-nav-close]')?.focus();
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') { event.preventDefault(); setMobileNavigationOpen(false); return; }
      if (event.key !== 'Tab') return;
      const items = focusables();
      const first = items[0];
      const last = items.at(-1);
      if (!first || !last) return;
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    }
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('keydown', onKeyDown);
      previous?.focus();
    };
  }, [mobileNavigationOpen]);

  return (
    <div className="app-shell ui-app-shell">
      {mobileNavigationOpen && <button className="ui-app-shell__nav-backdrop" type="button" aria-label="Dismiss navigation overlay" onClick={() => setMobileNavigationOpen(false)} />}
      <div ref={navigationRef} id={navigationId} className={`ui-app-shell__navigation${mobileNavigationOpen ? ' is-open' : ''}`} role={mobileNavigationOpen ? 'dialog' : undefined} aria-label={mobileNavigationOpen ? 'Navigation' : undefined} aria-modal={mobileNavigationOpen || undefined} onClick={(event) => { if ((event.target as HTMLElement).closest('a[href]')) setMobileNavigationOpen(false); }}>
        <div className="ui-app-shell__nav-title"><span>Navigation</span><IconButton data-mobile-nav-close variant="quiet" label="Close navigation" onClick={() => setMobileNavigationOpen(false)}>×</IconButton></div>
        {navigation}
      </div>
      <div className="ui-app-shell__content">
        {banner}
        <div className="ui-app-shell__chrome">
          <IconButton ref={triggerRef} className="ui-app-shell__nav-trigger" variant="quiet" label="Open navigation" aria-controls={navigationId} aria-expanded={mobileNavigationOpen} onClick={() => setMobileNavigationOpen(true)}>☰</IconButton>
          {header}
        </div>
        <main className="main ui-app-shell__main">{children}</main>
        {mobileNavigation && <nav className="ui-app-shell__mobile-nav" aria-label="Task navigation">{mobileNavigation}</nav>}
      </div>
    </div>
  );
}
