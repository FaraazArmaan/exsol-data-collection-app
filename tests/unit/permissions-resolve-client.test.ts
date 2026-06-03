import { describe, expect, test } from 'vitest';
import {
  resolveClientId, authorizeClientScope,
  type AnySession,
} from '../../netlify/functions/_shared/permissions';

const admin: AnySession = { kind: 'admin', admin: { id: 'a-1', email: 'a@x' } };
const bu = (clientId: string): AnySession => ({
  kind: 'bucket_user', user_node_id: 'u-1', client_id: clientId, level_number: 1,
});

function req(url: string): Request {
  return new Request(`http://localhost/x${url}`);
}

describe('resolveClientId', () => {
  test('admin with ?client=X returns X', () => {
    const r = resolveClientId(admin, req('?client=c-1'));
    expect(r).toEqual({ clientId: 'c-1' });
  });

  test('admin without ?client= returns missing_client error', () => {
    const r = resolveClientId(admin, req(''));
    expect(r).toEqual({ error: 'missing_client' });
  });

  test('bucket-user without ?client= returns own client_id', () => {
    const r = resolveClientId(bu('c-own'), req(''));
    expect(r).toEqual({ clientId: 'c-own' });
  });

  test('bucket-user with matching ?client= returns own client_id', () => {
    const r = resolveClientId(bu('c-own'), req('?client=c-own'));
    expect(r).toEqual({ clientId: 'c-own' });
  });

  test('bucket-user with mismatched ?client= returns forbidden_cross_client', () => {
    const r = resolveClientId(bu('c-own'), req('?client=c-other'));
    expect(r).toEqual({ error: 'forbidden_cross_client' });
  });
});

describe('authorizeClientScope', () => {
  test('admin always authorized regardless of row client_id', () => {
    expect(authorizeClientScope(admin, 'c-any')).toEqual({ ok: true });
  });

  test('bucket-user authorized when row client matches session client', () => {
    expect(authorizeClientScope(bu('c-own'), 'c-own')).toEqual({ ok: true });
  });

  test('bucket-user forbidden when row client differs from session client', () => {
    expect(authorizeClientScope(bu('c-own'), 'c-other')).toEqual({ error: 'forbidden_cross_client' });
  });
});
