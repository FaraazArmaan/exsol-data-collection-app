import { apiFetch } from '../../lib/api-client';

export interface UserPortalUser {
  id: string;
  display_name: string;
  email: string | null;
  phone: string | null;
  notes: string | null;
  fields: Record<string, unknown>;
  level_number: number | null;
  role: { key: string; label: string; color: string };
  must_change_password: boolean;
  has_google: boolean;
}

export interface UserPortalClient {
  id: string;
  slug: string;
  name: string;
  timezone?: string;
}

export interface UserPortalEnabledModule {
  key: string;
  label: string;
}

export interface WorkforceMeEmployee {
  resource_id: string;
  user_node_id: string;
  legal_name: string;
  resource_name: string;
}

export interface WorkforceMePunch {
  id: string;
  punched_in_at: string;
  punched_out_at: string | null;
  late_minutes: number | null;
}

export interface WorkforceMeBreak {
  id: string;
  started_at: string;
  ended_at: string | null;
}

export interface WorkforceMeLocation {
  id: string;
  name: string;
  radius_meters: number;
  min_accuracy_meters: number;
}

export interface WorkforceMeTimeStatus {
  employee: WorkforceMeEmployee;
  open_punch: WorkforceMePunch | null;
  open_break: WorkforceMeBreak | null;
  locations: WorkforceMeLocation[];
  geofence_required: boolean;
  today_events: Array<{
    id: string;
    event_type: string;
    occurred_at: string;
    geofence_result: string | null;
    distance_meters: number | string | null;
  }>;
}

export interface WorkforceMeLeaveRequest {
  id: string;
  leave_type: string;
  start_date: string;
  end_date: string;
  notes: string | null;
  status: string;
  created_at: string;
}

export interface WorkforceMeLeaveBalance {
  leave_type: string;
  balance_days: number | string;
}

export interface WorkforceMeShift {
  id: string;
  weekday: number;
  start_time: string;
  end_time: string;
}

export interface WorkforceMeShiftSwap {
  id: string;
  offering_shift_id: string;
  offering_resource_id: string;
  offering_resource_name?: string;
  offering_date: string;
  claimed_by_resource_id: string | null;
  claimed_by_resource_name?: string | null;
  claimed_at: string | null;
  status: string;
  notes: string | null;
  created_at: string;
  is_mine?: boolean;
  claimed_by_me?: boolean;
}

export interface WorkforceMePayslip {
  id: string;
  gross_amount: number | string;
  tax_amount: number | string;
  deductions_amount: number | string;
  net_amount: number | string;
  currency: string;
  status: string;
  published_at: string | null;
  created_at: string;
  period_start: string;
  period_end: string;
}

export interface WorkforceMeTraining {
  course_id: string;
  name: string;
  description: string | null;
  is_required: boolean;
  expiry_days: number | null;
  completed_at: string | null;
  expires_at: string | null;
  cert_url: string | null;
}

export interface WorkforceMeAsset {
  assignment_id: string;
  assigned_at: string;
  returned_at: string | null;
  notes: string | null;
  asset_id: string;
  name: string;
  serial_number: string | null;
  condition: string;
}

export interface WorkforceMeTimeCorrection {
  id: string;
  correction_type: string;
  status: string;
  notes: string | null;
  created_at: string;
  reviewed_at: string | null;
}

export interface WorkforceMeComplianceTask {
  id: string;
  status: string;
  due_date: string | null;
  completed_at: string | null;
  notes: string | null;
  requirement_name: string | null;
  requirement_type: string | null;
}

export interface WorkforceMeDashboard {
  employee: WorkforceMeEmployee;
  leave_requests: WorkforceMeLeaveRequest[];
  leave_balances: WorkforceMeLeaveBalance[];
  shifts: WorkforceMeShift[];
  swaps: WorkforceMeShiftSwap[];
  payslips: WorkforceMePayslip[];
  training: WorkforceMeTraining[];
  assets: WorkforceMeAsset[];
  corrections: WorkforceMeTimeCorrection[];
  compliance_tasks: WorkforceMeComplianceTask[];
}

// PermissionMatrix is a flat map: 'module.bucket.verb' → true.
// Absent keys are denied.
export type UserPortalPermissionMatrix = Record<string, true>;

export const getClientBySlug = (slug: string) =>
  apiFetch<{ client: UserPortalClient }>(`/api/u-client-by-slug?slug=${encodeURIComponent(slug)}`);

export const userLogin = (slug: string, email: string, password: string) =>
  apiFetch<{ user: { id: string; email: string; must_change_password: boolean }; client: UserPortalClient }>(
    `/api/u-login?client=${encodeURIComponent(slug)}`,
    { method: 'POST', body: JSON.stringify({ email, password }) },
  );

export const userLogout = () => apiFetch<{ ok: true }>('/api/u-logout', { method: 'POST' });

export const userMe = () =>
  apiFetch<{
    user: UserPortalUser;
    client: UserPortalClient;
    permissions: UserPortalPermissionMatrix;
    enabled_modules: UserPortalEnabledModule[];
  }>('/api/u-me');

export const userLinkGoogle = (idToken: string) =>
  apiFetch<{ ok: true }>('/api/u-link-google', {
    method: 'POST', body: JSON.stringify({ idToken }),
  });

export const userUnlinkGoogle = () =>
  apiFetch<{ ok: true; already_unlinked?: true }>('/api/u-unlink-google', {
    method: 'POST',
  });

export const userChangePassword = (current_password: string, new_password: string) =>
  apiFetch<{ ok: true }>('/api/u-change-password', {
    method: 'POST', body: JSON.stringify({ current_password, new_password }),
  });

export const workforceMeTimeStatus = () =>
  apiFetch<WorkforceMeTimeStatus>('/api/workforce/me/time-status');

export const workforceMeClockIn = (location: { latitude: number; longitude: number; accuracy_meters: number }) =>
  apiFetch<{ punch: WorkforceMePunch }>('/api/workforce/me/clock-in', {
    method: 'POST',
    body: JSON.stringify(location),
  });

export const workforceMeClockOut = () =>
  apiFetch<{ punch: WorkforceMePunch }>('/api/workforce/me/clock-out', { method: 'POST' });

export const workforceMeStartBreak = () =>
  apiFetch<{ break: WorkforceMeBreak }>('/api/workforce/me/start-break', { method: 'POST' });

export const workforceMeEndBreak = () =>
  apiFetch<{ break: WorkforceMeBreak }>('/api/workforce/me/end-break', { method: 'POST' });

export const workforceMeDashboard = () =>
  apiFetch<WorkforceMeDashboard>('/api/workforce/me/dashboard');

export const workforceMeCreateLeaveRequest = (body: {
  leave_type: string;
  start_date: string;
  end_date: string;
  notes?: string;
}) =>
  apiFetch<{ request: WorkforceMeLeaveRequest }>('/api/workforce/me/leave-requests', {
    method: 'POST',
    body: JSON.stringify(body),
  });

export const workforceMeCancelLeaveRequest = (id: string) =>
  apiFetch<never>(`/api/workforce/me/leave-request/${encodeURIComponent(id)}`, { method: 'DELETE' });

export const workforceMeOfferShiftSwap = (body: { shift_id: string; offering_date: string; notes?: string }) =>
  apiFetch<{ swap: WorkforceMeShiftSwap }>('/api/workforce/me/shift-swaps', {
    method: 'POST',
    body: JSON.stringify(body),
  });

export const workforceMeActOnShiftSwap = (id: string, action: 'claim' | 'cancel') =>
  apiFetch<{ swap: WorkforceMeShiftSwap }>(`/api/workforce/me/shift-swap/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    body: JSON.stringify({ action }),
  });

export const workforceMeRequestTimeCorrection = (body: {
  correction_type: string;
  new_values?: Record<string, unknown>;
  notes?: string;
}) =>
  apiFetch<{ correction: WorkforceMeTimeCorrection }>('/api/workforce/me/time-correction', {
    method: 'POST',
    body: JSON.stringify(body),
  });
