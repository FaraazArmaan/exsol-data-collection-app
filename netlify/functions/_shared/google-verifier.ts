import { OAuth2Client } from 'google-auth-library';
import { env } from './env';

let client: OAuth2Client | null = null;
function getClient() {
  if (!client) client = new OAuth2Client(env().GOOGLE_OAUTH_CLIENT_ID);
  return client;
}

export interface GoogleProfile {
  sub: string;
  email: string;
  emailVerified: boolean;
  name: string;
}

export async function verifyGoogleIdToken(idToken: string): Promise<GoogleProfile> {
  const ticket = await getClient().verifyIdToken({
    idToken,
    audience: env().GOOGLE_OAUTH_CLIENT_ID,
  });
  const payload = ticket.getPayload();
  if (!payload?.sub || !payload.email) throw new Error('google_payload_missing_fields');
  return {
    sub: payload.sub,
    email: payload.email,
    emailVerified: payload.email_verified === true,
    name: payload.name ?? payload.email,
  };
}
