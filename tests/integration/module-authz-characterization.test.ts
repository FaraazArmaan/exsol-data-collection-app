// Characterization tests for the _<module>-authz.ts family — pins the exact
// wire behavior of three representative modules BEFORE the makeModuleAuthz
// factory extraction (cleanup-2 theme T7):
//   finance   — plain skeleton, perm list imported from shared/permissions.ts
//   workforce — dual-module enable-gate (workforce OR project-service)
//   hr        — plain skeleton, distinct not-enabled code string
//
// Pinned byte-for-byte: 401 body, 412-vs-403 precedence (enable-gate fires
// BEFORE the permission check AND before the L1 Owner bypass), exact error
// code strings, 403 details.required, and the L1 bypass returning the FULL
// module perm set (iron rule 2).
import { describe, it, expect, beforeAll } from 'vitest';
import { neon } from '@neondatabase/serverless';
import {
  seedClientWithProductsEnabled, seedSubordinateUser, type PosTestCtx,
} from '../pos/_helpers';
import { requireFinance } from '../../netlify/functions/_finance-authz';
import { requireWorkforce } from '../../netlify/functions/_workforce-authz';
import { requireHr } from '../../netlify/functions/_hr-authz';
import { requireBooking } from '../../netlify/functions/_booking-authz';
import { requireCrm } from '../../netlify/functions/_crm-authz';
import { requireDataCollection } from '../../netlify/functions/_data-collection-authz';
import { requireEmail } from '../../netlify/functions/_email-authz';
import { requireInventory } from '../../netlify/functions/_inventory-authz';
import { requireManufacturing } from '../../netlify/functions/_manufacturing-authz';
import { requireMarketing } from '../../netlify/functions/_marketing-authz';
import { requireOrders } from '../../netlify/functions/_orders-authz';
import { requirePortfolio } from '../../netlify/functions/_portfolio-authz';
import { requireProcurement } from '../../netlify/functions/_procurement-authz';
import { requireWarehouse } from '../../netlify/functions/_warehouse-authz';
// Expected L1 full sets are INLINED literals on purpose — importing the same
// constants the wrappers use would make the assertion tautological (drift in
// the shared list would move test and implementation together).
const FINANCE_FULL = [
  'finance.business.view', 'finance.business.create',
  'finance.business.edit', 'finance.business.delete',
];
const HR_FULL = [
  'hr.employees.view', 'hr.employees.create',
  'hr.employees.edit', 'hr.employees.delete',
];

const sql = neon(process.env.DATABASE_URL!);

function req(cookie?: string): Request {
  const headers: Record<string, string> = {};
  if (cookie) headers['cookie'] = cookie;
  return new Request('http://localhost/api/characterization', { headers });
}

async function enableProduct(ctx: PosTestCtx, productKey: string): Promise<void> {
  await sql`
    INSERT INTO public.client_enabled_products (client_id, product_key, enabled_by_admin)
    VALUES (${ctx.clientId}, ${productKey}, ${ctx.adminId})
    ON CONFLICT (client_id, product_key) DO NOTHING
  `;
}

interface Case {
  name: 'finance' | 'workforce' | 'hr';
  require: (r: Request, required: readonly string[]) => Promise<
    { ok: true; ctx: { userNodeId: string; clientId: string; perms: ReadonlySet<string> } } | { ok: false; res: Response }
  >;
  productKey: string;
  notEnabledCode: string;
  viewKey: string;
  writeKey: string;
  fullSet: readonly string[];
}

const WORKFORCE_FULL = [
  'workforce.employees.view', 'workforce.employees.create', 'workforce.employees.edit', 'workforce.employees.delete',
  'workforce.leave.view', 'workforce.leave.create', 'workforce.leave.edit', 'workforce.leave.delete',
  'workforce.payroll.view', 'workforce.payroll.create', 'workforce.payroll.edit', 'workforce.payroll.delete',
  'workforce.assets.view', 'workforce.assets.create', 'workforce.assets.edit', 'workforce.assets.delete',
  'project-service.business.view', 'project-service.business.create',
  'project-service.business.edit', 'project-service.business.delete',
  'project-service.customers.view',
];

const CASES: Case[] = [
  {
    name: 'finance', require: requireFinance, productKey: 'finance',
    notEnabledCode: 'finance_module_not_enabled',
    viewKey: 'finance.business.view', writeKey: 'finance.business.delete',
    fullSet: FINANCE_FULL,
  },
  {
    name: 'workforce', require: requireWorkforce, productKey: 'workforce',
    notEnabledCode: 'workforce_module_not_enabled',
    viewKey: 'workforce.employees.view', writeKey: 'workforce.assets.delete',
    fullSet: WORKFORCE_FULL,
  },
  {
    name: 'hr', require: requireHr, productKey: 'hr',
    notEnabledCode: 'hr_module_not_enabled',
    viewKey: 'hr.employees.view', writeKey: 'hr.employees.delete',
    fullSet: HR_FULL,
  },
];

for (const c of CASES) {
  describe(`_${c.name}-authz characterization`, () => {
    // Two clients: one with the module DISABLED, one ENABLED.
    let disabled: PosTestCtx;      // L1 owner, module never enabled
    let disabledL2: PosTestCtx;    // L2 in the same client, no grants
    let enabled: PosTestCtx;       // L1 owner, module enabled, EMPTY matrix
    let enabledL2None: PosTestCtx; // L2, no grants
    let enabledL3View: PosTestCtx; // L2, view key granted

    beforeAll(async () => {
      disabled = await seedClientWithProductsEnabled();
      disabledL2 = await seedSubordinateUser(disabled, 2, []);
      enabled = await seedClientWithProductsEnabled();
      await enableProduct(enabled, c.productKey);
      enabledL2None = await seedSubordinateUser(enabled, 2, []);
      // L3 chains under the L2 node (a DB trigger enforces child level =
      // parent level + 1) — its OWN client_levels row carries just viewKey.
      enabledL3View = await seedSubordinateUser(enabledL2None, 3, [c.viewKey]);
    });

    it('401 unauthorized without a session (exact body)', async () => {
      const a = await c.require(req(), [c.viewKey]);
      expect(a.ok).toBe(false);
      if (a.ok) return;
      expect(a.res.status).toBe(401);
      const body = await a.res.json();
      expect(body).toEqual({ error: { code: 'unauthorized', message: 'unauthorized' } });
    });

    it(`412 ${c.notEnabledCode} for an L2 who ALSO lacks the perm (enable-gate wins over 403)`, async () => {
      const a = await c.require(req(disabledL2.cookie), [c.viewKey]);
      expect(a.ok).toBe(false);
      if (a.ok) return;
      expect(a.res.status).toBe(412);
      const body = await a.res.json();
      expect(body).toEqual({ error: { code: c.notEnabledCode, message: c.notEnabledCode } });
    });

    it('412 even for the L1 Owner (enable-gate wins over the Owner bypass)', async () => {
      const a = await c.require(req(disabled.cookie), [c.viewKey]);
      expect(a.ok).toBe(false);
      if (a.ok) return;
      expect(a.res.status).toBe(412);
      expect((await a.res.json()).error.code).toBe(c.notEnabledCode);
    });

    it('403 missing_permission with details.required for an L2 without the grant', async () => {
      const a = await c.require(req(enabledL2None.cookie), [c.viewKey]);
      expect(a.ok).toBe(false);
      if (a.ok) return;
      expect(a.res.status).toBe(403);
      const body = await a.res.json();
      expect(body).toEqual({
        error: { code: 'missing_permission', message: 'missing_permission', details: { required: c.viewKey } },
      });
    });

    it('ok for a non-Owner WITH the grant (L3 node); ctx carries exactly the granted keys', async () => {
      const a = await c.require(req(enabledL3View.cookie), [c.viewKey]);
      expect(a.ok).toBe(true);
      if (!a.ok) return;
      expect(a.ctx.clientId).toBe(enabled.clientId);
      expect(a.ctx.userNodeId).toBe(enabledL3View.userNodeId);
      expect([...a.ctx.perms]).toEqual([c.viewKey]);
    });

    it('L1 Owner with an EMPTY matrix passes ANY required key and gets the FULL perm set', async () => {
      const a = await c.require(req(enabled.cookie), [c.writeKey]);
      expect(a.ok).toBe(true);
      if (!a.ok) return;
      expect([...a.ctx.perms].sort()).toEqual([...c.fullSet].sort());
    });
  });
}

// Wire-code pin for EVERY wrapper (hostile-review R2): one client with NO
// products enabled at all — the seed helper enables products+pos by default,
// and the pos product carries the email module (email rides pos), so the
// seeded enablements are deleted to make all 14 modules unreachable. Each
// require must then 412 with ITS exact per-module code string.
describe('all module-authz wrappers return their exact 412 code', () => {
  type RequireFn = (r: Request, required: readonly string[]) => Promise<
    { ok: true } | { ok: false; res: Response }
  >;
  const WRAPPERS: Array<[string, RequireFn, string]> = [
    ['booking', requireBooking, 'booking_module_not_enabled'],
    ['crm', requireCrm, 'crm_module_not_enabled'],
    ['data-collection', requireDataCollection, 'data_collection_module_not_enabled'],
    ['email', requireEmail, 'email_module_not_enabled'],
    ['finance', requireFinance, 'finance_module_not_enabled'],
    ['hr', requireHr, 'hr_module_not_enabled'],
    ['inventory', requireInventory, 'inventory_module_not_enabled'],
    ['manufacturing', requireManufacturing, 'manufacturing_module_not_enabled'],
    ['marketing', requireMarketing, 'marketing_module_not_enabled'],
    ['orders', requireOrders, 'orders_module_not_enabled'],
    ['portfolio', requirePortfolio, 'portfolio_module_not_enabled'],
    ['procurement', requireProcurement, 'procurement_module_not_enabled'],
    ['warehouse', requireWarehouse, 'warehouse_module_not_enabled'],
    ['workforce', requireWorkforce, 'workforce_module_not_enabled'],
  ];

  let bare: PosTestCtx;
  beforeAll(async () => {
    bare = await seedClientWithProductsEnabled();
    await sql`DELETE FROM public.client_enabled_products WHERE client_id = ${bare.clientId}`;
  });

  for (const [name, fn, code] of WRAPPERS) {
    it(`${name}: 412 ${code}`, async () => {
      const a = await fn(req(bare.cookie), []);
      expect(a.ok).toBe(false);
      if (a.ok) return;
      expect(a.res.status).toBe(412);
      expect((await a.res.json()).error.code).toBe(code);
    });
  }
});
