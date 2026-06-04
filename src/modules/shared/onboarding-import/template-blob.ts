// src/modules/shared/onboarding-import/template-blob.ts
//
// Builds the blank XLSX (3 sheets with headers + 2 example rows each) so the
// admin sees the exact column shape on first download. Pure function returning
// an ArrayBuffer; the consumer (chooser component) wraps it in a Blob and
// triggers a browser download.
//
// Column widths (`!cols[i].wch`) are set per sheet so headers don't get
// truncated to "Workspace r" / "Papa's Saloo" on first open — Excel/Numbers
// don't auto-fit columns to content on open; an unwidened sheet shows ~9
// chars per column and clips longer headers + the example data.

import * as XLSX from 'xlsx';

export function buildBlankTemplateXlsx(): ArrayBuffer {
  const wb = XLSX.utils.book_new();

  const workspaceAoa: (string | number | null)[][] = [
    ['Workspace name', 'Enabled products'],
    ["Papa's Saloon", 'saloon-booking'],
  ];
  const workspaceWs = XLSX.utils.aoa_to_sheet(workspaceAoa);
  workspaceWs['!cols'] = [{ wch: 24 }, { wch: 28 }];
  XLSX.utils.book_append_sheet(wb, workspaceWs, 'Workspace');

  const rolesAoa: (string | number | null)[][] = [
    ['Role', 'Max per parent'],
    ['Owner', 1],
    ['Manager', 3],
    ['Stylist', null],
  ];
  const rolesWs = XLSX.utils.aoa_to_sheet(rolesAoa);
  rolesWs['!cols'] = [{ wch: 20 }, { wch: 18 }];
  XLSX.utils.book_append_sheet(wb, rolesWs, 'Roles');

  const teamAoa: (string | number | null)[][] = [
    ['Display name', 'Role', 'Parent email', 'Email', 'Phone', 'Notes', 'Temp password'],
    ['Faraaz', 'Owner', null, 'faraaz@example.com', null, null, null],
    ['Aisha', 'Manager', 'faraaz@example.com', 'aisha@example.com', null, null, null],
  ];
  const teamWs = XLSX.utils.aoa_to_sheet(teamAoa);
  teamWs['!cols'] = [
    { wch: 20 },  // Display name
    { wch: 14 },  // Role
    { wch: 28 },  // Parent email
    { wch: 28 },  // Email
    { wch: 14 },  // Phone
    { wch: 24 },  // Notes
    { wch: 18 },  // Temp password
  ];
  XLSX.utils.book_append_sheet(wb, teamWs, 'Team');

  return XLSX.write(wb, { type: 'array', bookType: 'xlsx' });
}
