// Human-readable labels and summaries for audit log entries.
// Imported by AuditTable (column rendering) and AuditDetailDrawer (action header).

export const OP_LABELS: Record<string, string> = {
  'client.created': 'Created workspace',
  'client.updated': 'Edited workspace',
  'client.deleted': 'Deleted workspace',
  'client.onboarded': 'Onboarded new workspace',
  'client.onboarded_bulk': 'Onboarded workspace (bulk import)',
  'role.created': 'Added role',
  'role.updated': 'Edited role',
  'role.deleted': 'Removed role',
  'level.created': 'Added level',
  'level.updated': 'Edited level',
  'level.deleted': 'Removed level',
  'cardinality.replaced': 'Updated cardinality rules',
  'products.replaced': 'Toggled enabled products',
  'permissions.updated': 'Updated level permissions',
  'user_node.created': 'Added team member',
  'user_node.updated': 'Edited team member',
  'user_node.deleted': 'Removed team member',
  'user_node.moved': 'Moved team member',
  'users.bulk_invited': 'Bulk-invited team members',
  'users.bulk_role_changed': 'Bulk-changed roles',
  'credential.peeked': 'Viewed temp password',
  'credential.reset': 'Reset password',
  'credential.deleted': 'Removed login',
  'admin.created': 'Added admin',
  'admin.updated': 'Edited admin',
  'admin.deleted': 'Removed admin',
};

export function actionLabel(op: string): string {
  return OP_LABELS[op] ?? op;
}

export function summarize(op: string, detail: Record<string, unknown> | null): string {
  if (!detail) return '';

  // Op-specific summaries take precedence over generic suffix-based ones.
  if (op === 'client.onboarded') {
    const v = detail as { roles_count?: number; levels_count?: number; enabled_products_count?: number; cardinality_rules_count?: number };
    const parts: string[] = [];
    if (typeof v.roles_count === 'number') parts.push(`${v.roles_count} role${v.roles_count === 1 ? '' : 's'}`);
    if (typeof v.levels_count === 'number') parts.push(`${v.levels_count} level${v.levels_count === 1 ? '' : 's'}`);
    if (typeof v.enabled_products_count === 'number' && v.enabled_products_count > 0) parts.push(`${v.enabled_products_count} product${v.enabled_products_count === 1 ? '' : 's'}`);
    return parts.join(', ');
  }
  if (op === 'client.onboarded_bulk') {
    const v = detail as { role_count?: number; team_count?: number; login_count?: number; enabled_products_count?: number };
    const parts: string[] = [];
    if (typeof v.role_count === 'number') parts.push(`${v.role_count} role${v.role_count === 1 ? '' : 's'}`);
    if (typeof v.team_count === 'number') parts.push(`${v.team_count} member${v.team_count === 1 ? '' : 's'}`);
    if (typeof v.login_count === 'number') parts.push(`${v.login_count} login${v.login_count === 1 ? '' : 's'}`);
    if (typeof v.enabled_products_count === 'number' && v.enabled_products_count > 0) parts.push(`${v.enabled_products_count} product${v.enabled_products_count === 1 ? '' : 's'}`);
    return parts.join(', ');
  }
  if (op === 'credential.peeked') {
    const v = detail as { views_left_after?: number };
    return typeof v.views_left_after === 'number' ? `${v.views_left_after} reveal${v.views_left_after === 1 ? '' : 's'} left` : '';
  }
  if (op === 'credential.reset' || op === 'credential.deleted') {
    return '';
  }
  if (op === 'user_node.moved') {
    const v = detail as { new_parent_id?: string | null; new_level_number?: number | null };
    if (v.new_parent_id === null && v.new_level_number === null) return 'moved to unassigned';
    if (typeof v.new_level_number === 'number') return `moved to level ${v.new_level_number}`;
    return '';
  }
  if (op === 'users.bulk_invited') {
    const v = detail as { count?: number; login_count?: number; role_keys?: string[] };
    const parts: string[] = [];
    if (typeof v.count === 'number') parts.push(`${v.count} user${v.count === 1 ? '' : 's'}`);
    if (typeof v.login_count === 'number' && v.login_count > 0) parts.push(`${v.login_count} login${v.login_count === 1 ? '' : 's'}`);
    if (Array.isArray(v.role_keys) && v.role_keys.length > 0) parts.push(`role${v.role_keys.length === 1 ? '' : 's'}: ${v.role_keys.join(', ')}`);
    return parts.join(' · ');
  }
  if (op === 'users.bulk_role_changed') {
    const v = detail as { count?: number; to_role_key?: string; from_role_keys?: string[] };
    const parts: string[] = [];
    if (typeof v.count === 'number') parts.push(`${v.count} user${v.count === 1 ? '' : 's'}`);
    if (v.to_role_key) parts.push(`→ ${v.to_role_key}`);
    if (Array.isArray(v.from_role_keys) && v.from_role_keys.length > 0) parts.push(`from ${v.from_role_keys.join(', ')}`);
    return parts.join(' · ');
  }
  if (op === 'cardinality.replaced') {
    const v = detail as { rules_count?: number };
    return typeof v.rules_count === 'number' ? `${v.rules_count} rule${v.rules_count === 1 ? '' : 's'}` : '';
  }
  if (op === 'products.replaced') {
    const v = detail as { keys?: string[] };
    return Array.isArray(v.keys) ? `${v.keys.length} product${v.keys.length === 1 ? '' : 's'} enabled` : '';
  }
  if (op === 'permissions.updated') {
    const v = detail as { keys_count?: number };
    return typeof v.keys_count === 'number' ? `${v.keys_count} permission key${v.keys_count === 1 ? '' : 's'}` : '';
  }

  // Generic suffix-based summaries.
  if (op.endsWith('.updated')) {
    const fields = Object.keys(detail);
    return fields.length === 0 ? '' : `changed: ${fields.join(', ')}`;
  }
  if (op.endsWith('.created')) {
    const v = detail as Record<string, unknown>;
    const name = v.display_name ?? v.name ?? v.label ?? v.email ?? v.key;
    return typeof name === 'string' ? name : '';
  }
  if (op.endsWith('.deleted')) {
    const v = detail as Record<string, unknown>;
    const name = v.display_name ?? v.name ?? v.label ?? v.email ?? v.key;
    return typeof name === 'string' ? `was: ${name}` : '';
  }
  return '';
}
