import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

export class PaymentsEncryptionUnavailable extends Error {}

function encryptionKey(): Buffer {
  const value = process.env.PAYMENTS_ENCRYPTION_KEY;
  const key = value ? Buffer.from(value, 'base64') : null;
  if (!key || key.length !== 32) {
    throw new PaymentsEncryptionUnavailable('PAYMENTS_ENCRYPTION_KEY must be a base64-encoded 32-byte key');
  }
  return key;
}

/** Encrypts a secret as base64(iv):base64(tag):base64(ciphertext). */
export function encryptPaymentSecret(plaintext: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', encryptionKey(), iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  return [iv.toString('base64'), cipher.getAuthTag().toString('base64'), ciphertext.toString('base64')].join(':');
}

export function decryptPaymentSecret(blob: string): string {
  const [iv, tag, ciphertext, extra] = blob.split(':');
  if (!iv || !tag || !ciphertext || extra) throw new PaymentsEncryptionUnavailable('malformed payment secret');
  try {
    const decipher = createDecipheriv('aes-256-gcm', encryptionKey(), Buffer.from(iv, 'base64'));
    decipher.setAuthTag(Buffer.from(tag, 'base64'));
    return Buffer.concat([decipher.update(Buffer.from(ciphertext, 'base64')), decipher.final()]).toString('utf8');
  } catch (error) {
    if (error instanceof PaymentsEncryptionUnavailable) throw error;
    throw new PaymentsEncryptionUnavailable('payment secret decryption failed');
  }
}
