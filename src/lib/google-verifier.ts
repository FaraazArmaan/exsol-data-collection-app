import { OAuth2Client, type TokenPayload } from 'google-auth-library';
import { opt } from './env.ts';

// Standalone Google id-token verifier. Extracted so tests can mock it
// without touching the production auth path. Both auth-verifier (existing
// sign-in) and invite-accept-google (new flow) call this.

export type GoogleIdentity = {
  sub: string;
  email: string;
  name: string;
  photoUrl: string | null;
  emailVerified: boolean;
};

export type GoogleVerifyError = {
  kind: 'invalid_token' | 'misconfigured' | 'email_not_verified';
  detail?: string;
};

let _client: OAuth2Client | null = null;
function client(): OAuth2Client {
  if (_client) return _client;
  const cid = opt('GOOGLE_OAUTH_CLIENT_ID');
  if (!cid) throw new Error('GOOGLE_OAUTH_CLIENT_ID not configured');
  _client = new OAuth2Client(cid);
  return _client;
}

export async function verifyGoogleIdToken(
  idToken: string,
): Promise<GoogleIdentity | GoogleVerifyError> {
  const cid = opt('GOOGLE_OAUTH_CLIENT_ID');
  if (!cid) return { kind: 'misconfigured', detail: 'no_google_client_id' };

  let payload: TokenPayload | undefined;
  try {
    const ticket = await client().verifyIdToken({ idToken, audience: cid });
    payload = ticket.getPayload();
  } catch (err) {
    return { kind: 'invalid_token', detail: String((err as Error).message ?? err) };
  }
  if (!payload?.sub || !payload.email) return { kind: 'invalid_token' };
  if (!payload.email_verified) return { kind: 'email_not_verified' };

  return {
    sub: payload.sub,
    email: payload.email.toLowerCase(),
    name: payload.name ?? payload.email,
    photoUrl: payload.picture ?? null,
    emailVerified: true,
  };
}
