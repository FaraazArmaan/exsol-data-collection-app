// src/modules/shared/onboarding-import/template-blob.ts
//
// Builds the blank XLSX (3 sheets with headers + 2 example rows each) so the
// admin sees the exact column shape on first download. Pure function returning
// an ArrayBuffer; the consumer (chooser component) wraps it in a Blob and
// triggers a browser download.

import * as XLSX from 'xlsx';

export function buildBlankTemplateXlsx(): ArrayBuffer {
  const wb = XLSX.utils.book_new();

  const workspaceAoa: (string | number | null)[][] = [
    ['Workspace name', 'Enabled products'],
    ["Papa's Saloon", 'saloon-booking'],
  ];
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(workspaceAoa), 'Workspace');

  const rolesAoa: (string | number | null)[][] = [
    ['Role', 'Max per parent'],
    ['Owner', 1],
    ['Manager', 3],
    ['Stylist', null],
  ];
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(rolesAoa), 'Roles');

  const teamAoa: (string | number | null)[][] = [
    ['Display name', 'Role', 'Parent email', 'Email', 'Phone', 'Notes', 'Temp password'],
    ['Faraaz', 'Owner', null, 'faraaz@example.com', null, null, null],
    ['Aisha', 'Manager', 'faraaz@example.com', 'aisha@example.com', null, null, null],
  ];
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(teamAoa), 'Team');

  return XLSX.write(wb, { type: 'array', bookType: 'xlsx' });
}
