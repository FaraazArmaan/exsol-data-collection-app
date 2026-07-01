// Shared branding types. `Brand` is the public payload contract consumed by
// POS, Booking, and any customer-facing surface (see spec §9.1).
export interface Brand {
  name: string;
  logoUrl:     string | null;
  logoAltUrl:  string | null;
  faviconUrl:  string | null;
  appIconUrl:  string | null;
  socialUrl:   string | null;
  heroUrls:    string[];
  accent:      string | null;
  theme:       'dark' | 'light';
  fontHeading: string | null;
  fontBody:    string | null;
}

export type DownscaleKind = 'logo' | 'logo_alt' | 'favicon' | 'app_icon' | 'social' | 'hero';
