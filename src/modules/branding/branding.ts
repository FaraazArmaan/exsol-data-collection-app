export function isHexColor(s: string): boolean {
  return /^#[0-9a-fA-F]{6}$/.test(s);
}

function toRgb(hex: string): [number, number, number] {
  return [parseInt(hex.slice(1, 3), 16), parseInt(hex.slice(3, 5), 16), parseInt(hex.slice(5, 7), 16)];
}

// WCAG relative luminance → legible text color painted on the accent.
export function onAccent(hex: string): '#161616' | '#ffffff' {
  const [r, g, b] = toRgb(hex).map((c) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  }) as [number, number, number];
  const lum = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  return lum > 0.45 ? '#161616' : '#ffffff';
}

function hex2(n: number): string { return n.toString(16).padStart(2, '0'); }

// Dominant-vibrant picker: quantize, score by saturation, ignore near-white/
// black/low-saturation pixels.
export function dominantColorFromPixels(data: Uint8ClampedArray): string | null {
  const buckets = new Map<string, { r: number; g: number; b: number; score: number }>();
  for (let i = 0; i + 3 < data.length; i += 4) {
    const r = data[i]!, g = data[i + 1]!, b = data[i + 2]!, a = data[i + 3]!;
    if (a < 128) continue;
    const max = Math.max(r, g, b), min = Math.min(r, g, b);
    const sat = max === 0 ? 0 : (max - min) / max;
    if (max > 240 && min > 240) continue;
    if (max < 24) continue;
    if (sat < 0.2) continue;
    const key = `${r >> 4}-${g >> 4}-${b >> 4}`;
    const cur = buckets.get(key) ?? { r, g, b, score: 0 };
    cur.score += sat;
    buckets.set(key, cur);
  }
  let best: { r: number; g: number; b: number; score: number } | null = null;
  for (const v of buckets.values()) if (!best || v.score > best.score) best = v;
  return best ? `#${hex2(best.r)}${hex2(best.g)}${hex2(best.b)}` : null;
}

// Suggest an accent from an uploaded logo, client-side. Must run on the local
// File (not a stored URL) to avoid CORS/tainted-canvas. Resolves null on failure.
export async function suggestAccentFromLogo(file: File, sampleSize = 48): Promise<string | null> {
  try {
    const bitmap = await createImageBitmap(file);
    const w = Math.max(1, Math.min(sampleSize, bitmap.width));
    const h = Math.max(1, Math.min(sampleSize, bitmap.height));
    const canvas = document.createElement('canvas');
    canvas.width = w; canvas.height = h;
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;
    ctx.drawImage(bitmap, 0, 0, w, h);
    bitmap.close?.();
    return dominantColorFromPixels(ctx.getImageData(0, 0, w, h).data);
  } catch {
    return null;
  }
}

// Curated self-hosted font allowlist. `family` is the exact CSS font-family
// registered by the corresponding @fontsource package (see brand-fonts.ts).
export const BRAND_FONT_ALLOWLIST: readonly {
  family: string;
  category: 'sans' | 'serif' | 'display' | 'mono';
  pkg: string;
  variable: boolean;
}[] = [
  { family: 'Inter',            category: 'sans',    pkg: '@fontsource-variable/inter',            variable: true },
  { family: 'Roboto',           category: 'sans',    pkg: '@fontsource-variable/roboto',           variable: true },
  { family: 'Open Sans',        category: 'sans',    pkg: '@fontsource-variable/open-sans',        variable: true },
  { family: 'Montserrat',       category: 'sans',    pkg: '@fontsource-variable/montserrat',       variable: true },
  { family: 'Poppins',          category: 'sans',    pkg: '@fontsource/poppins',                   variable: false },
  { family: 'Work Sans',        category: 'sans',    pkg: '@fontsource-variable/work-sans',        variable: true },
  { family: 'Merriweather',     category: 'serif',   pkg: '@fontsource-variable/merriweather',     variable: true },
  { family: 'Playfair Display', category: 'serif',   pkg: '@fontsource-variable/playfair-display', variable: true },
  { family: 'Lora',             category: 'serif',   pkg: '@fontsource-variable/lora',             variable: true },
  { family: 'PT Serif',         category: 'serif',   pkg: '@fontsource/pt-serif',                  variable: false },
  { family: 'Bebas Neue',       category: 'display', pkg: '@fontsource/bebas-neue',                variable: false },
  { family: 'Anton',            category: 'display', pkg: '@fontsource/anton',                     variable: false },
  { family: 'JetBrains Mono',   category: 'mono',    pkg: '@fontsource-variable/jetbrains-mono',   variable: true },
  { family: 'Space Mono',       category: 'mono',    pkg: '@fontsource/space-mono',                variable: false },
] as const;

export function isAllowlistedFont(family: string | null | undefined): boolean {
  if (!family) return false;
  return BRAND_FONT_ALLOWLIST.some((f) => f.family === family);
}
