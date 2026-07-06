import { useEffect, useState } from 'react';
import { portfolioApi } from './shared/api';
import { mergeSections } from './shared/sections';
import type { SiteSections } from './shared/types';
import { canEditSite } from './shared/permissions';
import { useUserAuth } from '../user-portal/user-auth-context';

const SECTION_LABELS: Record<keyof SiteSections, string> = {
  hero: 'Hero banner',
  products: 'Product / service grid',
  gallery: 'Photo gallery',
  booking: 'Booking call-to-action',
  contact: 'Contact block',
};
const SECTION_HINTS: Record<keyof SiteSections, string> = {
  hero: 'Logo, business name, tagline',
  products: 'Your storefront catalogue',
  gallery: 'Your brand hero images',
  booking: 'A “Book now” button linking to your booking page',
  contact: 'Email, phone, address',
};

export default function BrandSiteEditorPage({ slug }: { slug: string; perms: ReadonlySet<string> }) {
  const { user, permissions } = useUserAuth();
  const editable = canEditSite(permissions, user?.level_number);

  const [sections, setSections] = useState<SiteSections | null>(null);
  const [published, setPublished] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [savedAt, setSavedAt] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    setError(null);
    setSections(null);
    portfolioApi.getConfig()
      .then((r) => { if (alive) { setSections(mergeSections(r.sections)); setPublished(r.published); } })
      .catch((e) => { if (alive) setError(e?.code ?? 'load_failed'); });
    return () => { alive = false; };
  }, []);

  async function save(nextPublished = published) {
    if (!sections || !editable) return;
    setBusy(true);
    setError(null);
    try {
      const r = await portfolioApi.saveConfig(sections, nextPublished);
      setPublished(r.published);
      setSavedAt(new Date().toLocaleTimeString());
    } catch (e: unknown) {
      setError((e as { code?: string })?.code ?? 'save_failed');
    } finally {
      setBusy(false);
    }
  }

  if (error && !sections) {
    return (
      <div className="bp-editor">
        <div className="bp-state bp-state-error" role="alert">
          Couldn't load ({error}).{' '}
          <button className="btn btn-ghost" onClick={() => location.reload()}>Retry</button>
        </div>
      </div>
    );
  }
  if (!sections) return <div className="bp-editor"><div className="bp-state">Loading…</div></div>;

  const setEnabled = (key: keyof SiteSections, v: boolean) =>
    setSections((s) => (s ? { ...s, [key]: { ...s[key], enabled: v } } : s));

  return (
    <div className="bp-editor">
      <header className="bp-editor-head">
        <div>
          <h1>Brand Site</h1>
          <p className="bp-sub">
            A public page for your workspace at <code>/site/{slug}</code>. Toggle sections, then publish.
          </p>
        </div>
        <div className="bp-editor-actions">
          {published && (
            <a className="btn btn-ghost" href={`/site/${slug}`} target="_blank" rel="noreferrer">View live site ↗</a>
          )}
          <button className="btn" disabled={!editable || busy} onClick={() => save()}>Save</button>
          <button className="btn btn-primary" disabled={!editable || busy} onClick={() => save(!published)}>
            {published ? 'Unpublish' : 'Publish'}
          </button>
        </div>
      </header>

      <div className={`bp-status${published ? ' is-live' : ''}`}>
        {published ? 'Live — your site is public.' : 'Draft — not visible to the public yet.'}
        {savedAt && <span className="bp-saved"> · saved {savedAt}</span>}
      </div>
      {error && <div className="bp-state bp-state-error" role="alert">Save failed ({error}).</div>}

      <section className="bp-card">
        <h2>Sections</h2>
        {(['hero', 'products', 'gallery', 'booking', 'contact'] as const).map((k) => (
          <label key={k} className="bp-toggle">
            <input
              type="checkbox" checked={sections[k].enabled} disabled={!editable}
              onChange={(e) => setEnabled(k, e.target.checked)}
            />
            <span className="bp-toggle-text">
              <span className="bp-toggle-label">{SECTION_LABELS[k]}</span>
              <span className="bp-toggle-hint">{SECTION_HINTS[k]}</span>
            </span>
          </label>
        ))}
      </section>

      <section className="bp-card">
        <h2>Hero</h2>
        <label className="bp-field">
          <span>Tagline</span>
          <input
            type="text" value={sections.hero.tagline} disabled={!editable}
            placeholder="e.g. Premium grooming in the heart of town"
            onChange={(e) => setSections((s) => (s ? { ...s, hero: { ...s.hero, tagline: e.target.value } } : s))}
          />
        </label>
      </section>

      <section className="bp-card">
        <h2>Contact</h2>
        {(['email', 'phone', 'address'] as const).map((f) => (
          <label key={f} className="bp-field">
            <span>{f.charAt(0).toUpperCase() + f.slice(1)}</span>
            <input
              type="text" value={sections.contact[f]} disabled={!editable}
              onChange={(e) => setSections((s) => (s ? { ...s, contact: { ...s.contact, [f]: e.target.value } } : s))}
            />
          </label>
        ))}
      </section>

      <p className="bp-tier-note">
        Custom domains (yourbrand.com) are available on higher tiers. Your site is served at <code>/site/{slug}</code>.
      </p>
    </div>
  );
}
