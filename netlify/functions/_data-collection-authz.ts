// DataCollection authorization — thin wrapper over the shared module-authz factory.
// Gate order (401 session -> 412 enable-gate -> L1 Owner bypass -> 403 matrix)
// lives in _shared/module-authz.ts (iron rule 2, enforced structurally).
import { makeModuleAuthz, type ModuleAuthCtx } from './_shared/module-authz';

export const ALL_DATA_COLLECTION_PERMS = [
  'data-collection.products.view', 'data-collection.products.create',
  'data-collection.products.edit', 'data-collection.products.delete',
] as const;

export type DataCollectionAuthCtx = ModuleAuthCtx;

export const requireDataCollection = makeModuleAuthz({
  moduleKeys: ['data-collection'],
  notEnabledCode: 'data_collection_module_not_enabled',
  allPerms: ALL_DATA_COLLECTION_PERMS,
});
