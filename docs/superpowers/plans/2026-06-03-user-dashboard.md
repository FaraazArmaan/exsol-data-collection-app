# Bucket-User Dashboard Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the bucket-user post-login placeholder card with a permission-aware nav-shell dashboard (sidebar + topbar + content area). Modules render as stub pages; "Manage team" and "Settings" surface as Owner-only stub tiles; Account moves to a sub-page.

**Architecture:** Server extends `/api/u-me` with the flat permission matrix and the client's enabled-Modules list. Client gains a `UserDashboardLayout` (sidebar + topbar) and three new pages (`UserDashboardHome`, `ModuleStub`, plus the relocated `UserAccount`). A pure `useNavItems` hook turns auth-context state into rail entries — Owner sees every enabled Module, L2+ sees Modules with at least one Read verb.

**Tech Stack:** TypeScript everywhere. React 18 + react-router-dom on the front end. Netlify Functions + Neon (Postgres) on the back. Vitest for tests. Builds on [2026-06-03-user-dashboard-design.md](../specs/2026-06-03-user-dashboard-design.md), [2026-06-01-access-levels-design.md](../specs/2026-06-01-access-levels-design.md), and the existing `derivePermissionRows` registry helper at `src/modules/registry/products.ts`.

---

## File map

**New files:**
- `src/modules/user-portal/layout/UserDashboardLayout.tsx` — chrome.
- `src/modules/user-portal/layout/Sidebar.tsx` — nav rail.
- `src/modules/user-portal/layout/TopBar.tsx` — client name + user menu.
- `src/modules/user-portal/nav/useNavItems.ts` — pure derivation hook.
- `src/modules/user-portal/nav/useNavItems.test.ts` — unit tests for hook.
- `src/modules/user-portal/pages/UserDashboardHome.tsx` — landing.
- `src/modules/user-portal/pages/ModuleStub.tsx` — generic Module placeholder.

**Modified files:**
- `netlify/functions/u-me.ts` — return `permissions` + `enabled_modules`.
- `netlify/functions/_shared/permissions.ts` — export `getLevelMatrix` (currently file-private).
- `src/modules/user-portal/api.ts` — extend `UserPortalUser`-adjacent types; extend `userMe()` return shape.
- `src/modules/user-portal/user-auth-context.tsx` — surface `permissions` + `enabled_modules` from the context.
- `src/modules/user-portal/UserPortalRoutes.tsx` — no signature change; the new routing happens in `router.tsx`.
- `src/lib/router.tsx` — restructure `/c/:slug` children to nest dashboard layout + new pages.
- `src/modules/user-portal/pages/UserAccount.tsx` — drop H1/identity heading and Sign-out (TopBar owns those now); keep Your-account / Sign-in-methods / Change-password link.
- `tests/integration/user-node-auth.test.ts` — add u-me payload tests (level + permissions + enabled_modules for L1, L2 with restricted matrix, and client-with-no-products).

**No DB migration. No new dependencies.**

---

## Pre-flight (every task)

Before any task's commit, the implementer MUST run:

```bash
npm run typecheck && npm test
```

Typecheck is non-negotiable — runtime tests can pass on broken types. If either fails, fix and re-run before committing. (Saved feedback: `feedback_implementer_verify_typecheck`.)

---

# Task 1: Extend `/api/u-me` with permissions matrix + enabled modules

Add the two fields the dashboard needs in a single round-trip. `level_number` is already in the response (verified at `netlify/functions/u-me.ts:68`).

**Files:**
- Modify: `netlify/functions/_shared/permissions.ts` — export `getLevelMatrix`.
- Modify: `netlify/functions/u-me.ts` — extend response.
- Modify: `tests/integration/user-node-auth.test.ts` — add three test cases.

- [ ] **Step 1: Export `getLevelMatrix` from the shared permissions module**

In `netlify/functions/_shared/permissions.ts`, change line 97:

```typescript
// before
async function getLevelMatrix(clientId: string, levelNumber: number): Promise<Record<string, true>> {

// after
export async function getLevelMatrix(clientId: string, levelNumber: number): Promise<Record<string, true>> {
```

(Adding `export`. No other change to the function body.)

- [ ] **Step 2: Write the failing integration tests**

Append three tests to `tests/integration/user-node-auth.test.ts`. Add the `adminClientProductsHandler` import at the top of the file (alongside the other handler imports near line 18):

```typescript
import adminClientProductsHandler from '../../netlify/functions/admin-client-products';
```

Then append this new describe block to the end of the file (just before the file-final closing of the outer describe — i.e., as a sibling of the existing `'user-node auth'` describe block, or append inside it; either works):

```typescript
describe('u-me payload extensions (dashboard)', () => {
  // Helper: create L2 level allowed for the test role, and return its id.
  async function createL2Level(): Promise<string> {
    const r = await clientLevelsHandler(
      new Request(`http://localhost/api/client-levels?client=${testClientId}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json', cookie },
        body: JSON.stringify({ level_number: 2, allowed_role_ids: [roleId] }),
      }), CTX,
    );
    if (r.status !== 201) throw new Error(`create L2 failed: ${r.status} ${await r.text()}`);
    return (await r.json() as { level: { id: string } }).level.id;
  }

  // Helper: enable saloon-booking on the test client.
  async function enableSaloonBooking(): Promise<void> {
    const r = await adminClientProductsHandler(
      new Request(`http://localhost/api/admin-client-products?client=${testClientId}`, {
        method: 'PUT', headers: { 'Content-Type': 'application/json', cookie },
        body: JSON.stringify({ keys: ['saloon-booking'] }),
      }), CTX,
    );
    if (r.status !== 200) throw new Error(`enable product failed: ${r.status} ${await r.text()}`);
  }

  // Helper: log in as a bucket user and return the bu_session cookie header.
  async function bucketUserLogin(email: string, password: string): Promise<string> {
    const r = await uLoginHandler(
      new Request(`http://localhost/api/u-login?client=${testClientSlug}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password }),
      }), CTX,
    );
    if (r.status !== 200) throw new Error(`u-login failed: ${r.status}`);
    return r.headers.get('set-cookie')!.split(';')[0]!;
  }

  // Helper: create a node at a specific level and return the node id.
  async function createNodeAtLevel(
    email: string, password: string, levelNumber: number,
  ): Promise<string> {
    const r = await userNodesHandler(
      new Request(`http://localhost/api/user-nodes?client=${testClientId}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json', cookie },
        body: JSON.stringify({
          role_id: roleId, level_number: levelNumber, parent_id: null,
          display_name: `L${levelNumber} User`, email,
          create_login: true, temp_password: password,
        }),
      }), CTX,
    );
    if (r.status !== 201) throw new Error(`create node failed: ${r.status} ${await r.text()}`);
    return (await r.json() as { node: { id: string } }).node.id;
  }

  test('L1 user u-me response includes permissions object and enabled_modules', async () => {
    await enableSaloonBooking();
    const email = `u-me-l1-${Date.now()}@example.com`;
    await createNodeWithLogin(email, 'l1-pass-1');
    const buCookie = await bucketUserLogin(email, 'l1-pass-1');

    const r = await uMeHandler(
      new Request('http://localhost/api/u-me', { headers: { cookie: buCookie } }),
      CTX,
    );
    expect(r.status).toBe(200);
    const body = await r.json() as {
      user: { level_number: number | null };
      permissions: Record<string, true>;
      enabled_modules: Array<{ key: string; label: string }>;
    };
    expect(body.user.level_number).toBe(1);
    expect(typeof body.permissions).toBe('object'); // may be empty — L1 bypasses matrix
    const moduleKeys = body.enabled_modules.map((m) => m.key).sort();
    expect(moduleKeys).toEqual(['booking', 'payments']);
  });

  test('L2 user u-me response surfaces only the granted matrix keys', async () => {
    await enableSaloonBooking();
    const l2Id = await createL2Level();
    // Set a restricted matrix on the L2 level: view on booking.customers only.
    // We import clientLevelsPermissionsHandler at the top of the file for this.
    const clientLevelsPermissionsHandler = (
      await import('../../netlify/functions/client-levels-permissions')
    ).default;
    const putR = await clientLevelsPermissionsHandler(
      new Request(`http://localhost/api/client-levels-permissions?id=${l2Id}`, {
        method: 'PUT', headers: { 'Content-Type': 'application/json', cookie },
        body: JSON.stringify({ permissions: { 'booking.customers.view': true } }),
      }), CTX,
    );
    expect(putR.status).toBe(200);

    const email = `u-me-l2-${Date.now()}@example.com`;
    await createNodeAtLevel(email, 'l2-pass-1', 2);
    const buCookie = await bucketUserLogin(email, 'l2-pass-1');

    const r = await uMeHandler(
      new Request('http://localhost/api/u-me', { headers: { cookie: buCookie } }),
      CTX,
    );
    expect(r.status).toBe(200);
    const body = await r.json() as {
      user: { level_number: number | null };
      permissions: Record<string, true>;
      enabled_modules: Array<{ key: string; label: string }>;
    };
    expect(body.user.level_number).toBe(2);
    expect(body.permissions).toEqual({ 'booking.customers.view': true });
    // Module is enabled on the client regardless of the user's matrix —
    // the client-side useNavItems hook is what filters by matrix.
    const moduleKeys = body.enabled_modules.map((m) => m.key).sort();
    expect(moduleKeys).toEqual(['booking', 'payments']);
  });

  test('user on a client with no enabled Products receives empty enabled_modules', async () => {
    // No enableSaloonBooking() — clean client from beforeEach.
    const email = `u-me-empty-${Date.now()}@example.com`;
    await createNodeWithLogin(email, 'empty-pass-1');
    const buCookie = await bucketUserLogin(email, 'empty-pass-1');

    const r = await uMeHandler(
      new Request('http://localhost/api/u-me', { headers: { cookie: buCookie } }),
      CTX,
    );
    expect(r.status).toBe(200);
    const body = await r.json() as {
      enabled_modules: unknown[];
      permissions: Record<string, true>;
    };
    expect(body.enabled_modules).toEqual([]);
    expect(typeof body.permissions).toBe('object');
  });
});
```

Note: the `clientLevelsPermissionsHandler` import is done dynamically inside the L2 test to keep the import section diff small; the implementer is welcome to hoist it to the top with the other static imports — either works.

- [ ] **Step 3: Run tests to verify they fail**

```bash
npm test -- tests/integration/user-node-auth.test.ts
```

Expected: the three new tests FAIL because u-me does not yet return `permissions` or `enabled_modules`.

- [ ] **Step 4: Implement the u-me extension**

Edit `netlify/functions/u-me.ts`. After the existing user-row fetch (around line 47), add the permission + enabled-products fetches, then include them in the response body.

```typescript
// Add to imports at top:
import { getLevelMatrix } from './_shared/permissions';
import { derivePermissionRows } from '../../src/modules/registry/products';

// After `const row = rows[0]!;` (around line 48), add:

const levelNumber = row.level_number ?? 1; // legacy rows without a level default to Primary
const permissions = await getLevelMatrix(row.client_id, levelNumber);

const enabledProductRows = (await sql`
  SELECT product_key FROM public.client_enabled_products
  WHERE client_id = ${row.client_id}::uuid
`) as { product_key: string }[];
const enabledProductKeys = enabledProductRows.map((r) => r.product_key);

// Reduce derivePermissionRows() down to a unique list of Modules.
const moduleMap = new Map<string, { key: string; label: string }>();
for (const pr of derivePermissionRows(enabledProductKeys)) {
  if (!moduleMap.has(pr.module.key)) {
    moduleMap.set(pr.module.key, { key: pr.module.key, label: pr.module.label });
  }
}
const enabledModules = Array.from(moduleMap.values());

// Then extend the jsonOk(...) response at the bottom:
return jsonOk({
  user: {
    id: row.id,
    display_name: row.display_name,
    email: row.email,
    phone: row.phone,
    notes: row.notes,
    fields: row.fields,
    level_number: row.level_number,
    role: { key: row.role_key, label: row.role_label, color: row.role_color },
    must_change_password: actor.credential.must_change_password,
    has_google: hasGoogle,
  },
  client: { id: row.client_id, slug: row.client_slug, name: row.client_name },
  permissions,
  enabled_modules: enabledModules,
}, { headers });
```

- [ ] **Step 5: Run tests + typecheck**

```bash
npm run typecheck
npm test -- tests/integration/user-node-auth.test.ts
```

Expected: typecheck clean. All three new tests PASS. The pre-existing `'admin cookie cannot auth /api/u-me'` test still PASSES (it asserts on status code, not body shape).

- [ ] **Step 6: Run the full test suite**

```bash
npm test
```

Expected: all tests pass (the previous green count was 139/139 per handoff).

- [ ] **Step 7: Commit**

```bash
git add netlify/functions/u-me.ts netlify/functions/_shared/permissions.ts tests/integration/user-node-auth.test.ts
git commit -m "$(cat <<'EOF'
feat(u-me): expose permissions matrix + enabled_modules

Dashboard needs both the user's flat permission matrix and the list of
Modules enabled on their client to render the nav rail. Single round-trip
addition — extends the existing /api/u-me response.

Exports the previously-private getLevelMatrix helper.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

# Task 2: Client types + auth context

Surface the new u-me fields through the React context so every dashboard component has them without extra plumbing.

**Files:**
- Modify: `src/modules/user-portal/api.ts` — extend `userMe()` return type.
- Modify: `src/modules/user-portal/user-auth-context.tsx` — store + expose the new fields.

- [ ] **Step 1: Add the new types to `api.ts`**

Edit `src/modules/user-portal/api.ts`:

```typescript
// Add after the UserPortalClient interface (around line 20):

export interface UserPortalEnabledModule {
  key: string;
  label: string;
}

// PermissionMatrix is a flat map: 'module.bucket.verb' → true.
// Absent keys are denied.
export type UserPortalPermissionMatrix = Record<string, true>;

// Change the userMe() signature (around line 33-34):
export const userMe = () =>
  apiFetch<{
    user: UserPortalUser;
    client: UserPortalClient;
    permissions: UserPortalPermissionMatrix;
    enabled_modules: UserPortalEnabledModule[];
  }>('/api/u-me');
```

(The existing `UserPortalUser.level_number: number | null` field stays — no change needed there.)

- [ ] **Step 2: Extend the auth context**

Edit `src/modules/user-portal/user-auth-context.tsx`:

```typescript
import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import {
  userMe, userLogout,
  type UserPortalUser, type UserPortalClient,
  type UserPortalPermissionMatrix, type UserPortalEnabledModule,
} from './api';

interface State {
  user: UserPortalUser | null;
  client: UserPortalClient | null;
  permissions: UserPortalPermissionMatrix;
  enabledModules: UserPortalEnabledModule[];
  loading: boolean;
  refresh: () => Promise<void>;
  signOut: () => Promise<void>;
}

const Ctx = createContext<State | null>(null);

export function UserAuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<UserPortalUser | null>(null);
  const [client, setClient] = useState<UserPortalClient | null>(null);
  const [permissions, setPermissions] = useState<UserPortalPermissionMatrix>({});
  const [enabledModules, setEnabledModules] = useState<UserPortalEnabledModule[]>([]);
  const [loading, setLoading] = useState(true);

  const refresh = async () => {
    const r = await userMe();
    if (r.ok) {
      setUser(r.data.user);
      setClient(r.data.client);
      setPermissions(r.data.permissions);
      setEnabledModules(r.data.enabled_modules);
    } else {
      setUser(null);
      setClient(null);
      setPermissions({});
      setEnabledModules([]);
    }
    setLoading(false);
  };

  const signOut = async () => {
    await userLogout();
    setUser(null);
    setClient(null);
    setPermissions({});
    setEnabledModules([]);
  };

  useEffect(() => { void refresh(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <Ctx.Provider value={{ user, client, permissions, enabledModules, loading, refresh, signOut }}>
      {children}
    </Ctx.Provider>
  );
}

export function useUserAuth(): State {
  const v = useContext(Ctx);
  if (!v) throw new Error('useUserAuth outside UserAuthProvider');
  return v;
}
```

- [ ] **Step 3: Run typecheck**

```bash
npm run typecheck
```

Expected: clean. (Existing consumers — `UserAccount.tsx`, `UserChangePassword.tsx`, `UserLogin.tsx` — only read `user`/`client`/`signOut`/`refresh`/`loading`, so the additive context change does not break them.)

- [ ] **Step 4: Run tests**

```bash
npm test
```

Expected: pass.

- [ ] **Step 5: Commit**

```bash
git add src/modules/user-portal/api.ts src/modules/user-portal/user-auth-context.tsx
git commit -m "$(cat <<'EOF'
feat(user-portal): surface permissions + enabled_modules in auth context

Additive change to UserAuthProvider — existing consumers continue reading
{user, client, signOut, refresh, loading} unchanged. New dashboard pieces
will consume permissions + enabledModules from the same context.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

# Task 3: `useNavItems` hook + unit tests

Pure derivation: takes auth-context state, returns the ordered list of Module nav entries the rail should render. No DOM, no side effects — fully testable in isolation.

**Files:**
- Create: `src/modules/user-portal/nav/useNavItems.ts`
- Create: `src/modules/user-portal/nav/useNavItems.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `src/modules/user-portal/nav/useNavItems.test.ts`:

```typescript
import { describe, expect, test } from 'vitest';
import { computeNavItems } from './useNavItems';
import type {
  UserPortalEnabledModule, UserPortalPermissionMatrix,
} from '../api';

// Real Module shapes from src/modules/registry/manifests/.
// Booking & Calendar has buckets { customers, employees }; Payments has { customers, products }.
// Verbs are { view, create, edit, delete } (payments has no delete).
const booking: UserPortalEnabledModule = { key: 'booking', label: 'Booking & Calendar' };
const payments: UserPortalEnabledModule = { key: 'payments', label: 'Payments' };
const enabled = [booking, payments];

describe('computeNavItems', () => {
  test('L1 (Owner) sees every enabled Module regardless of matrix', () => {
    const items = computeNavItems({
      slug: 'acme',
      levelNumber: 1,
      enabledModules: enabled,
      permissions: {},
    });
    expect(items.map((i) => i.moduleKey)).toEqual(['booking', 'payments']);
    expect(items[0]).toMatchObject({
      moduleKey: 'booking',
      label: 'Booking & Calendar',
      href: '/c/acme/m/booking',
    });
  });

  test('L2 with view on Booking only sees Booking', () => {
    const items = computeNavItems({
      slug: 'acme',
      levelNumber: 2,
      enabledModules: enabled,
      permissions: { 'booking.customers.view': true },
    });
    expect(items.map((i) => i.moduleKey)).toEqual(['booking']);
  });

  test('L2 with no view verbs sees nothing', () => {
    const items = computeNavItems({
      slug: 'acme',
      levelNumber: 3,
      enabledModules: enabled,
      // 'create' alone does not surface a Module in nav — read access (view) is required.
      permissions: { 'booking.customers.create': true },
    });
    expect(items).toEqual([]);
  });

  test('Module enabled on client but absent from permissions is excluded for L2+', () => {
    const items = computeNavItems({
      slug: 'acme',
      levelNumber: 2,
      enabledModules: enabled,
      permissions: { 'payments.customers.view': true },
    });
    expect(items.map((i) => i.moduleKey)).toEqual(['payments']);
  });

  test('alphabetical ordering by label', () => {
    const items = computeNavItems({
      slug: 'acme',
      levelNumber: 1,
      enabledModules: [payments, booking], // pass in reverse
      permissions: {},
    });
    expect(items.map((i) => i.label)).toEqual(['Booking & Calendar', 'Payments']);
  });

  test('null levelNumber treated as L1 (legacy safety)', () => {
    const items = computeNavItems({
      slug: 'acme',
      levelNumber: null,
      enabledModules: enabled,
      permissions: {},
    });
    expect(items.map((i) => i.moduleKey)).toEqual(['booking', 'payments']);
  });

  test('platform keys (_platform.*) are ignored — they do not surface a Module', () => {
    const items = computeNavItems({
      slug: 'acme',
      levelNumber: 2,
      enabledModules: enabled,
      permissions: { '_platform.users.view': true, '_platform.settings.view': true },
    });
    expect(items).toEqual([]);
  });
});
```

- [ ] **Step 2: Verify tests fail**

```bash
npm test -- src/modules/user-portal/nav/useNavItems.test.ts
```

Expected: FAIL with "cannot find module './useNavItems'".

- [ ] **Step 3: Implement the hook + pure function**

Create `src/modules/user-portal/nav/useNavItems.ts`:

```typescript
import { useParams } from 'react-router-dom';
import { useUserAuth } from '../user-auth-context';
import type {
  UserPortalEnabledModule, UserPortalPermissionMatrix,
} from '../api';

export interface NavModuleItem {
  moduleKey: string;
  label: string;
  href: string;
}

interface ComputeArgs {
  slug: string;
  levelNumber: number | null;
  enabledModules: readonly UserPortalEnabledModule[];
  permissions: UserPortalPermissionMatrix;
}

// Pure — exported for unit tests.
export function computeNavItems(args: ComputeArgs): NavModuleItem[] {
  const { slug, levelNumber, enabledModules, permissions } = args;
  const isOwner = levelNumber == null || levelNumber === 1;

  // A Module appears in the rail iff the user has the 'view' verb on at least
  // one of its buckets. Keys look like '<moduleKey>.<bucket>.view'. We exclude
  // '_platform.*' surfaces — those are not Modules and never belong in this rail.
  const hasViewOnModule = (moduleKey: string): boolean => {
    const prefix = `${moduleKey}.`;
    for (const key of Object.keys(permissions)) {
      if (key.startsWith(prefix) && key.endsWith('.view')) return true;
    }
    return false;
  };

  const visible = isOwner
    ? [...enabledModules]
    : enabledModules.filter((m) => hasViewOnModule(m.key));

  visible.sort((a, b) => a.label.localeCompare(b.label));

  return visible.map((m) => ({
    moduleKey: m.key,
    label: m.label,
    href: `/c/${slug}/m/${m.key}`,
  }));
}

// React hook wrapper — reads auth context + URL.
export function useNavItems(): NavModuleItem[] {
  const { slug } = useParams<{ slug: string }>();
  const { user, enabledModules, permissions } = useUserAuth();
  if (!slug || !user) return [];
  return computeNavItems({
    slug,
    levelNumber: user.level_number,
    enabledModules,
    permissions,
  });
}
```

- [ ] **Step 4: Run tests + typecheck**

```bash
npm run typecheck
npm test -- src/modules/user-portal/nav/useNavItems.test.ts
```

Expected: typecheck clean. All six unit tests PASS.

- [ ] **Step 5: Run the full test suite**

```bash
npm test
```

Expected: green.

- [ ] **Step 6: Commit**

```bash
git add src/modules/user-portal/nav/
git commit -m "$(cat <<'EOF'
feat(user-portal): useNavItems hook for permission-aware nav rail

Pure computeNavItems function + thin useNavItems wrapper around auth
context. Owner (L1) sees every enabled Module; L2+ filtered by at-least-
one .<bucket>.view in the permission matrix. Alphabetical by label.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

# Task 4: Layout shell — UserDashboardLayout + Sidebar + TopBar

The chrome that wraps every authenticated dashboard page. No new pages yet — this task just builds the layout components and verifies they render without errors when imported.

**Files:**
- Create: `src/modules/user-portal/layout/UserDashboardLayout.tsx`
- Create: `src/modules/user-portal/layout/Sidebar.tsx`
- Create: `src/modules/user-portal/layout/TopBar.tsx`

- [ ] **Step 1: Create `Sidebar.tsx`**

Create `src/modules/user-portal/layout/Sidebar.tsx`:

```typescript
import { NavLink, useParams } from 'react-router-dom';
import { useNavItems } from '../nav/useNavItems';

const linkStyle: React.CSSProperties = {
  display: 'block',
  padding: '8px 12px',
  borderRadius: 6,
  color: 'inherit',
  textDecoration: 'none',
  fontSize: 14,
};
const activeStyle: React.CSSProperties = {
  background: 'var(--surface-hover, rgba(255,255,255,0.06))',
  fontWeight: 600,
};

function navLinkStyle({ isActive }: { isActive: boolean }): React.CSSProperties {
  return isActive ? { ...linkStyle, ...activeStyle } : linkStyle;
}

export function Sidebar() {
  const { slug } = useParams<{ slug: string }>();
  const items = useNavItems();
  if (!slug) return null;

  return (
    <nav
      aria-label="Primary"
      style={{
        width: 220,
        flexShrink: 0,
        borderRight: '1px solid var(--border, rgba(255,255,255,0.08))',
        padding: 12,
        display: 'flex',
        flexDirection: 'column',
        gap: 4,
        minHeight: '100vh',
        boxSizing: 'border-box',
      }}
    >
      <NavLink to={`/c/${slug}`} end style={navLinkStyle}>Dashboard</NavLink>

      {items.length > 0 && (
        <>
          <div
            className="muted"
            style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: 0.5, padding: '12px 12px 4px' }}
          >
            Modules
          </div>
          {items.map((item) => (
            <NavLink key={item.moduleKey} to={item.href} style={navLinkStyle}>
              {item.label}
            </NavLink>
          ))}
        </>
      )}

      <div style={{ flex: 1 }} />

      <NavLink to={`/c/${slug}/account`} style={navLinkStyle}>Account</NavLink>
    </nav>
  );
}
```

- [ ] **Step 2: Create `TopBar.tsx`**

Create `src/modules/user-portal/layout/TopBar.tsx`:

```typescript
import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useUserAuth } from '../user-auth-context';

export function TopBar() {
  const { slug } = useParams<{ slug: string }>();
  const { user, client, signOut } = useUserAuth();
  const navigate = useNavigate();
  const [menuOpen, setMenuOpen] = useState(false);

  if (!user || !client) return null;

  async function handleSignOut() {
    setMenuOpen(false);
    await signOut();
    navigate(`/c/${slug}/login`, { replace: true });
  }

  return (
    <header
      style={{
        height: 56,
        flexShrink: 0,
        borderBottom: '1px solid var(--border, rgba(255,255,255,0.08))',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        padding: '0 20px',
        boxSizing: 'border-box',
      }}
    >
      <div style={{ fontWeight: 600 }}>{client.name}</div>

      <div style={{ position: 'relative' }}>
        <button
          className="btn btn-ghost"
          onClick={() => setMenuOpen((o) => !o)}
          aria-haspopup="menu"
          aria-expanded={menuOpen}
          style={{ display: 'flex', alignItems: 'center', gap: 6 }}
        >
          {user.display_name}
          <span aria-hidden style={{ fontSize: 10 }}>▾</span>
        </button>

        {menuOpen && (
          <div
            role="menu"
            style={{
              position: 'absolute',
              right: 0,
              top: 'calc(100% + 4px)',
              minWidth: 160,
              background: 'var(--surface, #1a1a1a)',
              border: '1px solid var(--border, rgba(255,255,255,0.12))',
              borderRadius: 6,
              padding: 4,
              zIndex: 10,
              display: 'flex',
              flexDirection: 'column',
            }}
          >
            <Link
              to={`/c/${slug}/account`}
              role="menuitem"
              onClick={() => setMenuOpen(false)}
              style={{ padding: '8px 12px', textDecoration: 'none', color: 'inherit', borderRadius: 4 }}
            >
              Account
            </Link>
            <button
              type="button"
              role="menuitem"
              onClick={() => { void handleSignOut(); }}
              style={{ textAlign: 'left', padding: '8px 12px', background: 'transparent', border: 0, color: 'inherit', borderRadius: 4, cursor: 'pointer' }}
            >
              Sign out
            </button>
          </div>
        )}
      </div>
    </header>
  );
}
```

- [ ] **Step 3: Create `UserDashboardLayout.tsx`**

Create `src/modules/user-portal/layout/UserDashboardLayout.tsx`:

```typescript
import { Outlet } from 'react-router-dom';
import { Sidebar } from './Sidebar';
import { TopBar } from './TopBar';

export function UserDashboardLayout() {
  return (
    <div style={{ display: 'flex', minHeight: '100vh' }}>
      <Sidebar />
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column' }}>
        <TopBar />
        <main style={{ flex: 1, padding: 24, boxSizing: 'border-box' }}>
          <Outlet />
        </main>
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Run typecheck**

```bash
npm run typecheck
```

Expected: clean. (Components are not wired into routes yet — they import correctly and reference real exports.)

- [ ] **Step 5: Run tests**

```bash
npm test
```

Expected: pass. (Layout components have no tests yet — covered manually in Task 5.)

- [ ] **Step 6: Commit**

```bash
git add src/modules/user-portal/layout/
git commit -m "$(cat <<'EOF'
feat(user-portal): dashboard layout shell (Sidebar + TopBar + Layout)

Sidebar consumes useNavItems for Module entries; always-on Dashboard and
Account anchors. TopBar shows client name + a dropdown user menu with
Account link and Sign out. Layout component wires them around <Outlet />.

Not yet wired into routes — that happens in the final task.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

# Task 5: Pages — UserDashboardHome + ModuleStub + route wire-up + UserAccount trim + smoke

The end-to-end task. Builds the two new pages, trims `UserAccount`, restructures the router, and finishes with a manual smoke checklist.

**Files:**
- Create: `src/modules/user-portal/pages/UserDashboardHome.tsx`
- Create: `src/modules/user-portal/pages/ModuleStub.tsx`
- Modify: `src/modules/user-portal/pages/UserAccount.tsx`
- Modify: `src/lib/router.tsx`

- [ ] **Step 1: Create `UserDashboardHome.tsx`**

Create `src/modules/user-portal/pages/UserDashboardHome.tsx`:

```typescript
import { Link, useParams } from 'react-router-dom';
import { useUserAuth } from '../user-auth-context';
import { useNavItems } from '../nav/useNavItems';

function StatTile({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="card" style={{ padding: 16, flex: 1, minWidth: 160 }}>
      <div className="muted" style={{ fontSize: 12, textTransform: 'uppercase', letterSpacing: 0.4 }}>{label}</div>
      <div style={{ fontSize: 20, fontWeight: 600, marginTop: 4 }}>{value}</div>
    </div>
  );
}

function StubTile({ title, description }: { title: string; description: string }) {
  return (
    <div
      className="card"
      title="Coming soon"
      style={{
        padding: 16,
        flex: 1,
        minWidth: 180,
        opacity: 0.6,
        cursor: 'not-allowed',
      }}
    >
      <div style={{ fontWeight: 600 }}>{title}</div>
      <div className="muted" style={{ fontSize: 13, marginTop: 4 }}>{description}</div>
      <div className="muted" style={{ fontSize: 11, marginTop: 8, textTransform: 'uppercase', letterSpacing: 0.5 }}>Coming soon</div>
    </div>
  );
}

export default function UserDashboardHome() {
  const { slug } = useParams<{ slug: string }>();
  const { user, client } = useUserAuth();
  const navItems = useNavItems();

  if (!user || !client || !slug) return null;

  const isOwner = user.level_number == null || user.level_number === 1;

  return (
    <div style={{ maxWidth: 960 }}>
      <header style={{ marginBottom: 24 }}>
        <h1 style={{ margin: 0, fontSize: 24 }}>Welcome back, {user.display_name}</h1>
        <p className="muted" style={{ margin: '4px 0 0', fontSize: 13 }}>
          {client.name} · {user.role.label}
        </p>
      </header>

      <section style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginBottom: 24 }}>
        <StatTile label="Role" value={user.role.label} />
        <StatTile label="Modules available" value={navItems.length} />
        <StatTile label="Workspace" value={client.name} />
      </section>

      <section style={{ marginBottom: 24 }}>
        <h2 style={{ fontSize: 16, margin: '0 0 12px' }}>Quick actions</h2>
        <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
          {navItems.map((item) => (
            <Link
              key={item.moduleKey}
              to={item.href}
              className="card"
              style={{
                padding: 16,
                flex: 1,
                minWidth: 180,
                textDecoration: 'none',
                color: 'inherit',
              }}
            >
              <div style={{ fontWeight: 600 }}>{item.label}</div>
              <div className="muted" style={{ fontSize: 13, marginTop: 4 }}>Open module</div>
            </Link>
          ))}
          {isOwner && (
            <>
              <StubTile title="Manage team" description="Add, edit, and remove users in your workspace." />
              <StubTile title="Settings" description="Configure workspace preferences and integrations." />
            </>
          )}
        </div>
      </section>
    </div>
  );
}
```

- [ ] **Step 2: Create `ModuleStub.tsx`**

Create `src/modules/user-portal/pages/ModuleStub.tsx`:

```typescript
import { Navigate, useParams } from 'react-router-dom';
import { useUserAuth } from '../user-auth-context';
import { useNavItems } from '../nav/useNavItems';

export default function ModuleStub() {
  const { slug, moduleKey } = useParams<{ slug: string; moduleKey: string }>();
  const { user, permissions } = useUserAuth();
  const navItems = useNavItems();

  if (!slug || !moduleKey || !user) return null;

  const item = navItems.find((n) => n.moduleKey === moduleKey);
  if (!item) return <Navigate to={`/c/${slug}`} replace />;

  // Pull the verbs the user has on this Module, grouped per bucket.
  // Permission keys look like '<moduleKey>.<bucket>.<verb>'.
  const prefix = `${moduleKey}.`;
  const bucketVerbs = new Map<string, string[]>();
  for (const key of Object.keys(permissions)) {
    if (!key.startsWith(prefix)) continue;
    const rest = key.slice(prefix.length);
    const lastDot = rest.lastIndexOf('.');
    if (lastDot < 1) continue;
    const bucket = rest.slice(0, lastDot);
    const verb = rest.slice(lastDot + 1);
    const list = bucketVerbs.get(bucket) ?? [];
    list.push(verb);
    bucketVerbs.set(bucket, list);
  }

  const isOwner = user.level_number == null || user.level_number === 1;

  return (
    <div style={{ maxWidth: 720 }}>
      <h1 style={{ margin: 0, fontSize: 24 }}>{item.label}</h1>
      <p className="muted" style={{ margin: '8px 0 24px', fontSize: 14 }}>
        This module's UI is coming soon.
      </p>

      <div className="card" style={{ padding: 16 }}>
        <h3 style={{ margin: '0 0 8px', fontSize: 14, textTransform: 'uppercase', letterSpacing: 0.5 }}>
          Your permissions here
        </h3>
        {isOwner ? (
          <p style={{ margin: 0, fontSize: 13 }}>You are the Owner — full access to all buckets.</p>
        ) : bucketVerbs.size === 0 ? (
          <p className="muted" style={{ margin: 0, fontSize: 13 }}>No explicit permissions granted.</p>
        ) : (
          <ul style={{ margin: 0, paddingLeft: 18, fontSize: 13 }}>
            {Array.from(bucketVerbs.entries()).sort().map(([bucket, verbs]) => (
              <li key={bucket}>
                <strong>{bucket}</strong>: {verbs.sort().join(', ')}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Trim `UserAccount.tsx`**

Edit `src/modules/user-portal/pages/UserAccount.tsx`. Remove the `<PageShell>` wrapper (now wrapped by `UserDashboardLayout`), the top-level identity `<header>`, and the Sign-out button (TopBar owns it). Keep Your-account / Sign-in-methods / Change-password link.

Full replacement file:

```typescript
import { useCallback, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useUserAuth } from '../user-auth-context';
import { GoogleSignInButton } from '../../../lib/google-signin';
import { userLinkGoogle, userUnlinkGoogle } from '../api';

export default function UserAccount() {
  const { slug } = useParams<{ slug: string }>();
  const { user, refresh } = useUserAuth();

  const [linkError, setLinkError] = useState<string | null>(null);
  const [linkOk, setLinkOk] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const handleLinkGoogle = useCallback(async (idToken: string) => {
    setLinkError(null); setLinkOk(null); setBusy(true);
    const r = await userLinkGoogle(idToken);
    setBusy(false);
    if (!r.ok) {
      const code = r.error.code;
      setLinkError(
        code === 'google_email_mismatch' ? 'That Google account uses a different email than your registered one.'
        : code === 'google_already_linked' ? 'A different Google account is already linked. Unlink it first.'
        : code === 'google_already_claimed_in_this_workspace' ? 'Another user in this workspace already linked that Google account.'
        : code === 'google_token_invalid' || code === 'google_email_unverified' ? 'Google sign-in failed.'
        : `Failed (${code}).`,
      );
      return;
    }
    setLinkOk('Google account linked. You can now sign in with Google.');
    await refresh();
  }, [refresh]);

  async function handleUnlink() {
    if (!confirm('Unlink your Google account from this profile? You will still be able to sign in with email + password.')) return;
    setLinkError(null); setLinkOk(null); setBusy(true);
    const r = await userUnlinkGoogle();
    setBusy(false);
    if (!r.ok) {
      setLinkError(r.error.code === 'cannot_unlink_only_credential'
        ? 'Cannot unlink — Google is your only sign-in method. Set a password first (change-password), then try again.'
        : `Failed (${r.error.code}).`);
      return;
    }
    setLinkOk('Google unlinked.');
    await refresh();
  }

  if (!user) return null;

  return (
    <div style={{ maxWidth: 640 }}>
      <h1 style={{ margin: '0 0 24px', fontSize: 24 }}>Account</h1>

      <div className="card" style={{ marginBottom: 16, padding: 16 }}>
        <h3 style={{ margin: '0 0 8px' }}>Your account</h3>
        <p className="muted" style={{ margin: 0, fontSize: 13 }}>
          Email: <strong>{user.email}</strong>
        </p>
        <p className="muted" style={{ margin: '4px 0 0', fontSize: 13 }}>
          Role: <strong>{user.role.label}</strong>
        </p>
      </div>

      <div className="card" style={{ marginBottom: 16, padding: 16 }}>
        <h3 style={{ margin: '0 0 8px' }}>Sign-in methods</h3>
        <p className="muted" style={{ margin: 0, fontSize: 13 }}>
          Email + password is always available.
        </p>
        <div style={{ marginTop: 10 }}>
          {user.has_google ? (
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
              <span style={{ fontSize: 13 }}>✓ Google account is linked.</span>
              <button className="btn btn-ghost" onClick={handleUnlink} disabled={busy}>
                Unlink Google
              </button>
            </div>
          ) : (
            <div>
              <p className="muted" style={{ margin: '0 0 8px', fontSize: 12 }}>
                Link your Google account so you can sign in with one click.
              </p>
              <GoogleSignInButton onCredential={handleLinkGoogle} text="continue_with" />
            </div>
          )}
          {linkOk && <p className="muted" style={{ marginTop: 8, fontSize: 12, color: 'var(--success, #22c55e)' }}>{linkOk}</p>}
          {linkError && <p className="error" style={{ marginTop: 8 }}>{linkError}</p>}
        </div>
      </div>

      <div style={{ marginTop: 16 }}>
        <Link to={`/c/${slug}/change-password`} className="btn btn-secondary">Change password</Link>
      </div>
    </div>
  );
}
```

(`PageShell` import is gone; `signOut` from auth-context is gone; the H1 changes from "Hello, {name}" to "Account" since identity now lives in TopBar.)

- [ ] **Step 4: Restructure the router**

Edit `src/lib/router.tsx`. Replace the `/c/:slug` block (lines 33-46 in the current file) so the dashboard layout wraps the authenticated children:

```typescript
// Add to imports at the top:
import UserDashboardHome from '../modules/user-portal/pages/UserDashboardHome';
import ModuleStub from '../modules/user-portal/pages/ModuleStub';
import { UserDashboardLayout } from '../modules/user-portal/layout/UserDashboardLayout';

// Replace the entire `/c/:slug` route object with:
{
  path: '/c/:slug',
  element: <UserPortalLayout />,
  children: [
    { path: 'login', element: <UserLogin /> },
    {
      element: <RequireBucketUser />,
      children: [
        // Change-password stays outside dashboard chrome — the forced-reset
        // flow should not look like a fully-furnished workspace.
        { path: 'change-password', element: <UserChangePassword /> },
        {
          element: <UserDashboardLayout />,
          children: [
            { index: true, element: <UserDashboardHome /> },
            { path: 'account', element: <UserAccount /> },
            { path: 'm/:moduleKey', element: <ModuleStub /> },
          ],
        },
      ],
    },
  ],
},
```

- [ ] **Step 5: Run typecheck**

```bash
npm run typecheck
```

Expected: clean.

- [ ] **Step 6: Run the full test suite**

```bash
npm test
```

Expected: green. (No new test files in this task; integration tests from Task 1 and unit tests from Task 3 still hold.)

- [ ] **Step 7: Manual smoke test**

The dev server should be running (`npm run dev` → http://localhost:8888). If not, start it.

For each step, open the listed URL and verify the listed outcome:

1. **Log in as an L1 (Owner) bucket-user.** Use any seeded client + Owner credentials. After login, browser should land on `http://localhost:8888/c/<slug>/` (no `/account`).
   - **Verify:** sidebar visible on the left with `Dashboard`, then Module entries (if Products are enabled on the client), then `Account` at the bottom.
   - **Verify:** topbar at top with client name on the left, "{display_name} ▾" on the right.
   - **Verify:** main area shows "Welcome back, {name}", 3 stat tiles, and a Quick-actions row that includes "Manage team" and "Settings" stub tiles.

2. **Click a Module nav entry.** URL becomes `/c/<slug>/m/<moduleKey>`.
   - **Verify:** page shows the Module label, "This module's UI is coming soon", and "Your permissions here: You are the Owner — full access to all buckets."

3. **Click "Account" in the sidebar.** URL becomes `/c/<slug>/account`.
   - **Verify:** see "Account" heading, Your-account card (email + role), Sign-in-methods card with Google link state, and a Change-password button. NO Sign-out button on the page (Sign-out is in the topbar menu).

4. **Click "Manage team" stub tile** on the dashboard home.
   - **Verify:** tile shows "Coming soon" label and a `not-allowed` cursor; click does nothing.

5. **Open the topbar user menu and click Sign out.**
   - **Verify:** redirected to `/c/<slug>/login`.

6. **If a seeded L2+ user with restricted permissions is available, log in as them.**
   - **Verify:** sidebar Modules list is restricted to the Modules they have at-least-one-`view` on.
   - **Verify:** dashboard home does NOT show the "Manage team" or "Settings" stub tiles.
   - **Verify:** directly visiting a Module URL they don't have `view` on (`/c/<slug>/m/<other-module>`) redirects them back to `/c/<slug>`.

   If no such test user exists, create one via the admin AMS UI before running this step (or skip + note explicitly).

7. **Try to break the change-password flow.** Log in as a user with `must_change_password = true` (set via admin forgot-password). After login, they should land on `/c/<slug>/change-password` and NOT see the dashboard chrome (sidebar/topbar).
   - **Verify:** standalone change-password page, no sidebar visible.

If any step fails, fix before committing.

- [ ] **Step 8: Commit**

```bash
git add src/modules/user-portal/pages/UserDashboardHome.tsx \
        src/modules/user-portal/pages/ModuleStub.tsx \
        src/modules/user-portal/pages/UserAccount.tsx \
        src/lib/router.tsx
git commit -m "$(cat <<'EOF'
feat(user-portal): real bucket-user dashboard (nav shell + module stubs)

Replaces the placeholder UserAccount landing with a permission-aware
dashboard: UserDashboardLayout wraps Sidebar + TopBar around nested
routes. Dashboard home shows welcome + stat tiles + Quick-actions
(Owner-only stubs for Manage team / Settings, plus accessible Modules).
Each Module link routes to a ModuleStub that surfaces the user's
matrix-derived permissions on that Module. Account becomes a sub-page
reached from the sidebar.

Change-password remains outside the dashboard chrome so the forced-reset
flow stays uncluttered.

Closes the design in docs/superpowers/specs/2026-06-03-user-dashboard-design.md.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Self-review checklist (after implementation, before reporting done)

Run through these explicitly:

- [ ] `npm run typecheck` clean.
- [ ] `npm test` shows the previous green count + the 3 new u-me tests + the 7 new useNavItems tests (was 139; should be 149).
- [ ] No new files in `src/modules/user-portal/` are dead (every new file imported by at least one other file or a route).
- [ ] `UserAccount.tsx` no longer imports `PageShell` or `signOut`.
- [ ] `router.tsx` `/c/:slug/` index route is `UserDashboardHome`, not `UserAccount`.
- [ ] Smoke test step 7 (must_change_password user) verified — regressing the forced-reset flow would be a serious bug.

---

## Out of scope (do not implement)

- Real Module UIs.
- Owner team-management UI behind "Manage team".
- Workspace settings page.
- Mobile responsive collapse of the sidebar.
- E2E (Playwright) tests for the dashboard.
- Visual polish beyond reusing existing `.card`/`.btn` classes.
- Telemetry / analytics for nav clicks.
- Last-sign-in stat tile (no payload field exists for it).
