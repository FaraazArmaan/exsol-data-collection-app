import { useMemo, useRef, useState } from 'react';
import type { Brand, DownscaleKind } from './types';
import { downscaleImage } from './downscale';
import { BRAND_FONT_ALLOWLIST, isHexColor, suggestAccentFromLogo } from './branding';

export interface BrandingApi {
  uploadImage(kind: DownscaleKind, file: File): Promise<{ key: string }>;
  patch(body: Record<string, unknown>): Promise<void>;
}

type BrandUrlField = 'logoUrl' | 'logoAltUrl' | 'faviconUrl' | 'appIconUrl' | 'socialUrl';

const LOGO_KINDS: {
  kind: DownscaleKind; label: string; field: string; urlKey: BrandUrlField; hint: string;
}[] = [
  { kind: 'logo',     label: 'Primary logo',   field: 'logoKey',     urlKey: 'logoUrl',    hint: 'Header · any size' },
  { kind: 'logo_alt', label: 'Alternate logo', field: 'logoAltKey',  urlKey: 'logoAltUrl', hint: 'For light backgrounds' },
  { kind: 'favicon',  label: 'Favicon',        field: 'faviconKey',  urlKey: 'faviconUrl', hint: 'Browser tab · 64×64' },
  { kind: 'app_icon', label: 'App icon',       field: 'appIconKey',  urlKey: 'appIconUrl', hint: 'Home screen · 512×512' },
  { kind: 'social',   label: 'Social image',   field: 'socialKey',   urlKey: 'socialUrl',  hint: 'Share cards · 1200×630' },
];

// Hero URLs are /api/public/brand/<slug>/image/<key>; recover the stored key.
function keyFromHeroUrl(url: string): string | null {
  const i = url.indexOf('/image/');
  return i >= 0 ? url.slice(i + '/image/'.length) : null;
}

const FONT_CATEGORIES: { key: string; label: string }[] = [
  { key: 'sans', label: 'Sans-serif' }, { key: 'serif', label: 'Serif' },
  { key: 'display', label: 'Display' }, { key: 'mono', label: 'Monospace' },
];

function IconUpload() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
      <polyline points="17 8 12 3 7 8" /><line x1="12" y1="3" x2="12" y2="15" />
    </svg>
  );
}
function IconTrash() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <polyline points="3 6 5 6 21 6" /><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
    </svg>
  );
}

export function BrandingForm({ brand, api, onSaved }: { brand: Brand | null; api: BrandingApi; onSaved?: () => void }) {
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [accent, setAccent] = useState(brand?.accent ?? '');
  // Client-side previews keyed by kind (object URLs), layered over stored URLs.
  const [previews, setPreviews] = useState<Record<string, string>>({});
  const [heroPreviews, setHeroPreviews] = useState<string[]>([]);
  const [primaryLogoFile, setPrimaryLogoFile] = useState<File | null>(null);
  const logoRefs = useRef<Record<string, HTMLInputElement | null>>({});
  const heroRef = useRef<HTMLInputElement | null>(null);

  const swatchValue = isHexColor(accent) ? accent : '#3b82f6';

  async function patch(body: Record<string, unknown>) {
    setBusy('patch'); setErr(null);
    try { await api.patch(body); onSaved?.(); }
    catch { setErr('Save failed. Try again.'); }
    finally { setBusy(null); }
  }

  async function onPickImage(kind: DownscaleKind, field: string, file: File) {
    setBusy(kind); setErr(null);
    setPreviews((p) => ({ ...p, [kind]: URL.createObjectURL(file) }));
    if (kind === 'logo') setPrimaryLogoFile(file);
    try {
      const scaled = await downscaleImage(file, kind);
      const { key } = await api.uploadImage(kind, scaled);
      await api.patch({ [field]: key });
      if (kind === 'logo' && !accent) {
        const suggested = await suggestAccentFromLogo(file);
        if (suggested) { setAccent(suggested); await api.patch({ accent: suggested }); }
      }
      onSaved?.();
    } catch { setErr('Upload failed. Try again.'); }
    finally { setBusy(null); }
  }

  async function onRemoveLogo(field: string, kind: string) {
    setPreviews((p) => { const n = { ...p }; delete n[kind]; return n; });
    await patch({ [field]: null });
  }

  async function onAddHeroes(files: FileList) {
    setBusy('hero'); setErr(null);
    const local = Array.from(files).map((f) => URL.createObjectURL(f));
    setHeroPreviews((h) => [...h, ...local]);
    try {
      const existing = (brand?.heroUrls ?? []).map(keyFromHeroUrl).filter((k): k is string => !!k);
      const added: string[] = [];
      for (const f of Array.from(files)) {
        const scaled = await downscaleImage(f, 'hero');
        const { key } = await api.uploadImage('hero', scaled);
        added.push(key);
      }
      await api.patch({ heroKeys: [...existing, ...added] });
      onSaved?.();
    } catch { setErr('Hero upload failed.'); }
    finally { setBusy(null); }
  }

  async function suggestFromLogo() {
    if (!primaryLogoFile) return;
    setBusy('suggest'); setErr(null);
    try {
      const s = await suggestAccentFromLogo(primaryLogoFile);
      if (s) { setAccent(s); await api.patch({ accent: s }); }
    } finally { setBusy(null); }
  }

  const heroTiles = useMemo(() => [...(brand?.heroUrls ?? []), ...heroPreviews], [brand?.heroUrls, heroPreviews]);
  const busyAll = busy !== null;

  return (
    <div className="brand-form">
      {/* ── Logos ─────────────────────────────────────────── */}
      <section className="brand-section">
        <div className="brand-section-head">
          <h4>Logos</h4>
          <span className="brand-section-hint">PNG, JPG, or WebP · up to 5&nbsp;MB</span>
        </div>
        <div className="brand-logo-grid">
          {LOGO_KINDS.map(({ kind, label, field, urlKey, hint }) => {
            const src = previews[kind] ?? brand?.[urlKey] ?? null;
            const uploading = busy === kind;
            return (
              <div
                key={kind}
                className={`brand-tile${src ? ' has-image' : ''}${uploading ? ' is-busy' : ''}`}
                onClick={() => { if (!busyAll) logoRefs.current[kind]?.click(); }}
                onDragOver={(e) => { e.preventDefault(); e.currentTarget.classList.add('is-drag'); }}
                onDragLeave={(e) => e.currentTarget.classList.remove('is-drag')}
                onDrop={(e) => {
                  e.preventDefault(); e.currentTarget.classList.remove('is-drag');
                  const f = e.dataTransfer.files?.[0]; if (f && !busyAll) void onPickImage(kind, field, f);
                }}
                role="button" tabIndex={0}
                onKeyDown={(e) => { if ((e.key === 'Enter' || e.key === ' ') && !busyAll) { e.preventDefault(); logoRefs.current[kind]?.click(); } }}
                aria-label={`Upload ${label}`}
              >
                <div className="brand-tile-visual">
                  {src
                    ? <img src={src} alt={label} />
                    : <span className="brand-tile-icon"><IconUpload /></span>}
                  {uploading && <span className="brand-tile-spinner" aria-hidden="true" />}
                </div>
                <div className="brand-tile-meta">
                  <span className="brand-tile-label">{label}</span>
                  <span className="brand-tile-hint">{hint}</span>
                </div>
                {src && !uploading && (
                  <button
                    type="button" className="brand-tile-remove" aria-label={`Remove ${label}`}
                    onClick={(e) => { e.stopPropagation(); void onRemoveLogo(field, kind); }}
                  ><IconTrash /></button>
                )}
                {/* Hidden real input — the tile (or keyboard) triggers it. */}
                <input
                  ref={(el) => { logoRefs.current[kind] = el; }}
                  type="file" accept="image/*" className="brand-visually-hidden"
                  aria-label={label} disabled={busyAll}
                  onChange={(e) => { const f = e.target.files?.[0]; if (f) void onPickImage(kind, field, f); e.target.value = ''; }}
                />
              </div>
            );
          })}
        </div>
      </section>

      {/* ── Hero carousel ─────────────────────────────────── */}
      <section className="brand-section">
        <div className="brand-section-head">
          <h4>Hero carousel</h4>
          <span className="brand-section-hint">Wide banners shown on your storefront</span>
        </div>
        <div
          className="brand-dropzone"
          onClick={() => { if (!busyAll) heroRef.current?.click(); }}
          onDragOver={(e) => { e.preventDefault(); e.currentTarget.classList.add('is-drag'); }}
          onDragLeave={(e) => e.currentTarget.classList.remove('is-drag')}
          onDrop={(e) => {
            e.preventDefault(); e.currentTarget.classList.remove('is-drag');
            const fs = e.dataTransfer.files; if (fs && fs.length && !busyAll) void onAddHeroes(fs);
          }}
          role="button" tabIndex={0}
          onKeyDown={(e) => { if ((e.key === 'Enter' || e.key === ' ') && !busyAll) { e.preventDefault(); heroRef.current?.click(); } }}
        >
          <span className="brand-tile-icon"><IconUpload /></span>
          <div className="brand-dropzone-text">
            <strong>Add hero images</strong>
            <span className="brand-tile-hint">Drag &amp; drop or click to browse · you can add several</span>
          </div>
          <input
            ref={heroRef} type="file" accept="image/*" multiple className="brand-visually-hidden"
            aria-label="Add hero images" disabled={busyAll}
            onChange={(e) => { const fs = e.target.files; if (fs && fs.length) void onAddHeroes(fs); e.target.value = ''; }}
          />
        </div>
        {heroTiles.length > 0 && (
          <div className="brand-hero-strip">
            {heroTiles.map((u, i) => (
              <div key={`${u}-${i}`} className="brand-hero-thumb">
                <img src={u} alt={`Hero ${i + 1}`} />
              </div>
            ))}
          </div>
        )}
      </section>

      {/* ── Colors & theme ────────────────────────────────── */}
      <section className="brand-section">
        <div className="brand-section-head"><h4>Colors &amp; theme</h4></div>

        <div className="brand-field">
          <span className="brand-field-label">Accent color</span>
          <div className="brand-accent-row">
            <label className="brand-swatch-btn" style={{ background: swatchValue }}>
              <input
                type="color" value={swatchValue} aria-label="Accent swatch" disabled={busyAll}
                onChange={(e) => { setAccent(e.target.value); void patch({ accent: e.target.value }); }}
              />
            </label>
            <div className="brand-hex">
              <span className="brand-hex-prefix">#</span>
              <input
                aria-label="Accent color" placeholder="3b82f6"
                value={accent.replace(/^#/, '')}
                onChange={(e) => setAccent('#' + e.target.value.replace(/[^0-9a-fA-F]/g, '').slice(0, 6))}
                onBlur={() => { if (accent === '#' || accent === '') void patch({ accent: null }); else if (isHexColor(accent)) void patch({ accent }); }}
              />
            </div>
            <button
              type="button" className="btn btn-ghost brand-suggest"
              disabled={!primaryLogoFile || busyAll}
              title={primaryLogoFile ? 'Pick a color from your primary logo' : 'Upload a primary logo first'}
              onClick={() => void suggestFromLogo()}
            >Suggest from logo</button>
          </div>
        </div>

        <div className="brand-field">
          <span className="brand-field-label">Theme</span>
          <div className="brand-segment" role="group" aria-label="Theme">
            {(['dark', 'light'] as const).map((t) => {
              const active = (brand?.theme ?? 'dark') === t;
              return (
                <button
                  key={t} type="button"
                  className={`brand-segment-btn${active ? ' is-active' : ''}`}
                  aria-label={`${t === 'dark' ? 'Dark' : 'Light'} theme`} aria-pressed={active}
                  disabled={busyAll}
                  onClick={() => void patch({ theme: t })}
                >
                  <span className={`brand-theme-dot brand-theme-${t}`} aria-hidden="true" />
                  {t === 'dark' ? 'Dark' : 'Light'}
                </button>
              );
            })}
          </div>
        </div>
      </section>

      {/* ── Typography ────────────────────────────────────── */}
      <section className="brand-section">
        <div className="brand-section-head"><h4>Typography</h4></div>
        <div className="brand-font-grid">
          {([['Heading font', 'fontHeading', brand?.fontHeading], ['Body font', 'fontBody', brand?.fontBody]] as const).map(([label, field, current]) => (
            <div className="brand-field" key={field}>
              <span className="brand-field-label">{label}</span>
              <select
                aria-label={label} defaultValue={current ?? ''} disabled={busyAll}
                onChange={(e) => void patch({ [field]: e.target.value || null })}
              >
                <option value="">Default (system)</option>
                {FONT_CATEGORIES.map((cat) => (
                  <optgroup key={cat.key} label={cat.label}>
                    {BRAND_FONT_ALLOWLIST.filter((f) => f.category === cat.key).map((f) => (
                      <option key={f.family} value={f.family}>{f.family}</option>
                    ))}
                  </optgroup>
                ))}
              </select>
              {current && <span className="brand-font-preview" style={{ fontFamily: `"${current}", sans-serif` }}>The quick brown fox</span>}
            </div>
          ))}
        </div>
      </section>

      {err && <p className="brand-card-error" role="alert">{err}</p>}
    </div>
  );
}
