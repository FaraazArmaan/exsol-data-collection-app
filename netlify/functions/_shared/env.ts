import { z } from 'zod';

const Schema = z.object({
  DATABASE_URL: z.string().min(1),
  GOOGLE_OAUTH_CLIENT_ID: z.string().min(1),
  JWT_SIGNING_SECRET: z.string().min(32),
  COOKIE_SECURE: z.string().transform((v) => v === 'true'),
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
});

export type Env = z.infer<typeof Schema>;

export function loadEnv(source: NodeJS.ProcessEnv | Record<string, string | undefined> = process.env): Env {
  const parsed = Schema.safeParse(source);
  if (!parsed.success) throw new Error(`env validation failed: ${parsed.error.message}`);
  return parsed.data;
}

let cached: Env | null = null;
export function env(): Env {
  if (!cached) cached = loadEnv();
  return cached;
}
