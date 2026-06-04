import { describe, expect, test } from 'vitest';
import { classifyFileType, isAllowedMime } from '../../netlify/functions/_shared/files-mime';

describe('classifyFileType', () => {
  test('application/pdf → document', () => {
    expect(classifyFileType('application/pdf')).toBe('document');
  });
  test('image/png → image', () => {
    expect(classifyFileType('image/png')).toBe('image');
  });
  test('image/jpeg → image', () => {
    expect(classifyFileType('image/jpeg')).toBe('image');
  });
  test('image/svg+xml → image (we default SVG to image)', () => {
    expect(classifyFileType('image/svg+xml')).toBe('image');
  });
  test('video/mp4 → video', () => {
    expect(classifyFileType('video/mp4')).toBe('video');
  });
  test('audio/mpeg → audio', () => {
    expect(classifyFileType('audio/mpeg')).toBe('audio');
  });
  test('application/vnd.ms-excel → document', () => {
    expect(classifyFileType('application/vnd.ms-excel')).toBe('document');
  });
  test('application/dwg (CAD) → external', () => {
    expect(classifyFileType('application/dwg')).toBe('external');
  });
  test('application/zip → external', () => {
    expect(classifyFileType('application/zip')).toBe('external');
  });
  test('unknown MIME → external', () => {
    expect(classifyFileType('application/x-unknown-thing')).toBe('external');
  });
  test('empty / null → external', () => {
    expect(classifyFileType('')).toBe('external');
    expect(classifyFileType(undefined)).toBe('external');
  });
});

describe('isAllowedMime', () => {
  test('allows common safe types', () => {
    expect(isAllowedMime('application/pdf')).toBe(true);
    expect(isAllowedMime('image/png')).toBe(true);
  });
  test('blocks script types', () => {
    expect(isAllowedMime('application/x-msdownload')).toBe(false);
    expect(isAllowedMime('application/x-executable')).toBe(false);
    expect(isAllowedMime('application/javascript')).toBe(false);
  });
});
