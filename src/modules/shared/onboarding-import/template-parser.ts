// src/modules/shared/onboarding-import/template-parser.ts
//
// Pure XLSX → ParsedTemplate converter. No validation beyond structural
// (missing sheet / missing required column / corrupted file). Cell-level
// validation lives in the preview component and the server endpoint.

import * as XLSX from 'xlsx';
import type {
  ParsedTemplate, TemplateParseError, TemplateParseResult, ParseSection,
} from './types';

const REQUIRED_SHEETS: ParseSection[] = ['workspace', 'roles', 'team'];

const SHEET_NAMES: Record<Exclude<ParseSection, 'file'>, string> = {
  workspace: 'Workspace',
  roles: 'Roles',
  team: 'Team',
};

const REQUIRED_COLUMNS: Record<Exclude<ParseSection, 'file'>, string[]> = {
  workspace: ['Workspace name', 'Enabled products'],
  roles: ['Role'],
  team: ['Display name', 'Role', 'Email'],
};

const KNOWN_COLUMNS: Record<Exclude<ParseSection, 'file'>, string[]> = {
  workspace: ['Workspace name', 'Enabled products'],
  roles: ['Role', 'Max per parent'],
  team: ['Display name', 'Role', 'Parent email', 'Email', 'Phone', 'Notes', 'Temp password'],
};

export function parseTemplateXlsx(buffer: ArrayBuffer): TemplateParseResult {
  const errors: TemplateParseError[] = [];

  let wb: XLSX.WorkBook;
  try {
    wb = XLSX.read(buffer, { type: 'array' });
  } catch (e) {
    return {
      template: null,
      errors: [{ section: 'file', message: `Could not read file: ${(e as Error).message}` }],
    };
  }

  for (const sec of REQUIRED_SHEETS) {
    if (sec === 'file') continue;
    const name = SHEET_NAMES[sec];
    if (!wb.SheetNames.includes(name)) {
      errors.push({ section: 'file', message: `Missing required sheet "${name}"` });
    }
  }
  if (errors.length > 0) return { template: null, errors };

  const workspace = parseWorkspace(wb.Sheets[SHEET_NAMES.workspace]!, errors);
  const roles = parseRoles(wb.Sheets[SHEET_NAMES.roles]!, errors);
  const team = parseTeam(wb.Sheets[SHEET_NAMES.team]!, errors);

  const hasFatal = errors.some((e) => /missing required column/i.test(e.message));
  if (hasFatal || !workspace || !roles || !team) {
    return { template: null, errors };
  }
  return { template: { workspace, roles, team }, errors };
}

function sheetToAoa(ws: XLSX.WorkSheet): (string | number | null)[][] {
  // header: 1 gives an AoA with cells as raw strings/numbers/nulls.
  return XLSX.utils.sheet_to_json<(string | number | null)[]>(ws, {
    header: 1, defval: null, blankrows: false,
  });
}

function headerIndex(headers: (string | number | null)[], name: string): number {
  return headers.findIndex((h) => typeof h === 'string' && h.trim() === name);
}

function cellString(v: string | number | null | undefined): string | null {
  if (v === null || v === undefined) return null;
  const s = String(v).trim();
  return s === '' ? null : s;
}

function parseWorkspace(
  ws: XLSX.WorkSheet, errors: TemplateParseError[],
): ParsedTemplate['workspace'] | null {
  const rows = sheetToAoa(ws);
  if (rows.length === 0) {
    errors.push({ section: 'workspace', message: 'Workspace sheet is empty' });
    return null;
  }
  const headers = rows[0]!;
  for (const col of REQUIRED_COLUMNS.workspace) {
    if (headerIndex(headers, col) < 0) {
      errors.push({ section: 'workspace', message: `Missing required column "${col}"` });
    }
  }
  for (const h of headers) {
    if (typeof h !== 'string' || h.trim() === '') continue;
    if (!KNOWN_COLUMNS.workspace.includes(h.trim())) {
      errors.push({ section: 'workspace', row: 1, message: `unknown column "${h}" — ignored` });
    }
  }
  if (errors.some((e) => e.section === 'workspace' && /missing required/i.test(e.message))) {
    return null;
  }
  const nameIdx = headerIndex(headers, 'Workspace name');
  const prodIdx = headerIndex(headers, 'Enabled products');
  const dataRow = rows[1] ?? [];
  const name = cellString(dataRow[nameIdx]) ?? '';
  const prodCell = cellString(dataRow[prodIdx]) ?? '';
  const enabled_products = prodCell === ''
    ? []
    : prodCell.split(',').map((s) => s.trim()).filter((s) => s.length > 0);
  return { name, enabled_products };
}

function parseRoles(
  ws: XLSX.WorkSheet, errors: TemplateParseError[],
): ParsedTemplate['roles'] | null {
  const rows = sheetToAoa(ws);
  if (rows.length === 0) {
    errors.push({ section: 'roles', message: 'Roles sheet is empty' });
    return null;
  }
  const headers = rows[0]!;
  for (const col of REQUIRED_COLUMNS.roles) {
    if (headerIndex(headers, col) < 0) {
      errors.push({ section: 'roles', message: `Missing required column "${col}"` });
    }
  }
  for (const h of headers) {
    if (typeof h !== 'string' || h.trim() === '') continue;
    if (!KNOWN_COLUMNS.roles.includes(h.trim())) {
      errors.push({ section: 'roles', row: 1, message: `unknown column "${h}" — ignored` });
    }
  }
  if (errors.some((e) => e.section === 'roles' && /missing required/i.test(e.message))) {
    return null;
  }
  const labelIdx = headerIndex(headers, 'Role');
  const capIdx = headerIndex(headers, 'Max per parent');
  const out: ParsedTemplate['roles'] = [];
  for (let i = 1; i < rows.length; i++) {
    const r = rows[i]!;
    const label = cellString(r[labelIdx]);
    if (label === null) continue;     // blank row
    const capCell = capIdx >= 0 ? r[capIdx] : null;
    let cap: number | null = null;
    if (typeof capCell === 'number') cap = Math.trunc(capCell);
    else if (typeof capCell === 'string' && capCell.trim() !== '') {
      const n = Number(capCell.trim());
      cap = Number.isFinite(n) && Number.isInteger(n) ? n : null;
      if (cap === null) {
        errors.push({ section: 'roles', row: i + 1, message: `Max per parent "${capCell}" is not an integer — treated as blank` });
      }
    }
    out.push({ label, max_per_parent: cap });
  }
  return out;
}

function parseTeam(
  ws: XLSX.WorkSheet, errors: TemplateParseError[],
): ParsedTemplate['team'] | null {
  const rows = sheetToAoa(ws);
  if (rows.length === 0) {
    errors.push({ section: 'team', message: 'Team sheet is empty' });
    return null;
  }
  const headers = rows[0]!;
  for (const col of REQUIRED_COLUMNS.team) {
    if (headerIndex(headers, col) < 0) {
      errors.push({ section: 'team', message: `Missing required column "${col}"` });
    }
  }
  for (const h of headers) {
    if (typeof h !== 'string' || h.trim() === '') continue;
    if (!KNOWN_COLUMNS.team.includes(h.trim())) {
      errors.push({ section: 'team', row: 1, message: `unknown column "${h}" — ignored` });
    }
  }
  if (errors.some((e) => e.section === 'team' && /missing required/i.test(e.message))) {
    return null;
  }
  const idx = {
    display_name: headerIndex(headers, 'Display name'),
    role: headerIndex(headers, 'Role'),
    parent_email: headerIndex(headers, 'Parent email'),
    email: headerIndex(headers, 'Email'),
    phone: headerIndex(headers, 'Phone'),
    notes: headerIndex(headers, 'Notes'),
    temp_password: headerIndex(headers, 'Temp password'),
  };
  const out: ParsedTemplate['team'] = [];
  for (let i = 1; i < rows.length; i++) {
    const r = rows[i]!;
    const display_name = cellString(r[idx.display_name]);
    if (display_name === null) continue;     // blank row
    out.push({
      display_name,
      role_label: cellString(r[idx.role]) ?? '',
      parent_email: idx.parent_email >= 0 ? cellString(r[idx.parent_email]) : null,
      email: cellString(r[idx.email]) ?? '',
      phone: idx.phone >= 0 ? cellString(r[idx.phone]) : null,
      notes: idx.notes >= 0 ? cellString(r[idx.notes]) : null,
      temp_password: idx.temp_password >= 0 ? cellString(r[idx.temp_password]) : null,
    });
  }
  return out;
}
