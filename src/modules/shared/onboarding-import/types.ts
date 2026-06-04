// src/modules/shared/onboarding-import/types.ts
//
// Shared shapes for the onboarding-import flow. Consumed by:
//   - template-parser.ts (produces ParsedTemplate)
//   - OnboardClientImportPreview.tsx (edits ParsedTemplate; submits OnboardClientBulkBody)
//   - ams/api.ts (typed wrapper for POST /api/onboard-client-bulk)
//   - the server endpoint's Zod schema is independent, but its shape must match
//     OnboardClientBulkBody — when adding/removing fields, update both.

export interface ParsedRole {
  label: string;
  max_per_parent: number | null;
}

export interface ParsedTeamMember {
  display_name: string;
  role_label: string;
  parent_email: string | null;
  email: string;
  phone: string | null;
  notes: string | null;
  temp_password: string | null;
}

export interface ParsedTemplate {
  workspace: { name: string; enabled_products: string[] };
  roles: ParsedRole[];
  team: ParsedTeamMember[];
}

export type ParseSection = 'file' | 'workspace' | 'roles' | 'team';

export interface TemplateParseError {
  section: ParseSection;
  row?: number;     // 1-indexed XLSX row (header is row 1)
  message: string;
}

export interface TemplateParseResult {
  template: ParsedTemplate | null;   // null if a fatal error makes the file unusable
  errors: TemplateParseError[];
}

// Body shape for POST /api/onboard-client-bulk. Identical to ParsedTemplate
// for now (the preview doesn't transform shape — just edits then submits).
// Keeping them as distinct types so a future preview-time mapping doesn't
// require a coordinated rename.
export type OnboardClientBulkBody = ParsedTemplate;

// Per-row server-side validation error.
export interface BulkRowError {
  section: 'workspace' | 'roles' | 'team';
  row_index: number;    // 0-indexed within the corresponding array
  errors: string[];
}

// Server response on 201.
export interface OnboardClientBulkSuccess {
  client: { id: string; name: string; slug: string };
  owner_node_id: string;
  team_member_count: number;
  credentials: Array<{ display_name: string; email: string; temp_password: string }>;
}
