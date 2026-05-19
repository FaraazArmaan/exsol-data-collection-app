type RequiredEnv = 'NEON_DATABASE_URL' | 'JWT_SIGNING_SECRET';

type OptionalEnv =
  | 'TEST_DATABASE_URL'
  | 'GOOGLE_OAUTH_CLIENT_ID'
  | 'GOOGLE_OAUTH_CLIENT_SECRET'
  | 'GOOGLE_DRIVE_SERVICE_ACCOUNT_KEY'
  | 'GOOGLE_DRIVE_ROOT_FOLDER_ID'
  | 'RESEND_API_KEY'
  | 'RESEND_FROM_EMAIL'
  | 'ADMIN_GOOGLE_EMAIL'
  | 'APP_BASE_URL'
  | 'NODE_ENV';

export function req(name: RequiredEnv): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing required env var: ${name}`);
  return v;
}

export function opt(name: OptionalEnv): string | undefined {
  const v = process.env[name];
  return v && v.length > 0 ? v : undefined;
}
