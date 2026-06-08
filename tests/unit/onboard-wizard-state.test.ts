import { describe, expect, test } from 'vitest';
import {
  initialState, reducer, validators, resolveOwnerRoleKey, applyAutoSeed,
  type WizardState,
} from '../../src/modules/ams/components/onboarding/state';

describe('initialState', () => {
  test('starts at name step with empty fields', () => {
    expect(initialState.step).toBe('name');
    expect(initialState.name).toBe('');
    expect(initialState.roles).toEqual([]);
    expect(initialState.levels).toEqual([]);
    expect(initialState.cardinality_rules).toEqual([]);
    expect(initialState.enabled_products).toEqual([]);
    expect(initialState.owner.display_name).toBe('');
  });
});

describe('reducer', () => {
  test('setName updates the name', () => {
    const next = reducer(initialState, { type: 'setName', value: 'Acme Inc' });
    expect(next.name).toBe('Acme Inc');
  });

  test('goToStep navigates', () => {
    const s2 = reducer(initialState, { type: 'goToStep', step: 'products' });
    expect(s2.step).toBe('products');
  });

  test('addRole appends to roles', () => {
    const s2 = reducer(initialState, { type: 'addRole', role: { key: 'staff', label: 'Staff', color: '#22c55e' } });
    expect(s2.roles.length).toBe(1);
    expect(s2.roles[0]!.key).toBe('staff');
  });

  test('removeRole removes by index', () => {
    const s1 = reducer(initialState, { type: 'addRole', role: { key: 'a', label: 'A', color: '#000000' } });
    const s2 = reducer(s1, { type: 'addRole', role: { key: 'b', label: 'B', color: '#111111' } });
    const s3 = reducer(s2, { type: 'removeRole', index: 0 });
    expect(s3.roles.length).toBe(1);
    expect(s3.roles[0]!.key).toBe('b');
  });
});

describe('validators', () => {
  test('name: non-empty required', () => {
    expect(validators.name({ ...initialState, name: '' })).toEqual({ ok: false, reason: 'Name is required' });
    expect(validators.name({ ...initialState, name: 'Acme' })).toEqual({ ok: true });
  });

  test('products: always ok (skippable)', () => {
    expect(validators.products(initialState)).toEqual({ ok: true });
  });

  test('roles: always ok (auto-seed handles empty)', () => {
    expect(validators.roles(initialState)).toEqual({ ok: true });
  });

  test('levels: always ok (auto-seed handles empty)', () => {
    expect(validators.levels(initialState)).toEqual({ ok: true });
  });

  test('cardinality: always ok (skippable)', () => {
    expect(validators.cardinality(initialState)).toEqual({ ok: true });
  });

  test('owner: display_name + email + temp_password >= 8 chars all required', () => {
    const blank = validators.owner(initialState);
    expect(blank.ok).toBe(false);
    const partial = validators.owner({ ...initialState, owner: { display_name: 'X', email: '', temp_password: 'shortpw' } });
    expect(partial.ok).toBe(false);
    const good = validators.owner({ ...initialState, owner: { display_name: 'X', email: 'x@y.com', temp_password: 'long-enough' } });
    expect(good).toEqual({ ok: true });
  });
});

describe('applyAutoSeed', () => {
  test('empty roles → auto-seed owner role', () => {
    const seeded = applyAutoSeed({ ...initialState });
    expect(seeded.roles.length).toBe(1);
    expect(seeded.roles[0]).toMatchObject({ key: 'owner', label: 'Owner', color: '#3b82f6' });
  });

  test('empty levels → auto-seed Primary L1 referencing first role', () => {
    const withRole = reducer(initialState, { type: 'addRole', role: { key: 'manager', label: 'Manager', color: '#000' } });
    const seeded = applyAutoSeed(withRole);
    expect(seeded.levels.length).toBe(1);
    expect(seeded.levels[0]).toMatchObject({ level_number: 1, label: 'Primary' });
  });

  test('non-empty roles + levels are preserved unchanged', () => {
    const s1 = reducer(initialState, { type: 'addRole', role: { key: 'owner', label: 'O', color: '#000' } });
    const s2 = reducer(s1, { type: 'addLevel', level: { level_number: 1 } });
    const seeded = applyAutoSeed(s2);
    expect(seeded.roles).toEqual(s2.roles);
    expect(seeded.levels).toEqual(s2.levels);
  });
});

describe('resolveOwnerRoleKey', () => {
  test('picks the first role in the roles array when L1 exists', () => {
    const state: WizardState = {
      ...initialState,
      roles: [
        { key: 'staff', label: 'Staff', color: '#000' },
        { key: 'owner', label: 'Owner', color: '#111' },
      ],
      levels: [{ level_number: 1 }],
    };
    expect(resolveOwnerRoleKey(state)).toBe('staff');
  });

  test('returns null if roles is empty', () => {
    const state: WizardState = { ...initialState, roles: [], levels: [{ level_number: 1 }] };
    expect(resolveOwnerRoleKey(state)).toBeNull();
  });

  test('returns null if L1 doesn\'t exist', () => {
    expect(resolveOwnerRoleKey(initialState)).toBeNull();
  });
});
