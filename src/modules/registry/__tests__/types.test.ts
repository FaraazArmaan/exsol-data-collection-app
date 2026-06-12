import { describe, it, expect, expectTypeOf } from 'vitest';
import type { PermissionKey } from '../types';
import { POS_ACTIONS, type PosAction } from '../types';

describe('PermissionKey union', () => {
  it('admits the 8 POS actions', () => {
    expectTypeOf<`pos.${PosAction}`>().toExtend<PermissionKey>();
    expect(POS_ACTIONS).toHaveLength(8);
    expect(POS_ACTIONS).toContain('menu.view');
    expect(POS_ACTIONS).toContain('history.viewAll');
  });
  it('rejects unknown POS actions at the type layer', () => {
    // @ts-expect-error — 'sale.zorp' is not a PosAction
    const _bad: PermissionKey = 'pos.sale.zorp';
  });
});
