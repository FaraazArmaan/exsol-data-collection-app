// Shared domain types for the Brand Portfolio Site module.

export interface HeroSection { enabled: boolean; tagline: string }
export interface ToggleSection { enabled: boolean }
export interface ContactSection { enabled: boolean; email: string; phone: string; address: string }

export interface SiteSections {
  hero: HeroSection;
  products: ToggleSection;
  gallery: ToggleSection;
  booking: ToggleSection;
  contact: ContactSection;
}

export interface SiteConfig {
  sections: SiteSections;
  published: boolean;
}

export const DEFAULT_SECTIONS: SiteSections = {
  hero: { enabled: true, tagline: '' },
  products: { enabled: true },
  gallery: { enabled: true },
  booking: { enabled: true },
  contact: { enabled: true, email: '', phone: '', address: '' },
};
