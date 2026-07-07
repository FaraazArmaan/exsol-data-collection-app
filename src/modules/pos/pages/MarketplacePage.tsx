import { useState } from 'react';
import { EcommerceNav } from './EcommerceNav';

// Staff marketplace feed export (/c/:slug/pos/marketplace). Generates a per-
// catalog product feed for one marketplace by downloading the file from
// /api/pos/marketplace-feed. No live seller APIs — export only. Gated on
// pos.sale.refund (RouteMount mirrors it).

const MARKETPLACES = [
  { key: 'amazon', label: 'Amazon', desc: 'Inventory Loader flat file (.tsv)' },
  { key: 'flipkart', label: 'Flipkart', desc: 'Catalog upload sheet' },
  { key: 'meta', label: 'Meta (Facebook/Instagram)', desc: 'Commerce catalog feed' },
] as const;

const ERRORS: Record<string, string> = {
  no_products: 'No storefront-visible products to export yet.',
  invalid_platform: 'Unsupported marketplace.',
  download_failed: 'Export failed — try again.',
};

export default function MarketplacePage() {
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function download(platform: string) {
    setError(null);
    setBusy(platform);
    try {
      const res = await fetch(`/api/pos/marketplace-feed?platform=${platform}`, { credentials: 'include' });
      if (!res.ok) {
        const b = await res.json().catch(() => ({}));
        throw new Error(b?.error?.code ?? 'download_failed');
      }
      const blob = await res.blob();
      const cd = res.headers.get('Content-Disposition') ?? '';
      const name = /filename="(.+?)"/.exec(cd)?.[1] ?? `${platform}-feed.txt`;
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = name;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="pos-market">
      <EcommerceNav active="marketplace" />
      <header>
        <h1>Marketplace feeds</h1>
        <p className="muted">Export your storefront catalog as a product feed. Upload it to the marketplace — no live sync.</p>
      </header>

      {error && <div className="err">{ERRORS[error] ?? error}</div>}

      <div className="pos-market__grid">
        {MARKETPLACES.map((m) => (
          <div key={m.key} className="pos-market__card">
            <div className="pos-market__name">{m.label}</div>
            <div className="pos-market__desc">{m.desc}</div>
            <button className="pos-side-cart__checkout" onClick={() => download(m.key)} disabled={busy === m.key}>
              {busy === m.key ? 'Generating…' : 'Download feed'}
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}
