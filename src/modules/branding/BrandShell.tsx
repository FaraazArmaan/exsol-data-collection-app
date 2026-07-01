import { useEffect } from 'react';
import type { CSSProperties, ReactNode } from 'react';
import { onAccent } from './branding';
import type { Brand } from './types';

interface Props {
  brand?: Brand;
  fallbackName?: string;
  children: ReactNode;
}

export function BrandShell({ brand, fallbackName, children }: Props) {
  const theme = brand?.theme ?? 'dark';
  const accent = brand?.accent ?? null;
  const style: CSSProperties & Record<string, string> = {};
  if (accent) {
    style['--accent'] = accent;
    style['--accent-hover'] = accent;
    style['--text-on-accent'] = onAccent(accent);
  }
  if (brand?.fontHeading) style['--brand-font-heading'] = `"${brand.fontHeading}", var(--font-sans)`;
  if (brand?.fontBody)    style['--brand-font-body']    = `"${brand.fontBody}", var(--font-sans)`;

  // Head-injection: favicon + apple-touch-icon only. Fonts are self-hosted
  // @font-face resolved via the --brand-font-* custom props; no runtime <link>.
  useEffect(() => {
    const created: HTMLElement[] = [];
    const upsert = (rel: string, href: string) => {
      const existing = document.querySelector(`link[rel="${rel}"][data-brand-shell="1"]`);
      if (existing) existing.setAttribute('href', href);
      else {
        const el = document.createElement('link');
        el.rel = rel; el.href = href; el.dataset.brandShell = '1';
        document.head.appendChild(el);
        created.push(el);
      }
    };
    if (brand?.faviconUrl) upsert('icon', brand.faviconUrl);
    if (brand?.appIconUrl) upsert('apple-touch-icon', brand.appIconUrl);
    return () => { created.forEach((el) => el.remove()); };
  }, [brand?.faviconUrl, brand?.appIconUrl]);

  return (
    <div className="brand-shell" data-theme={theme} style={style}>
      <header className="brand-header">
        {brand?.logoUrl
          ? <img className="brand-logo" src={brand.logoUrl} alt={brand.name || fallbackName || 'Brand'} />
          : <span className="brand-tenant">{brand?.name || fallbackName || 'Workspace'}</span>}
      </header>
      <main className="brand-main">{children}</main>
    </div>
  );
}
