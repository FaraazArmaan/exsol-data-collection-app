import { describe, expect, test } from 'vitest';
import {
  blobKeyFor,
  thumbnailKeyFor,
  isAllowedBlobKeyShape,
} from '../../netlify/functions/_shared/files-storage';

describe('blobKeyFor', () => {
  test('admin vault key uses "admin/" prefix', () => {
    const k = blobKeyFor({ scope: 'admin', uuid: '11111111-1111-1111-1111-111111111111' });
    expect(k.startsWith('admin/')).toBe(true);
    expect(k).toContain('11111111-1111-1111-1111-111111111111');
  });

  test('workspace key uses "workspace/<clientId>/" prefix', () => {
    const k = blobKeyFor({
      scope: 'workspace',
      clientId: '22222222-2222-2222-2222-222222222222',
      uuid: '33333333-3333-3333-3333-333333333333',
    });
    expect(k).toBe(
      'workspace/22222222-2222-2222-2222-222222222222/33333333-3333-3333-3333-333333333333',
    );
  });
});

describe('thumbnailKeyFor', () => {
  test('derives a thumbnail key from a blob key', () => {
    const blob = 'workspace/22222222-2222-2222-2222-222222222222/33333333-3333-3333-3333-333333333333';
    const thumb = thumbnailKeyFor(blob);
    expect(thumb).toBe(`thumb/${blob}.webp`);
  });
});

describe('isAllowedBlobKeyShape', () => {
  test('accepts well-formed admin keys', () => {
    expect(isAllowedBlobKeyShape('admin/11111111-1111-1111-1111-111111111111')).toBe(true);
  });
  test('accepts well-formed workspace keys', () => {
    expect(isAllowedBlobKeyShape(
      'workspace/22222222-2222-2222-2222-222222222222/33333333-3333-3333-3333-333333333333',
    )).toBe(true);
  });
  test('rejects path traversal', () => {
    expect(isAllowedBlobKeyShape('admin/../etc/passwd')).toBe(false);
    expect(isAllowedBlobKeyShape('workspace/x/../y')).toBe(false);
  });
  test('rejects empty / odd shapes', () => {
    expect(isAllowedBlobKeyShape('')).toBe(false);
    expect(isAllowedBlobKeyShape('garbage')).toBe(false);
    expect(isAllowedBlobKeyShape('admin/')).toBe(false);
  });
});
