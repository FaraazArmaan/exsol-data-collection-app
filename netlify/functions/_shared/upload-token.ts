// Stateless upload token for the 2-step file-upload flow.
//
// Why JWT instead of an in-memory Map: each Netlify Function runs in its own
// process. POST /api/files-upload-url and PUT /api/files-upload never share
// memory, so a Map keyed in one function is invisible to the other → every
// upload would 404. A signed token carries blob_key + expiry inside itself,
// no shared state needed. Same JWT_SIGNING_SECRET as sessions.

import { SignJWT, jwtVerify } from 'jose';
import { env } from './env';

const ALG = 'HS256';
const TTL_SECONDS = 5 * 60;

function secret() {
  return new TextEncoder().encode(env().JWT_SIGNING_SECRET);
}

export async function signUploadToken(blobKey: string): Promise<string> {
  return new SignJWT({ blob_key: blobKey })
    .setProtectedHeader({ alg: ALG })
    .setIssuedAt()
    .setExpirationTime(`${TTL_SECONDS}s`)
    .sign(secret());
}

export async function verifyUploadToken(token: string): Promise<{ blobKey: string } | null> {
  try {
    const { payload } = await jwtVerify(token, secret(), { algorithms: [ALG] });
    if (typeof payload.blob_key !== 'string') return null;
    return { blobKey: payload.blob_key };
  } catch {
    return null;
  }
}
