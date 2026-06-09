import JSZip from 'jszip';
import { ExportResult, ExportTooLargeError } from './types';

export const MAX_ZIP_BYTES = 4 * 1024 * 1024;

export interface ZipImage {
  path: string;
  bytes: ArrayBuffer | Uint8Array;
}

export async function wrapInZip(
  result: ExportResult,
  images: ZipImage[],
): Promise<Buffer> {
  const z = new JSZip();
  z.file(result.filename, result.body);
  const readme = [
    `Export: ${result.platformLabel}`,
    `Generated: ${new Date().toISOString()}`,
    ``,
    `Image links in the data file reference filenames in this ZIP's images/`,
    `folder. After uploading the images to your hosting (CDN, Shopify, etc.),`,
    `find-and-replace those filenames with the hosted URLs.`,
  ].join('\n');
  z.file('README.txt', readme);
  for (const img of images) {
    z.file(img.path, img.bytes);
  }
  const buf = await z.generateAsync({
    type: 'nodebuffer',
    compression: 'DEFLATE',
    compressionOptions: { level: 6 },
  });
  if (buf.byteLength > MAX_ZIP_BYTES) {
    throw new ExportTooLargeError(buf.byteLength, MAX_ZIP_BYTES);
  }
  return buf;
}
