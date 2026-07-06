// Data Collection API client. The generate call is authed (same-origin cookie);
// the onboarding validate/import calls are public (token in the path). Error
// bodies are read defensively (the platform uses both `{error:'code'}` and
// `{error:{code}}` shapes across functions), so we key mainly off status.
import type { CommitResult, DryRunResult, GenerateResult, OnboardTenant } from './types';

export class OnboardApiError extends Error {
  constructor(public status: number, public code: string) {
    super(`${code} (${status})`);
  }
}

async function readErr(res: Response): Promise<string> {
  try {
    const body = await res.json();
    const e = (body as { error?: unknown }).error;
    if (typeof e === 'string') return e;
    if (e && typeof e === 'object' && 'code' in e) return String((e as { code: unknown }).code);
  } catch {
    /* fall through */
  }
  return 'error';
}

export async function generateOnboardingLink(): Promise<GenerateResult> {
  const res = await fetch('/api/onboard-generate', {
    method: 'POST',
    credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json' },
    body: '{}',
  });
  if (!res.ok) throw new OnboardApiError(res.status, await readErr(res));
  return res.json();
}

export async function validateOnboardToken(token: string): Promise<OnboardTenant> {
  const res = await fetch(`/api/onboard-public/${encodeURIComponent(token)}`, { credentials: 'same-origin' });
  if (!res.ok) throw new OnboardApiError(res.status, await readErr(res));
  return (await res.json()).tenant;
}

async function importFile<T>(token: string, file: File, dryRun: boolean): Promise<T> {
  const fd = new FormData();
  fd.append('file', file);
  fd.append('hp', ''); // honeypot — left empty by real users
  const url = `/api/onboard-import/${encodeURIComponent(token)}${dryRun ? '?dry_run=1' : ''}`;
  const res = await fetch(url, { method: 'POST', credentials: 'same-origin', body: fd });
  if (!res.ok) throw new OnboardApiError(res.status, await readErr(res));
  return res.json();
}

export const onboardDryRun = (token: string, file: File) => importFile<DryRunResult>(token, file, true);
export const onboardCommit = (token: string, file: File) => importFile<CommitResult>(token, file, false);
