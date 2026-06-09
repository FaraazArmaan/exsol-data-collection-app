// Auth/tenancy scope for the Product Manager UI.
//
// Workspace mode: bucket-user JWT scopes the request; clientId comes from
//   useUserAuth().client. queryParam is undefined — API calls don't need
//   ?client=, the cookie is enough.
//
// Admin mode: admin session bypasses every permission key on the server.
//   clientId comes from the URL /clients/:clientId/.... API calls MUST send
//   ?client=<id> so the server knows which client's data to read.
//
// Components read scope ONLY through useProductsScope(). They do not read
// useUserAuth() / useAuth() directly.

import { createContext, useContext, useMemo, type ReactNode } from 'react';
import { useParams } from 'react-router-dom';
import { useUserAuth } from '../../user-portal/user-auth-context';
import { useAuth } from '../../../lib/auth-context';
import type { UserPortalPermissionMatrix } from '../../user-portal/api';

export interface ProductsScope {
  clientId: string;
  levelNumber: number | null;
  queryParam: string | undefined;     // appended as ?client=<id> when admin
  mode: 'workspace' | 'admin';
  permissions: UserPortalPermissionMatrix;
}

const Ctx = createContext<ProductsScope | null>(null);

export function useProductsScope(): ProductsScope {
  const v = useContext(Ctx);
  if (!v) throw new Error('useProductsScope used outside a ProductsScopeProvider');
  return v;
}

export function WorkspaceProductsScopeProvider({ children }: { children: ReactNode }) {
  const { user, client, permissions } = useUserAuth();
  const value = useMemo<ProductsScope | null>(() => {
    if (!user || !client) return null;
    return {
      clientId: client.id,
      levelNumber: user.level_number,
      queryParam: undefined,
      mode: 'workspace',
      permissions,
    };
  }, [user, client, permissions]);
  // Don't render children until auth is ready. UserDashboardLayout already
  // guards on loading upstream, so this is a defensive no-op in practice.
  if (!value) return null;
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function AdminProductsScopeProvider({ children }: { children: ReactNode }) {
  const { admin } = useAuth();
  const { clientId } = useParams<{ clientId: string }>();
  if (!clientId) throw new Error('AdminProductsScopeProvider requires :clientId URL param');
  const value = useMemo<ProductsScope | null>(() => {
    if (!admin) return null;
    return {
      clientId,
      levelNumber: 1,                       // synthesize L1 owner — bypasses client-side gates
      queryParam: clientId,                 // tells API client to send ?client=
      mode: 'admin',
      permissions: {} as UserPortalPermissionMatrix, // unused at L1 owner; kept to satisfy the type
    };
  }, [admin, clientId]);
  if (!value) return null;
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
