// Social provider seam. MOCK until real API keys land (pending app approval):
// postToProvider returns the same {status, ref} shape a real Twitter/Meta client
// would, so only this function body changes when integrations go live.

export type SocialProvider = 'facebook' | 'instagram' | 'x' | 'linkedin';
export const SOCIAL_PROVIDERS: readonly SocialProvider[] = ['facebook', 'instagram', 'x', 'linkedin'];
export const PROVIDER_LABELS: Record<SocialProvider, string> = {
  facebook: 'Facebook', instagram: 'Instagram', x: 'X', linkedin: 'LinkedIn',
};

// Per-provider content limits (X is the tight one). Enforced at compose + post.
export const PROVIDER_MAX_CHARS: Record<SocialProvider, number> = {
  facebook: 5000, instagram: 2200, x: 280, linkedin: 3000,
};

export function isSocialProvider(v: unknown): v is SocialProvider {
  return typeof v === 'string' && (SOCIAL_PROVIDERS as readonly string[]).includes(v);
}

export interface SocialResult {
  status: 'posted' | 'failed';
  providerRef?: string;
  error?: string;
}

/**
 * Post content to a provider. Mock: rejects over-limit content (a real failure
 * mode worth surfacing), otherwise "posts" with a synthetic ref. A live
 * integration swaps the body for the provider's SDK call gated on its own key.
 */
export async function postToProvider(provider: SocialProvider, content: string, idempotencyKey: string): Promise<SocialResult> {
  const max = PROVIDER_MAX_CHARS[provider];
  if (content.length > max) {
    return { status: 'failed', error: `content exceeds ${provider} limit of ${max} chars` };
  }
  // Deterministic synthetic ref (no Math.random — keeps the seam reproducible).
  return { status: 'posted', providerRef: `mock_${provider}_${idempotencyKey.slice(0, 12)}` };
}
