import { useEffect, useState } from 'react';
import { posApi, PosApiError, type StorefrontSections, type CmsHero } from '../shared/api';

// Staff storefront content editor (/c/:slug/pos/storefront). Edits the hero +
// banners shown on the public /menu/:slug when published. Gated on pos.sale.refund.

const EMPTY_HERO: CmsHero = { enabled: false, heading: '', subheading: '', ctaLabel: '', ctaHref: '' };

export default function StorefrontCmsPage() {
  const [hero, setHero] = useState<CmsHero>(EMPTY_HERO);
  const [banners, setBanners] = useState<string[]>([]);
  const [published, setPublished] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [state, setState] = useState<'loading' | 'idle' | 'saving' | 'saved'>('loading');

  useEffect(() => {
    posApi.getCms()
      .then((r) => {
        setHero({ ...EMPTY_HERO, ...(r.sections.hero ?? {}) });
        setBanners((r.sections.banners ?? []).map((b) => b.text));
        setPublished(r.published);
        setState('idle');
      })
      .catch((e) => { setError(e instanceof PosApiError ? e.code : 'network_error'); setState('idle'); });
  }, []);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setState('saving');
    setError(null);
    const sections: StorefrontSections = {
      hero,
      banners: banners.filter((t) => t.trim() !== '').map((t) => ({ text: t.trim() })),
    };
    try {
      await posApi.putCms({ sections, published });
      setState('saved');
      setTimeout(() => setState('idle'), 1500);
    } catch (e) {
      setError(e instanceof PosApiError ? e.code : 'network_error');
      setState('idle');
    }
  }

  if (state === 'loading') return <p className="pos-loading">Loading…</p>;

  return (
    <div className="pos-cms">
      <header className="pos-cms__header">
        <h1>Storefront content</h1>
        <label className="pos-cms__pub">
          <input type="checkbox" checked={published} onChange={(e) => setPublished(e.target.checked)} />
          Published
        </label>
      </header>

      <form className="pos-cms__form" onSubmit={save}>
        <fieldset className="pos-cms__section">
          <legend>Hero</legend>
          <label className="pos-cms__toggle">
            <input type="checkbox" checked={hero.enabled} onChange={(e) => setHero({ ...hero, enabled: e.target.checked })} />
            Show hero banner
          </label>
          <label>Heading
            <input value={hero.heading} onChange={(e) => setHero({ ...hero, heading: e.target.value })} placeholder="Welcome to Papa's Saloon" />
          </label>
          <label>Subheading
            <input value={hero.subheading ?? ''} onChange={(e) => setHero({ ...hero, subheading: e.target.value })} placeholder="Fresh cuts, booked in seconds" />
          </label>
          <div className="pos-cms__row2">
            <label>CTA label
              <input value={hero.ctaLabel ?? ''} onChange={(e) => setHero({ ...hero, ctaLabel: e.target.value })} placeholder="Book now" />
            </label>
            <label>CTA link
              <input value={hero.ctaHref ?? ''} onChange={(e) => setHero({ ...hero, ctaHref: e.target.value })} placeholder="/book" />
            </label>
          </div>
        </fieldset>

        <fieldset className="pos-cms__section">
          <legend>Banners</legend>
          {banners.map((b, i) => (
            <div key={i} className="pos-cms__banner">
              <input value={b} onChange={(e) => setBanners((bs) => bs.map((x, idx) => (idx === i ? e.target.value : x)))} placeholder="Free delivery over ₹500" />
              <button type="button" className="pos-bundles__x" onClick={() => setBanners((bs) => bs.filter((_, idx) => idx !== i))}>×</button>
            </div>
          ))}
          {banners.length < 5 && (
            <button type="button" className="pos-bundles__add" onClick={() => setBanners((bs) => [...bs, ''])}>+ Add banner</button>
          )}
        </fieldset>

        {error && <div className="err">Error: {error}</div>}
        <button className="pos-side-cart__checkout" type="submit" disabled={state === 'saving'}>
          {state === 'saving' ? 'Saving…' : state === 'saved' ? 'Saved ✓' : 'Save'}
        </button>
      </form>
    </div>
  );
}
