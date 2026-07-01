import { useState } from 'react';
import type { Brand, DownscaleKind } from './types';
import { downscaleImage } from './downscale';
import { BRAND_FONT_ALLOWLIST, isHexColor, suggestAccentFromLogo } from './branding';

export interface BrandingApi {
  uploadImage(kind: DownscaleKind, file: File): Promise<{ key: string }>;
  patch(body: Record<string, unknown>): Promise<void>;
}

const LOGO_KINDS: { kind: DownscaleKind; label: string; field: string }[] = [
  { kind: 'logo',     label: 'Primary logo',   field: 'logoKey' },
  { kind: 'logo_alt', label: 'Alternate logo', field: 'logoAltKey' },
  { kind: 'favicon',  label: 'Favicon',        field: 'faviconKey' },
  { kind: 'app_icon', label: 'App icon',       field: 'appIconKey' },
  { kind: 'social',   label: 'Social image',   field: 'socialKey' },
];

// Hero URLs are /api/public/brand/<slug>/image/<key>; recover the stored key.
function keyFromHeroUrl(url: string): string | null {
  const i = url.indexOf('/image/');
  return i >= 0 ? url.slice(i + '/image/'.length) : null;
}

export function BrandingForm({ brand, api, onSaved }: { brand: Brand | null; api: BrandingApi; onSaved?: () => void }) {
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [accent, setAccent] = useState(brand?.accent ?? '');

  async function patch(body: Record<string, unknown>) {
    setBusy('patch'); setErr(null);
    try { await api.patch(body); onSaved?.(); }
    catch { setErr('Save failed. Try again.'); }
    finally { setBusy(null); }
  }

  async function onPickImage(kind: DownscaleKind, field: string, file: File) {
    setBusy(kind); setErr(null);
    try {
      const scaled = await downscaleImage(file, kind);
      const { key } = await api.uploadImage(kind, scaled);
      await api.patch({ [field]: key });
      // Seed the accent from the primary logo if none is set yet.
      if (kind === 'logo' && !accent) {
        const suggested = await suggestAccentFromLogo(file);
        if (suggested) { setAccent(suggested); await api.patch({ accent: suggested }); }
      }
      onSaved?.();
    } catch { setErr('Upload failed. Try again.'); }
    finally { setBusy(null); }
  }

  async function onAddHeroes(files: FileList) {
    setBusy('hero'); setErr(null);
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

  return (
    <div>
      <section className="brand-card-section">
        <h4>Logos</h4>
        {LOGO_KINDS.map(({ kind, label, field }) => (
          <label key={kind} className="brand-upload-slot">
            <span>{label}</span>
            <input type="file" accept="image/*" disabled={busy !== null}
              onChange={(e) => { const f = e.target.files?.[0]; if (f) void onPickImage(kind, field, f); }} />
          </label>
        ))}
      </section>

      <section className="brand-card-section">
        <h4>Hero carousel</h4>
        <input type="file" accept="image/*" multiple disabled={busy !== null}
          aria-label="Add hero images"
          onChange={(e) => { const fs = e.target.files; if (fs && fs.length) void onAddHeroes(fs); }} />
      </section>

      <section className="brand-card-section">
        <h4>Colors &amp; theme</h4>
        <label>
          Accent
          <input aria-label="Accent color" value={accent}
            onChange={(e) => setAccent(e.target.value)}
            onBlur={() => { if (accent === '' || isHexColor(accent)) void patch({ accent: accent === '' ? null : accent }); }} />
        </label>
        <span className="brand-swatch" style={{ background: isHexColor(accent) ? accent : 'transparent' }} />
        <fieldset>
          <legend>Theme</legend>
          <label><input type="radio" name="theme" aria-label="Dark theme" defaultChecked={brand?.theme !== 'light'} onChange={() => void patch({ theme: 'dark' })} /> Dark</label>
          <label><input type="radio" name="theme" aria-label="Light theme" defaultChecked={brand?.theme === 'light'} onChange={() => void patch({ theme: 'light' })} /> Light</label>
        </fieldset>
      </section>

      <section className="brand-card-section">
        <h4>Typography</h4>
        <label>
          Heading font
          <select aria-label="Heading font" defaultValue={brand?.fontHeading ?? ''} onChange={(e) => void patch({ fontHeading: e.target.value || null })}>
            <option value="">Default</option>
            {BRAND_FONT_ALLOWLIST.map((f) => <option key={f.family} value={f.family}>{f.family}</option>)}
          </select>
        </label>
        <label>
          Body font
          <select aria-label="Body font" defaultValue={brand?.fontBody ?? ''} onChange={(e) => void patch({ fontBody: e.target.value || null })}>
            <option value="">Default</option>
            {BRAND_FONT_ALLOWLIST.map((f) => <option key={f.family} value={f.family}>{f.family}</option>)}
          </select>
        </label>
      </section>

      {err && <p className="brand-card-error" role="alert">{err}</p>}
    </div>
  );
}
