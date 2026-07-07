// Throw-on-error Finance API layer (mirrors products/shared/api.ts).
// Auth travels in the httpOnly bucket-user cookie, so every call is a plain
// same-origin fetch — no bearer token, no client param (workspace-scoped).
import type {
  CashflowMonth, Expense, ExpenseInput, FinanceSummary,
  RecurringTemplate, RecurringInput, FinanceSettings, AiInsight, ReceiptPrefill,
} from './types';

export class FinanceApiError extends Error {
  constructor(public status: number, public code: string, public detail: unknown) {
    super(`${code} (${status})`);
  }
}

function safeJson(text: string): unknown {
  try { return JSON.parse(text); } catch { return null; }
}

async function jsonFetch<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, {
    credentials: 'same-origin',
    ...init,
    headers: { 'Content-Type': 'application/json', ...(init?.headers ?? {}) },
  });
  const text = await res.text();
  const body = text ? safeJson(text) : null;
  if (!res.ok) {
    const err = (body as { error?: { code?: string } } | null)?.error;
    throw new FinanceApiError(res.status, err?.code ?? 'http_error', body);
  }
  return body as T;
}

export const financeApi = {
  summary: (month: string): Promise<FinanceSummary> =>
    jsonFetch(`/api/finance/summary?month=${encodeURIComponent(month)}`),

  cashflow: (month: string): Promise<CashflowMonth> =>
    jsonFetch(`/api/finance/cashflow?month=${encodeURIComponent(month)}`),

  listExpenses: (month: string): Promise<{ expenses: Expense[] }> =>
    jsonFetch(`/api/finance/expenses?month=${encodeURIComponent(month)}`),

  createExpense: (body: ExpenseInput): Promise<Expense> =>
    jsonFetch('/api/finance/expenses', { method: 'POST', body: JSON.stringify(body) }),

  updateExpense: (id: string, body: Partial<ExpenseInput>): Promise<Expense> =>
    jsonFetch(`/api/finance/expense-detail/${id}`, { method: 'PATCH', body: JSON.stringify(body) }),

  removeExpense: (id: string): Promise<{ id: string; deleted: boolean }> =>
    jsonFetch(`/api/finance/expense-detail/${id}`, { method: 'DELETE' }),

  listRecurring: (): Promise<{ templates: RecurringTemplate[]; base_currency: string }> =>
    jsonFetch('/api/finance/recurring'),

  createRecurring: (body: RecurringInput): Promise<RecurringTemplate> =>
    jsonFetch('/api/finance/recurring', { method: 'POST', body: JSON.stringify(body) }),

  updateRecurring: (id: string, body: Partial<RecurringInput> & { active?: boolean }): Promise<RecurringTemplate> =>
    jsonFetch(`/api/finance/recurring-detail/${id}`, { method: 'PATCH', body: JSON.stringify(body) }),

  removeRecurring: (id: string): Promise<{ id: string; deleted: boolean }> =>
    jsonFetch(`/api/finance/recurring-detail/${id}`, { method: 'DELETE' }),

  runRecurring: (): Promise<{ materialized: number }> =>
    jsonFetch('/api/finance/recurring-run', { method: 'POST' }),

  listApprovals: (status: 'pending' | 'decided'): Promise<{ approvals: Expense[]; base_currency: string }> =>
    jsonFetch(`/api/finance/approvals?status=${status}`),

  decideApproval: (id: string, decision: 'approve' | 'reject', note?: string | null): Promise<{ id: string; approval_status: string }> =>
    jsonFetch(`/api/finance/approval-decide/${id}`, { method: 'POST', body: JSON.stringify({ decision, note: note ?? null }) }),

  getSettings: (): Promise<FinanceSettings> =>
    jsonFetch('/api/finance/settings'),

  putSettings: (approval_threshold_cents: number): Promise<{ approval_threshold_cents: number }> =>
    jsonFetch('/api/finance/settings', { method: 'PUT', body: JSON.stringify({ approval_threshold_cents }) }),

  aiInsights: (month: string): Promise<AiInsight> =>
    jsonFetch(`/api/finance/ai-insights?month=${encodeURIComponent(month)}`),

  regenerateInsights: (month: string): Promise<AiInsight> =>
    jsonFetch(`/api/finance/ai-insights?month=${encodeURIComponent(month)}`, { method: 'POST' }),

  ocrReceipt: (image_base64: string, media_type: string): Promise<{ prefill: ReceiptPrefill; is_fallback: boolean }> =>
    jsonFetch('/api/finance/ocr-receipt', { method: 'POST', body: JSON.stringify({ image_base64, media_type }) }),
};
