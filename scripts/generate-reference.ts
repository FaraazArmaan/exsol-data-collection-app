// scripts/generate-reference.ts
//
// Generates docs/reference/{endpoints,permissions,schema}.md by DERIVING them
// from the code — the netlify function files, the module registry, and the
// migration SQL. Never hand-edit those three files; rerun this instead:
//
//   npm run docs:reference
//
// Output is deterministic (sorted, no timestamps) so reruns are idempotent and
// diffs show real drift only.

import { readFileSync, readdirSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { allModules } from '../src/modules/registry/modules';
import { allProducts, derivePermissionRows } from '../src/modules/registry/products';
import { POS_ACTIONS, PLATFORM_SURFACES, VERBS } from '../src/modules/registry/types';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const FN_DIR = join(ROOT, 'netlify', 'functions');
const MIG_DIR = join(ROOT, 'db', 'migrations');
const OUT_DIR = join(ROOT, 'docs', 'reference');

const GENERATED_HEADER = (source: string) => `<!--
  GENERATED FILE — do not hand-edit.
  Regenerate with: npm run docs:reference   (scripts/generate-reference.ts)
  Derived from: ${source}
-->

`;

// ---------------------------------------------------------------------------
// endpoints.md
// ---------------------------------------------------------------------------

interface EndpointRow {
  file: string;
  path: string;
  methods: string;
  tier: string;
  permKeys: string[];
  module: string;
}

// Filename-prefix → owning module/area. First match wins; checked in order.
// Modules with a _<key>-authz.ts import are attributed by that import instead.
const PREFIX_OWNER: Array<[RegExp, string]> = [
  [/^booking-public/, 'booking (public)'],
  [/^booking/, 'booking'],
  [/^pub-catalog/, 'catalog (public)'],
  [/^pub-/, 'pos storefront (public)'],
  [/^pos-/, 'pos'],
  [/^u-products|^u-product-/, 'products'],
  [/^u-(login|logout|me|change-password|link-google|unlink-google|client-by-slug)/, 'login (user portal)'],
  [/^auth-|^login$|^forgot-password/, 'login (admin)'],
  [/^admin-|^client-|^clients|^user-node|^onboard-client$|^audit-log|^workspace-export/, 'ams (platform)'],
  [/^onboard-client-bulk/, 'ams (platform)'],
  [/^files/, 'files (platform)'],
  [/^analytics/, 'analytics'],
  [/^crm/, 'crm'],
  [/^email|^mail/, 'email'],
  [/^finance/, 'finance'],
  [/^inventory/, 'inventory'],
  [/^manufacturing/, 'manufacturing'],
  [/^marketing/, 'marketing'],
  [/^portfolio|^brand-site|^pub-brand/, 'portfolio'],
  [/^procurement/, 'procurement'],
  [/^supply-chain/, 'supply-chain'],
  [/^warehouse/, 'warehouse'],
  [/^workforce/, 'workforce'],
  [/^data-collection|^onboard$/, 'data-collection'],
];

function ownerFor(name: string, src: string): string {
  const authzImport = src.match(/from '\.\/_([a-z-]+)-authz'/);
  if (authzImport && authzImport[1] && authzImport[1] !== 'pub') return authzImport[1];
  if (authzImport && authzImport[1] === 'pub') return 'pos storefront (public)';
  for (const [re, owner] of PREFIX_OWNER) if (re.test(name)) return owner;
  return 'platform';
}

function tierFor(_name: string, src: string): string {
  const tiers: string[] = [];
  if (/\brequireAdmin\b/.test(src)) tiers.push('admin');
  const hasModuleAuthz = /from '\.\/_(?!pub-)[a-z-]+-authz'/.test(src);
  if (/\brequireBucketUser\b|\bauthenticateForPermission\b/.test(src) || hasModuleAuthz) {
    tiers.push('bucket-user');
  }
  if (tiers.length === 0) tiers.push('public');
  return tiers.join(' + ');
}

function permKeysFor(src: string): string[] {
  const keys = new Set<string>();
  const patterns = [
    /'(_platform\.[a-z]+\.(?:view|create|edit|delete))'/g,
    /'([a-z][a-z-]*\.(?:business|employees|customers|products)\.(?:view|create|edit|delete))'/g,
    /'(pos\.(?:menu|history)\.[a-zA-Z]+)'/g,
    /'(pos\.sale\.[a-zA-Z]+)'/g,
  ];
  for (const re of patterns) {
    for (const m of src.matchAll(re)) if (m[1]) keys.add(m[1]);
  }
  return [...keys].sort();
}

function parseEndpoints(): EndpointRow[] {
  const rows: EndpointRow[] = [];
  const files = readdirSync(FN_DIR).filter((f) => f.endsWith('.ts') && !f.startsWith('_'));
  for (const f of files.sort()) {
    const name = f.replace(/\.ts$/, '');
    const src = readFileSync(join(FN_DIR, f), 'utf8');
    const cfg = src.match(/export const config\s*=\s*\{([\s\S]*?)\}/);
    let path = `/api/${name} (name-routed)`;
    let methods = 'any';
    if (cfg && cfg[1]) {
      const p = cfg[1].match(/path:\s*'([^']+)'/);
      if (p && p[1]) path = p[1];
      const m1 = cfg[1].match(/method:\s*'([A-Z]+)'/);
      const m2 = cfg[1].match(/method:\s*\[([^\]]*)\]/);
      if (m1 && m1[1]) methods = m1[1];
      else if (m2 && m2[1]) methods = m2[1].replace(/['\s]/g, '').split(',').join(', ');
    }
    rows.push({ file: f, path, methods, tier: tierFor(name, src), permKeys: permKeysFor(src), module: ownerFor(name, src) });
  }
  return rows;
}

function renderEndpoints(rows: EndpointRow[]): string {
  let out = GENERATED_HEADER('netlify/functions/*.ts (config exports, authz imports, permission-key literals)');
  out += '# API endpoints\n\n';
  out += `${rows.length} functions. "name-routed" = no \`config.path\`; reachable as \`/api/<file>\` via the\n`;
  out += 'netlify.toml `/api/* -> /.netlify/functions/:splat` redirect (iron rule 5: the FILE NAME is the route).\n\n';
  out += 'Auth tiers: **admin** (`requireAdmin`, AMS console) · **bucket-user** (workspace user via\n';
  out += '`requireBucketUser`/`authenticateForPermission`/module `_<key>-authz`) · **public** (no session).\n\n';
  const byModule = new Map<string, EndpointRow[]>();
  for (const r of rows) {
    const list = byModule.get(r.module) ?? [];
    list.push(r);
    byModule.set(r.module, list);
  }
  for (const mod of [...byModule.keys()].sort()) {
    const list = byModule.get(mod)!;
    out += `## ${mod}\n\n`;
    out += '| function | path | methods | auth | permission keys checked |\n';
    out += '|---|---|---|---|---|\n';
    for (const r of list) {
      out += `| ${r.file} | \`${r.path}\` | ${r.methods} | ${r.tier} | ${r.permKeys.map((k) => `\`${k}\``).join(', ') || '—'} |\n`;
    }
    out += '\n';
  }
  return out;
}

// ---------------------------------------------------------------------------
// permissions.md
// ---------------------------------------------------------------------------

function renderPermissions(): string {
  let out = GENERATED_HEADER('src/modules/registry/ (manifests, products-list, types)');
  out += '# Permission model\n\n';
  out += 'Keys are `<module>.<bucket>.<verb>` (bucket×verb — iron rule 3), plus fixed\n';
  out += '`_platform.<surface>.<verb>` surfaces and POS\'s FROZEN legacy `pos.<action>` keys.\n';
  out += 'L1 Owners (`level_number === 1` or null) bypass the matrix everywhere (iron rule 2);\n';
  out += 'which non-Owner levels hold which keys is per-client runtime data (`client_levels.permissions`\n';
  out += 'JSONB), edited in the Access Levels dashboard — not derivable from code.\n\n';

  out += '## Modules: buckets × verbs\n\n';
  out += '| module | label | buckets | verbs | sides | dedicated nav |\n';
  out += '|---|---|---|---|---|---|\n';
  for (const m of [...allModules()].sort((a, b) => a.key.localeCompare(b.key))) {
    const sides = [m.vendor_side && 'vendor', m.customer_side && 'customer'].filter(Boolean).join('+') || 'none';
    const nav = m.hasDedicatedNav ? (m.navLinks?.length ? `✓ (${m.navLinks.map((l) => l.path).join(', ')})` : '✓ (no link)') : 'generic rail';
    out += `| ${m.key} | ${m.label} | ${m.data_buckets.join(', ') || '—'} | ${m.verbs.join(', ') || '—'} | ${sides} | ${nav} |\n`;
  }
  out += `\nPlatform surfaces (\`_platform.<surface>.<verb>\`): ${PLATFORM_SURFACES.map((s) => `\`${s}\``).join(', ')} × ${VERBS.map((v) => `\`${v}\``).join(', ')}.\n`;
  out += `\nPOS legacy action keys (frozen): ${POS_ACTIONS.map((a) => `\`pos.${a}\``).join(', ')}.\n\n`;

  out += '## Products → modules\n\n';
  out += 'A module is reachable only when an enabled product carries it (iron rule 4).\n\n';
  out += '| product | label | modules (side) | requires |\n';
  out += '|---|---|---|---|\n';
  for (const p of [...allProducts()].sort((a, b) => a.key.localeCompare(b.key))) {
    const mods = p.modules.map((m) => `${m.module} (${m.side})`).join(', ');
    out += `| ${p.key} | ${p.label} | ${mods} | ${p.requires?.join(', ') ?? '—'} |\n`;
  }

  out += '\n## Grantable permission rows (as the Access Levels UI derives them)\n\n';
  out += 'Each row is a module×bucket; the UI renders one toggle per verb the module declares.\n\n';
  for (const p of [...allProducts()].sort((a, b) => a.key.localeCompare(b.key))) {
    const rows = derivePermissionRows([p.key]);
    if (rows.length === 0) continue;
    out += `### ${p.key}\n\n`;
    for (const row of rows) {
      const keys = row.module.verbs.map((v) => `\`${row.module.key}.${row.bucket}.${v}\``).join(' ');
      out += `- ${row.module.key} × ${row.bucket}: ${keys}\n`;
    }
    out += '\n';
  }
  return out;
}

// ---------------------------------------------------------------------------
// schema.md
// ---------------------------------------------------------------------------

// Table-name prefix → owning module/area, first match wins.
const TABLE_OWNER: Array<[RegExp, string]> = [
  [/^booking/, 'booking'],
  [/^pos_|^sales|^sale_/, 'pos'],
  [/^catalog/, 'catalog'],
  [/^crm_/, 'crm'],
  [/^email_|^mail/, 'email'],
  [/^finance_/, 'finance'],
  [/^inventory_/, 'inventory'],
  [/^manufacturing_|^mfg_/, 'manufacturing'],
  [/^marketing_/, 'marketing'],
  [/^portfolio_|^brand_/, 'portfolio'],
  [/^procurement_/, 'procurement'],
  [/^supply_chain_/, 'supply-chain'],
  [/^warehouse_/, 'warehouse'],
  [/^workforce_|^project_/, 'workforce / project-service'],
  [/^data_collection_|^onboarding_/, 'data-collection'],
  [/^products?$|^product_/, 'products'],
  [/^files?$|^file_/, 'files (platform)'],
  [/^bucket_user_credentials/, 'login (user-portal auth)'],
  [/^workspace_storage/, 'files (platform)'],
  [/^admins|^login_attempts|^clients?|^client_|^user_node|^audit_log|^schema_ops_log/, 'ams / platform core'],
];

function tableOwner(t: string): string {
  for (const [re, owner] of TABLE_OWNER) if (re.test(t)) return owner;
  return 'platform (unmapped prefix)';
}

interface TableInfo {
  name: string;
  createdIn: string;
  columnsAtCreation: string[];
  alteredIn: string[];
}

function parseSchema(): TableInfo[] {
  const tables = new Map<string, TableInfo>();
  const migrations = readdirSync(MIG_DIR).filter((f) => f.endsWith('.sql')).sort();
  for (const mig of migrations) {
    const sql = readFileSync(join(MIG_DIR, mig), 'utf8');
    // CREATE TABLE [IF NOT EXISTS] [public.]name ( ... );
    const createRe = /CREATE TABLE (?:IF NOT EXISTS )?(?:public\.)?([a-z_0-9]+)\s*\(([\s\S]*?)\n\)\s*;/gi;
    for (const m of sql.matchAll(createRe)) {
      const name = m[1]!;
      const body = m[2]!;
      const cols = body
        .split('\n')
        .map((l) => l.trim().replace(/,$/, ''))
        .filter((l) => l && !l.startsWith('--'))
        .filter((l) => !/^(PRIMARY KEY|UNIQUE|CHECK|CONSTRAINT|FOREIGN KEY|EXCLUDE)/i.test(l))
        .map((l) => l.split(/\s+/).slice(0, 2).join(' '));
      if (!tables.has(name)) {
        tables.set(name, { name, createdIn: mig, columnsAtCreation: cols, alteredIn: [] });
      }
    }
    const alterRe = /ALTER TABLE (?:IF EXISTS )?(?:ONLY )?(?:public\.)?([a-z_0-9]+)/g;
    for (const m of sql.matchAll(alterRe)) {
      const t = tables.get(m[1]!);
      if (t && t.createdIn !== mig && !t.alteredIn.includes(mig)) t.alteredIn.push(mig);
    }
  }
  return [...tables.values()].sort((a, b) => a.name.localeCompare(b.name));
}

function renderSchema(tables: TableInfo[]): string {
  let out = GENERATED_HEADER('db/migrations/*.sql (CREATE TABLE / ALTER TABLE statements)');
  out += '# Database schema by module\n\n';
  out += `${tables.length} tables across ${readdirSync(MIG_DIR).filter((f) => f.endsWith('.sql')).length} forward-only migrations.\n`;
  out += 'Columns listed are AS OF CREATION — check the "altered in" migrations (and the live DB)\n';
  out += 'for the current shape. Migration numbers are allocated by the human coordinator (iron rule 1).\n\n';
  const byOwner = new Map<string, TableInfo[]>();
  for (const t of tables) {
    const owner = tableOwner(t.name);
    const list = byOwner.get(owner) ?? [];
    list.push(t);
    byOwner.set(owner, list);
  }
  for (const owner of [...byOwner.keys()].sort()) {
    out += `## ${owner}\n\n`;
    for (const t of byOwner.get(owner)!) {
      out += `### \`${t.name}\`\n\n`;
      out += `- created in \`${t.createdIn}\`${t.alteredIn.length ? `; altered in ${t.alteredIn.map((a) => `\`${a}\``).join(', ')}` : ''}\n`;
      out += `- columns at creation: ${t.columnsAtCreation.map((c) => `\`${c}\``).join(', ')}\n\n`;
    }
  }
  return out;
}

// ---------------------------------------------------------------------------

mkdirSync(OUT_DIR, { recursive: true });
writeFileSync(join(OUT_DIR, 'endpoints.md'), renderEndpoints(parseEndpoints()));
writeFileSync(join(OUT_DIR, 'permissions.md'), renderPermissions());
writeFileSync(join(OUT_DIR, 'schema.md'), renderSchema(parseSchema()));
console.log('Wrote docs/reference/{endpoints,permissions,schema}.md');
