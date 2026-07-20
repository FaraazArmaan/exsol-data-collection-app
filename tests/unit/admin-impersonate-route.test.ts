import { describe, expect, it } from 'vitest';
import * as impersonate from '../../netlify/functions/admin-impersonate';

describe('admin-impersonate route contract', () => {
  it('uses file-name routing so the local API proxy reaches the handler', () => {
    expect('config' in impersonate).toBe(false);
  });
});
