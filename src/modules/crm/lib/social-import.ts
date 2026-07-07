// Social contact-import provider seam — currently a MOCK (no real API keys).
// mockImportContacts() synthesizes a deterministic batch of contacts so the
// connect → import → leads flow is fully demoable. When real provider OAuth +
// keys land, only these function bodies change; the endpoint/UI stay identical.
// Mirrors the marketing social seam (src/modules/marketing/lib/social.ts).

export const SOCIAL_PROVIDERS = ['google', 'mailchimp', 'facebook'] as const;
export type SocialProvider = (typeof SOCIAL_PROVIDERS)[number];

export const PROVIDER_LABELS: Record<SocialProvider, string> = {
  google: 'Google Contacts',
  mailchimp: 'Mailchimp',
  facebook: 'Facebook Page',
};

/** Mock account label shown after "connecting" a provider. */
export function mockAccountLabel(provider: SocialProvider): string {
  const labels: Record<SocialProvider, string> = {
    google: 'you@gmail.com',
    mailchimp: 'Main audience',
    facebook: 'Business Page',
  };
  return labels[provider];
}

export interface ImportedContact {
  name: string;
  email: string | null;
  phone: string | null;
}

const NAME_POOL = [
  'Ravi Kumar', 'Sneha Rao', 'Imran Sheikh', 'Divya Menon',
  'Arjun Nair', 'Fatima Khan', 'Vikram Singh', 'Meera Iyer',
];

/**
 * Mock a batch of imported contacts. Deterministic given (provider, offset):
 * pass the connection's imported_total as offset so repeat imports yield fresh
 * (non-duplicate) contacts. Returns a small fixed-size batch.
 */
export function mockImportContacts(provider: SocialProvider, offset: number): ImportedContact[] {
  const batch = 4;
  const out: ImportedContact[] = [];
  for (let i = 0; i < batch; i++) {
    const uniq = offset + i;
    out.push({
      name: NAME_POOL[uniq % NAME_POOL.length]!,
      email: `${provider}.contact${uniq}@import.example`,
      phone: null,
    });
  }
  return out;
}
