import { describe, expect, test } from 'vitest';
import JSZip from 'jszip';
import { randomBytes } from 'node:crypto';
import { wrapInZip, MAX_ZIP_BYTES } from '../../netlify/functions/_shared/exporters/zip';
import { ExportTooLargeError } from '../../netlify/functions/_shared/exporters/types';

describe('zip wrapper', () => {
  test('produces a ZIP with the inner file at root + README.txt', async () => {
    const buf = await wrapInZip({
      filename: 'products.csv',
      contentType: 'text/csv',
      body: 'id,name\n1,Egg',
      platformLabel: 'Generic CSV',
    }, []);
    const z = await JSZip.loadAsync(buf);
    expect(z.file('products.csv')).not.toBeNull();
    expect(z.file('README.txt')).not.toBeNull();
    const csv = await z.file('products.csv')!.async('string');
    expect(csv).toContain('Egg');
  });

  test('includes image files when provided', async () => {
    const buf = await wrapInZip(
      { filename: 'products.csv', contentType: 'text/csv', body: 'x', platformLabel: 'Generic CSV' },
      [{ path: 'images/sku-1_main.jpg', bytes: new Uint8Array([0xff, 0xd8]).buffer }],
    );
    const z = await JSZip.loadAsync(buf);
    expect(z.file('images/sku-1_main.jpg')).not.toBeNull();
  });

  test('throws ExportTooLargeError past MAX_ZIP_BYTES', async () => {
    // Incompressible random bytes — DEFLATE can't shrink them, so 5 MB stays > 4 MB.
    const huge = randomBytes(5 * 1024 * 1024);
    await expect(wrapInZip(
      { filename: 'x.bin', contentType: 'application/octet-stream', body: huge, platformLabel: 'X' }, []
    )).rejects.toThrow(ExportTooLargeError);
  });
});
