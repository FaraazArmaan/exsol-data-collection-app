// Throw-on-error Finance API layer (mirrors products/shared/api.ts).
// Auth travels in the httpOnly bucket-user cookie, so every call is a plain
// same-origin fetch — no bearer token, no client param (workspace-scoped).
import type { Expense, ExpenseInput, FinanceSummary } from './types';

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

  listExpenses: (month: string): Promise<{ expenses: Expense[] }> =>
    jsonFetch(`/api/finance/expenses?month=${encodeURIComponent(month)}`),

  createExpense: (body: ExpenseInput): Promise<Expense> =>
    jsonFetch('/api/finance/expenses', { method: 'POST', body: JSON.stringify(body) }),

  updateExpense: (id: string, body: Partial<ExpenseInput>): Promise<Expense> =>
    jsonFetch(`/api/finance/expense-detail/${id}`, { method: 'PATCH', body: JSON.stringify(body) }),

  removeExpense: (id: string): Promise<{ id: string; deleted: boolean }> =>
    jsonFetch(`/api/finance/expense-detail/${id}`, { method: 'DELETE' }),
};
