import { describe, expect, test } from 'vitest';
import { PLATFORM_SURFACES } from '../../src/modules/registry/types';
import { OP_LABELS } from '../../src/modules/ams/components/audit/op-labels';

describe('workspace export — registry registration', () => {
  test('PLATFORM_SURFACES includes "workspace"', () => {
    expect((PLATFORM_SURFACES as readonly string[]).includes('workspace')).toBe(true);
  });

  test('OP_LABELS has a label for workspace.exported', () => {
    expect(OP_LABELS['workspace.exported']).toBe('Exported workspace data');
  });
});
