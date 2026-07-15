import { afterEach, describe, expect, it } from 'vitest';
import { decryptPaymentSecret, encryptPaymentSecret, PaymentsEncryptionUnavailable } from '../../netlify/functions/_payments-secrets';

const originalKey = process.env.PAYMENTS_ENCRYPTION_KEY;
const key = Buffer.alloc(32, 7).toString('base64');

afterEach(() => {
  if (originalKey === undefined) delete process.env.PAYMENTS_ENCRYPTION_KEY;
  else process.env.PAYMENTS_ENCRYPTION_KEY = originalKey;
});

describe('Payments secret encryption', () => {
  it('round-trips AES-256-GCM ciphertext', () => {
    process.env.PAYMENTS_ENCRYPTION_KEY = key;
    const encrypted = encryptPaymentSecret('test-secret-value');
    expect(encrypted).not.toContain('test-secret-value');
    expect(decryptPaymentSecret(encrypted)).toBe('test-secret-value');
  });

  it('fails closed for missing, invalid, or tampered encryption material', () => {
    delete process.env.PAYMENTS_ENCRYPTION_KEY;
    expect(() => encryptPaymentSecret('test-secret-value')).toThrow(PaymentsEncryptionUnavailable);
    process.env.PAYMENTS_ENCRYPTION_KEY = 'invalid';
    expect(() => encryptPaymentSecret('test-secret-value')).toThrow(PaymentsEncryptionUnavailable);
    process.env.PAYMENTS_ENCRYPTION_KEY = key;
    const [iv = '', tag = '', ciphertext = ''] = encryptPaymentSecret('test-secret-value').split(':');
    expect(() => decryptPaymentSecret(`${iv}:${tag.slice(0, -2)}AA:${ciphertext}`)).toThrow(PaymentsEncryptionUnavailable);
  });
});
