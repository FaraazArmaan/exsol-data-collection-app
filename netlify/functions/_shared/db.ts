import { neon, type NeonQueryFunction } from '@neondatabase/serverless';
import { env } from './env';

// Narrow the return type explicitly: neon(url) without options returns
// NeonQueryFunction<false, false> (row-objects, not arrays/full-results),
// but ReturnType<typeof neon> would widen to <boolean, boolean> and
// propagate that widening to every downstream type. Annotating the
// concrete shape here keeps callers narrowly typed and lets them
// declare SQL parameters as NeonQueryFunction<false, false>.
let cached: NeonQueryFunction<false, false> | null = null;
export function db(): NeonQueryFunction<false, false> {
  if (!cached) cached = neon(env().DATABASE_URL);
  return cached;
}
