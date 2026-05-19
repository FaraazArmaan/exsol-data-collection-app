import { neonConfig, Pool } from '@neondatabase/serverless';
import ws from 'ws';
import { opt, req } from './env.ts';

neonConfig.webSocketConstructor = ws;

export type DbClient = {
  query: (sql: string, params?: unknown[]) => Promise<{ rows: any[]; rowCount: number | null }>;
  release: () => void;
};

let _pool: Pool | null = null;

export function pool(): Pool {
  if (_pool) return _pool;
  const url = opt('TEST_DATABASE_URL') ?? req('NEON_DATABASE_URL');
  _pool = new Pool({ connectionString: url });
  return _pool;
}

export async function shutdown(): Promise<void> {
  if (_pool) {
    await _pool.end();
    _pool = null;
  }
}
