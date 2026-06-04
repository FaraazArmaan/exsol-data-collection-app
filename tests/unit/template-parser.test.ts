import { describe, test, expect } from 'vitest';
import * as XLSX from 'xlsx';
import { parseTemplateXlsx } from '../../src/modules/shared/onboarding-import/template-parser';

function buildXlsx(sheets: Record<string, (string | number | null)[][]>): ArrayBuffer {
  const wb = XLSX.utils.book_new();
  for (const [name, aoa] of Object.entries(sheets)) {
    const ws = XLSX.utils.aoa_to_sheet(aoa);
    XLSX.utils.book_append_sheet(wb, ws, name);
  }
  return XLSX.write(wb, { type: 'array', bookType: 'xlsx' });
}

describe('parseTemplateXlsx', () => {
  test('happy path: 3 sheets fully populated', () => {
    const buf = buildXlsx({
      Workspace: [
        ['Workspace name', 'Enabled products'],
        ["Papa's Saloon", 'saloon-booking'],
      ],
      Roles: [
        ['Role', 'Max per parent'],
        ['Owner', 1],
        ['Manager', 3],
        ['Stylist', null],
      ],
      Team: [
        ['Display name', 'Role', 'Parent email', 'Email', 'Phone', 'Notes', 'Temp password'],
        ['Faraaz', 'Owner', null, 'f@papa.com', null, null, null],
        ['Aisha', 'Manager', 'f@papa.com', 'a@papa.com', null, null, null],
        ['Sam', 'Stylist', 'a@papa.com', 's@papa.com', null, null, null],
      ],
    });
    const result = parseTemplateXlsx(buf);
    expect(result.errors).toEqual([]);
    expect(result.template).not.toBeNull();
    expect(result.template!.workspace).toEqual({ name: "Papa's Saloon", enabled_products: ['saloon-booking'] });
    expect(result.template!.roles).toEqual([
      { label: 'Owner', max_per_parent: 1 },
      { label: 'Manager', max_per_parent: 3 },
      { label: 'Stylist', max_per_parent: null },
    ]);
    expect(result.template!.team).toHaveLength(3);
    expect(result.template!.team[0]!.display_name).toBe('Faraaz');
    expect(result.template!.team[0]!.role_label).toBe('Owner');
    expect(result.template!.team[1]!.parent_email).toBe('f@papa.com');
  });

  test('missing required sheet (no Roles) → fatal error', () => {
    const buf = buildXlsx({
      Workspace: [['Workspace name', 'Enabled products'], ['X', '']],
      Team: [['Display name', 'Role', 'Email'], ['x', 'y', 'x@x.com']],
    });
    const result = parseTemplateXlsx(buf);
    expect(result.template).toBeNull();
    expect(result.errors.some((e) => e.section === 'file' && /Roles/.test(e.message))).toBe(true);
  });

  test('missing required column header → fatal error citing sheet + column', () => {
    const buf = buildXlsx({
      Workspace: [['Workspace name'], ["Papa's Saloon"]],   // missing "Enabled products"
      Roles: [['Role', 'Max per parent'], ['Owner', 1]],
      Team: [['Display name', 'Role', 'Email'], ['x', 'Owner', 'x@x.com']],
    });
    const result = parseTemplateXlsx(buf);
    expect(result.template).toBeNull();
    expect(result.errors.some((e) =>
      e.section === 'workspace' && /Enabled products/.test(e.message),
    )).toBe(true);
  });

  test('unknown column header → soft warning, parse continues', () => {
    const buf = buildXlsx({
      Workspace: [
        ['Workspace name', 'Enabled products', 'Mascot'],
        ['X', '', 'a poodle'],
      ],
      Roles: [['Role', 'Max per parent'], ['Owner', 1]],
      Team: [['Display name', 'Role', 'Email'], ['x', 'Owner', 'x@x.com']],
    });
    const result = parseTemplateXlsx(buf);
    expect(result.template).not.toBeNull();
    expect(result.errors.some((e) => /Mascot/i.test(e.message) && /unknown/i.test(e.message))).toBe(true);
    expect(result.template!.workspace.name).toBe('X');
  });

  test('empty rows in middle of Team sheet are skipped', () => {
    const buf = buildXlsx({
      Workspace: [['Workspace name', 'Enabled products'], ['X', '']],
      Roles: [['Role', 'Max per parent'], ['Owner', 1]],
      Team: [
        ['Display name', 'Role', 'Parent email', 'Email', 'Phone', 'Notes', 'Temp password'],
        ['Alice', 'Owner', null, 'a@a.com', null, null, null],
        [null, null, null, null, null, null, null],     // blank row
        ['Bob', 'Owner', null, 'b@b.com', null, null, null],
      ],
    });
    const result = parseTemplateXlsx(buf);
    expect(result.template!.team).toHaveLength(2);
    expect(result.template!.team[0]!.display_name).toBe('Alice');
    expect(result.template!.team[1]!.display_name).toBe('Bob');
  });
});
