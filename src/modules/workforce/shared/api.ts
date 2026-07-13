// Workforce module FE API wrappers. Throwing style — mirrors booking/api.ts.
// All errors surface as WorkforceApiError with a typed .code so components can
// branch on specific failure codes (e.g. 'resource_not_found').

export class WorkforceApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    public readonly details?: unknown,
  ) {
    super(code);
    this.name = 'WorkforceApiError';
  }
}

async function call<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, { credentials: 'include', ...init });
  if (!res.ok) {
    let code = 'unknown';
    let details: unknown;
    try {
      const body = await res.json();
      code = body?.error?.code ?? code;
      details = body?.error?.details;
    } catch { /* noop */ }
    throw new WorkforceApiError(res.status, code, details);
  }
  if (res.status === 204) return undefined as T;
  return res.json() as Promise<T>;
}

const json = (body: unknown): RequestInit => ({
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(body),
});

// ---------- Types ----------

export interface StaffResource {
  id: string;
  name: string;
  active: boolean;
  team_members: TeamMember[];
}

export interface TeamMember {
  id: string;
  display_name: string;
  email: string | null;
  level_number: number | null;
  level_label: string | null;
  role_label: string | null;
  has_login: boolean;
  login_disabled: boolean;
}

export interface Shift {
  id: string;
  resource_id: string;
  resource_name?: string;
  user_node_id: string | null;
  user_display_name?: string | null;
  weekday: number;
  start_time: string;
  end_time: string;
}

export type ProjectStatus = 'quoted' | 'active' | 'done';

export interface Project {
  id: string;
  name: string;
  status: ProjectStatus;
  customer_id: string | null;
  customer_name: string | null;
  created_at: string;
  updated_at: string;
}

export interface ProjectAssignment {
  resource_id: string;
  resource_name: string;
  assigned_at: string;
}

export interface ProjectBudget {
  budget_cents: number | null;
  hourly_rate_cents: number | null;
  total_hours: number;
  timesheet_cost_cents: number;
  expense_cents: number;
  total_spent_cents: number;
  burn_pct: number | null;
  expense_count: number;
}

export interface ProjectDoc {
  file_id: string;
  attached_at: string;
  title: string;
  type: string;
  storage_kind: string;
  filename: string | null;
  mime: string | null;
  byte_size: number | null;
  external_url: string | null;
  tier: string;
  file_created_at: string;
}

export interface ProjectTask {
  id: string;
  project_id: string;
  title: string;
  description: string | null;
  assigned_to: string | null;
  assigned_name: string | null;
  status: 'open' | 'in_progress' | 'done';
  due_date: string | null;
  created_at: string;
  updated_at: string;
}

export interface ProjectRisk {
  project_id: string;
  project_name: string;
  project_status: string;
  health_score: number;
  flags: string[];
  overdue_count: number;
  open_count: number;
  total_tasks: number;
  assignment_count: number;
  unstaffed: boolean;
  budget_overrun: boolean;
  burn_pct: number | null;
  total_hours: number;
}

export interface AiDraftTask {
  title: string;
  description: string | null;
  due_date: string | null;
}

export interface AiPlan {
  id: string;
  project_id: string;
  prompt_text: string;
  draft_tasks: AiDraftTask[];
  created_at: string;
  fallback?: boolean;
}

export interface TimesheetEntry {
  id: string;
  resource_id: string;
  resource_name?: string;
  user_node_id: string | null;
  user_display_name?: string | null;
  entry_date: string;
  start_time: string;
  end_time: string;
  notes: string | null;
  approved_by: string | null;
  approved_at: string | null;
  created_at: string;
}

export interface LeaveRequest {
  id: string;
  resource_id: string;
  resource_name?: string;
  user_node_id: string | null;
  leave_type: string;
  start_date: string;
  end_date: string;
  notes: string | null;
  status: 'pending' | 'approved' | 'denied';
  handled_by: string | null;
  handled_at: string | null;
  created_at: string;
}

export interface LeaveBalance {
  id: string;
  resource_id: string;
  leave_type: string;
  balance_days: number;
}

export interface ComplianceReport {
  resource_id: string;
  date: string;
  total_hours: number;
  max_hours_exceeded: boolean;
  missing_break: boolean;
  entry_count: number;
}

export interface Punch {
  id: string;
  resource_id: string;
  user_node_id: string | null;
  shift_id: string | null;
  punched_in_at: string;
  punched_out_at: string | null;
  late_minutes: number | null;
  is_absent: boolean;
  notes: string | null;
  created_at: string;
}

export interface OvertimeEntry {
  id: string;
  resource_id: string;
  resource_name?: string;
  user_node_id: string | null;
  punch_id: string | null;
  ot_date: string;
  ot_hours: number;
  reason: string | null;
  status: 'pending' | 'approved' | 'denied';
  handled_by: string | null;
  handled_at: string | null;
  created_at: string;
}

export interface ShiftSwap {
  id: string;
  offering_shift_id: string;
  offering_resource_id: string;
  offering_resource_name?: string;
  offering_date: string;
  claimed_by_resource_id: string | null;
  claimed_by_resource_name?: string | null;
  claimed_at: string | null;
  status: 'open' | 'claimed' | 'approved' | 'denied' | 'cancelled';
  notes: string | null;
  handled_by: string | null;
  handled_at: string | null;
  created_at: string;
}

export interface PayrollRate {
  id: string;
  user_node_id: string;
  hourly_rate: number;
  effective_from: string;
  notes: string | null;
  created_at: string;
}

export interface PayrollPeriod {
  id: string;
  period_start: string;
  period_end: string;
  status: 'draft' | 'approved';
  total_amount: number | null;
  created_by: string | null;
  approved_by: string | null;
  approved_at: string | null;
  created_at: string;
}

export interface PayrollLineItem {
  user_node_id: string;
  hours: number;
  hourly_rate: number;
  amount: number;
}

export interface TrainingCourse {
  id: string;
  name: string;
  description: string | null;
  is_required: boolean;
  expiry_days: number | null;
  created_at: string;
}

export interface TrainingCompletion {
  id: string;
  course_id: string;
  course_name?: string;
  resource_id: string;
  resource_name?: string;
  user_node_id: string | null;
  completed_at: string;
  expires_at: string | null;
  cert_url: string | null;
  notes: string | null;
  expiry_status: 'valid' | 'expiring_soon' | 'expired';
  created_at: string;
}

export interface WorkforceAsset {
  id: string;
  name: string;
  description: string | null;
  serial_number: string | null;
  condition: 'good' | 'fair' | 'poor' | 'retired';
  current_assignment_id: string | null;
  current_assignee_user_node_id: string | null;
  assigned_at: string | null;
  created_at: string;
}

export interface AssetAssignment {
  id: string;
  asset_id: string;
  asset_name?: string;
  user_node_id: string;
  assigned_at: string;
  returned_at: string | null;
  condition_at_return: string | null;
  notes: string | null;
}

export interface EmployeeProfile {
  resource: { id: string; name: string };
  this_week: {
    shifts: number;
    punches: number;
    hours_worked: number;
    ot_hours: number;
    on_leave: boolean;
  };
  leave: {
    pending: number;
    approved_this_month: number;
    balances: Array<{ leave_type: string; balance_days: number }>;
  };
  training: { completed: number; expiring_soon: number; expired: number };
  assets: {
    active_count: number;
    items: Array<{ id: string; asset_name: string; condition: string; assigned_at: string }>;
  };
}

export type EmploymentStatus = 'active' | 'on_leave' | 'terminated';
export type EmploymentType = 'full_time' | 'part_time' | 'contractor' | 'intern';

export interface EmployeeMasterProfile {
  id: string;
  client_id: string;
  resource_id: string;
  resource_name?: string;
  user_node_id: string | null;
  employee_number: string | null;
  legal_name: string;
  preferred_name: string | null;
  employment_status: EmploymentStatus;
  employment_type: EmploymentType;
  job_title: string | null;
  department: string | null;
  hire_date: string | null;
  termination_date: string | null;
  manager_user_node_id: string | null;
  primary_email: string | null;
  primary_phone: string | null;
  emergency_contact: Record<string, unknown>;
  custom_fields: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

export interface SchedulePlanRow {
  resource_id: string;
  resource_name: string;
  shift_count: number;
  scheduled_hours: number | string;
  rule_id: string | null;
  rule_name: string | null;
  max_daily_hours: number | string | null;
  max_daily_hours_exceeded: boolean;
}

export interface ScheduleFinding {
  id: string;
  resource_id: string;
  finding_type: string;
  severity: 'info' | 'warning' | 'blocker';
  status: 'open' | 'waived' | 'resolved';
  details: Record<string, unknown>;
  created_at: string;
}

export interface ComplianceRule {
  id: string;
  name: string;
  max_daily_hours: number | string | null;
  max_weekly_hours: number | string | null;
  break_required_after_hours: number | string | null;
  min_break_minutes: number | null;
  effective_from: string;
  active: boolean;
}

export interface TimeClockEvent {
  id: string;
  resource_id: string;
  user_node_id: string | null;
  punch_id: string | null;
  event_type: 'clock_in' | 'clock_out' | 'break_start' | 'break_end' | 'correction' | 'absence' | 'note';
  occurred_at: string;
  source: 'manual' | 'kiosk' | 'mobile' | 'self_service' | 'system' | 'import';
  notes: string | null;
  metadata: Record<string, unknown>;
  recorded_by: string | null;
  created_at: string;
}

export interface TimeCorrection {
  id: string;
  punch_id: string | null;
  resource_id: string;
  requested_by: string | null;
  correction_type: 'missed_clock_in' | 'missed_clock_out' | 'edit_time' | 'delete_punch';
  original_values: Record<string, unknown>;
  new_values: Record<string, unknown>;
  status: 'pending' | 'approved' | 'denied';
  reviewed_by: string | null;
  reviewed_at: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

export interface PayrollExport {
  id: string;
  period_id: string;
  export_format: 'csv' | 'json' | 'provider';
  status: 'draft' | 'generated' | 'sent' | 'void';
  total_amount: number | string;
  exported_by: string | null;
  exported_at: string | null;
  file_id: string | null;
  metadata: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

export interface Payslip {
  id: string;
  export_id: string | null;
  period_id: string;
  user_node_id: string;
  gross_amount: number | string;
  tax_amount: number | string;
  deductions_amount: number | string;
  net_amount: number | string;
  currency: string;
  status: 'draft' | 'published' | 'void';
  published_at: string | null;
  metadata: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

export interface ComplianceRequirement {
  id: string;
  requirement_type: 'training' | 'asset';
  name: string;
  description: string | null;
  course_id: string | null;
  asset_id: string | null;
  required_for_employment_type: EmploymentType | null;
  due_within_days: number | null;
  recurrence_days: number | null;
  active: boolean;
  created_at: string;
  updated_at: string;
}

export interface AssetMaintenance {
  id: string;
  asset_id: string;
  scheduled_for: string;
  completed_at: string | null;
  status: 'scheduled' | 'completed' | 'cancelled' | 'overdue';
  notes: string | null;
  performed_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface ComplianceTask {
  id: string;
  requirement_id: string | null;
  resource_id: string;
  user_node_id: string | null;
  status: 'pending' | 'completed' | 'waived' | 'overdue';
  due_date: string | null;
  completed_at: string | null;
  source_type: 'training_completion' | 'asset_assignment' | 'asset_maintenance' | 'manual' | null;
  source_id: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

export interface WorkLocation {
  id: string;
  client_id: string;
  name: string;
  latitude: string | number;
  longitude: string | number;
  radius_meters: number;
  min_accuracy_meters: number;
  active: boolean;
  assignments: Array<{
    id: string;
    applies_to_all: boolean;
    resource_id: string | null;
    user_node_id: string | null;
    active: boolean;
  }>;
  created_at: string;
  updated_at: string;
}

// ---------- API ----------

export const workforceApi = {
  listStaff(): Promise<{ resources: StaffResource[] }> {
    return call('/api/workforce/staff');
  },

  listShifts(resourceId?: string): Promise<{ shifts: Shift[] }> {
    const q = resourceId ? `?resource_id=${resourceId}` : '';
    return call(`/api/workforce/shifts${q}`);
  },

  createShift(data: {
    resource_id: string;
    user_node_id?: string | null;
    weekday: number;
    start_time: string;
    end_time: string;
  }): Promise<{ shift: Shift }> {
    return call('/api/workforce/shifts', json(data));
  },

  deleteShift(id: string): Promise<void> {
    return call(`/api/workforce/shift/${id}`, { method: 'DELETE' });
  },

  listProjects(status?: string): Promise<{ projects: Project[] }> {
    const q = status ? `?status=${status}` : '';
    return call(`/api/workforce/projects${q}`);
  },

  createProject(data: { name: string; customer_id?: string | null }): Promise<{ project: Project }> {
    return call('/api/workforce/projects', json(data));
  },

  getProject(id: string): Promise<{ project: Project; assignments: ProjectAssignment[] }> {
    return call(`/api/workforce/project/${id}`);
  },

  advanceStatus(id: string, status: ProjectStatus): Promise<{ project: Project }> {
    return call(`/api/workforce/project/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status }),
    });
  },

  assignResource(projectId: string, resourceId: string): Promise<{ assigned: boolean }> {
    return call('/api/workforce/project-assignments', json({ project_id: projectId, resource_id: resourceId }));
  },

  unassignResource(projectId: string, resourceId: string): Promise<void> {
    return call('/api/workforce/project-assignments', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ project_id: projectId, resource_id: resourceId }),
    });
  },

  getProjectBudget(id: string): Promise<{ budget: ProjectBudget }> {
    return call<{ budget: ProjectBudget }>(`/api/workforce/project-budget/${id}`);
  },

  setProjectBudget(
    id: string,
    data: { budget_cents?: number | null; hourly_rate_cents?: number | null },
  ): Promise<{ project: Project }> {
    return call<{ project: Project }>(`/api/workforce/project-budget/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    });
  },

  listProjectDocs: (project_id: string) =>
    call<{ docs: ProjectDoc[] }>(`/api/workforce/project-docs?project_id=${project_id}`),

  linkProjectDoc: (project_id: string, file_id: string) =>
    call<{ linked: boolean }>('/api/workforce/project-docs', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ project_id, file_id }),
    }),

  unlinkProjectDoc: (project_id: string, file_id: string) =>
    call<void>('/api/workforce/project-docs', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ project_id, file_id }),
    }),

  listProjectTasks: (project_id: string, status?: string) =>
    call<{ tasks: ProjectTask[] }>(`/api/workforce/project-tasks?project_id=${project_id}${status ? `&status=${status}` : ''}`),

  createProjectTask: (data: { project_id: string; title: string; description?: string | null; assigned_to?: string | null; due_date?: string | null; status?: string }) =>
    call<{ task: ProjectTask }>('/api/workforce/project-tasks', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) }),

  updateProjectTask: (id: string, data: Partial<Pick<ProjectTask, 'title' | 'description' | 'assigned_to' | 'due_date' | 'status'>>) =>
    call<{ task: ProjectTask }>(`/api/workforce/project-task/${id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) }),

  deleteProjectTask: (id: string) =>
    call<void>(`/api/workforce/project-task/${id}`, { method: 'DELETE' }),

  getProjectRisk: (id: string) =>
    call<{ risk: ProjectRisk }>(`/api/workforce/project-risk/${id}`),

  listTimesheets(params?: { resource_id?: string; from?: string; to?: string }): Promise<{ entries: TimesheetEntry[] }> {
    const q = new URLSearchParams();
    if (params?.resource_id) q.set('resource_id', params.resource_id);
    if (params?.from) q.set('from', params.from);
    if (params?.to) q.set('to', params.to);
    const qs = q.toString() ? `?${q.toString()}` : '';
    return call(`/api/workforce/timesheets${qs}`);
  },

  logTimesheet(data: {
    resource_id: string;
    user_node_id?: string | null;
    entry_date: string;
    start_time: string;
    end_time: string;
    notes?: string;
  }): Promise<{ entry: TimesheetEntry }> {
    return call('/api/workforce/timesheets', json(data));
  },

  updateTimesheet(
    id: string,
    data: { start_time?: string; end_time?: string; notes?: string; approve?: boolean },
  ): Promise<{ entry: TimesheetEntry }> {
    return call(`/api/workforce/timesheet/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    });
  },

  deleteTimesheet(id: string): Promise<void> {
    return call(`/api/workforce/timesheet/${id}`, { method: 'DELETE' });
  },

  listLeaves(params?: { resource_id?: string; status?: string; from?: string; to?: string }): Promise<{ requests: LeaveRequest[]; balances: LeaveBalance[] }> {
    const q = new URLSearchParams();
    if (params?.resource_id) q.set('resource_id', params.resource_id);
    if (params?.status) q.set('status', params.status);
    if (params?.from) q.set('from', params.from);
    if (params?.to) q.set('to', params.to);
    return call(`/api/workforce/leaves?${q}`);
  },

  createLeave(data: { resource_id: string; user_node_id?: string | null; leave_type: string; start_date: string; end_date: string; notes?: string }): Promise<{ request: LeaveRequest }> {
    return call('/api/workforce/leaves', { method: 'POST', body: JSON.stringify(data) });
  },

  handleLeave(id: string, action: 'approve' | 'deny'): Promise<{ request: LeaveRequest }> {
    return call(`/api/workforce/leave/${id}`, { method: 'PATCH', body: JSON.stringify({ action }) });
  },

  deleteLeave(id: string): Promise<void> {
    return call(`/api/workforce/leave/${id}`, { method: 'DELETE' });
  },

  getCompliance(resource_id: string, date: string): Promise<ComplianceReport> {
    return call(`/api/workforce/compliance?resource_id=${resource_id}&date=${date}`);
  },

  listPunches(params?: { resource_id?: string; from?: string; to?: string }): Promise<{ punches: Punch[] }> {
    const q = new URLSearchParams();
    if (params?.resource_id) q.set('resource_id', params.resource_id);
    if (params?.from) q.set('from', params.from);
    if (params?.to) q.set('to', params.to);
    return call<{ punches: Punch[] }>(`/api/workforce/punches?${q}`);
  },

  clockIn(data: { resource_id: string; user_node_id?: string | null; notes?: string }): Promise<{ punch: Punch }> {
    return call<{ punch: Punch }>('/api/workforce/punches', { method: 'POST', body: JSON.stringify(data) });
  },

  clockOut(id: string): Promise<{ punch: Punch }> {
    return call<{ punch: Punch }>(`/api/workforce/punch/${id}`, { method: 'PATCH', body: JSON.stringify({}) });
  },

  deletePunch(id: string): Promise<void> {
    return call<void>(`/api/workforce/punch/${id}`, { method: 'DELETE' });
  },

  listOvertime(params?: { resource_id?: string; status?: string; from?: string; to?: string }): Promise<{ entries: OvertimeEntry[] }> {
    const q = new URLSearchParams();
    if (params?.resource_id) q.set('resource_id', params.resource_id);
    if (params?.status) q.set('status', params.status);
    if (params?.from) q.set('from', params.from);
    if (params?.to) q.set('to', params.to);
    return call<{ entries: OvertimeEntry[] }>(`/api/workforce/overtime?${q}`);
  },

  logOvertime(data: { resource_id: string; user_node_id?: string | null; punch_id?: string | null; ot_date: string; ot_hours: number; reason?: string }): Promise<{ entry: OvertimeEntry }> {
    return call<{ entry: OvertimeEntry }>('/api/workforce/overtime', { method: 'POST', body: JSON.stringify(data) });
  },

  handleOvertime(id: string, action: 'approve' | 'deny'): Promise<{ entry: OvertimeEntry }> {
    return call<{ entry: OvertimeEntry }>(`/api/workforce/overtime/${id}`, { method: 'PATCH', body: JSON.stringify({ action }) });
  },

  deleteOvertime(id: string): Promise<void> {
    return call<void>(`/api/workforce/overtime/${id}`, { method: 'DELETE' });
  },

  listSwaps(params?: { status?: string; resource_id?: string }): Promise<{ swaps: ShiftSwap[] }> {
    const q = new URLSearchParams();
    if (params?.status) q.set('status', params.status);
    if (params?.resource_id) q.set('resource_id', params.resource_id);
    return call<{ swaps: ShiftSwap[] }>(`/api/workforce/swaps?${q}`);
  },

  offerSwap(data: { shift_id: string; offering_date: string; notes?: string }): Promise<{ swap: ShiftSwap }> {
    return call<{ swap: ShiftSwap }>('/api/workforce/swaps', { method: 'POST', body: JSON.stringify(data) });
  },

  actionSwap(id: string, action: string, resource_id?: string): Promise<{ swap: ShiftSwap }> {
    return call<{ swap: ShiftSwap }>(`/api/workforce/swap/${id}`, {
      method: 'PATCH',
      body: JSON.stringify({ action, resource_id }),
    });
  },

  deleteSwap(id: string): Promise<void> {
    return call<void>(`/api/workforce/swap/${id}`, { method: 'DELETE' });
  },

  listPayrollPeriods(params?: { status?: string }): Promise<{ periods: PayrollPeriod[] }> {
    const q = new URLSearchParams();
    if (params?.status) q.set('status', params.status);
    return call<{ periods: PayrollPeriod[] }>(`/api/workforce/payroll?${q}`);
  },

  createPayrollPeriod(data: { period_start: string; period_end: string }): Promise<{ period: PayrollPeriod }> {
    return call<{ period: PayrollPeriod }>('/api/workforce/payroll', { method: 'POST', body: JSON.stringify(data) });
  },

  getPayrollPeriod(id: string): Promise<{ period: PayrollPeriod; line_items: PayrollLineItem[] }> {
    return call<{ period: PayrollPeriod; line_items: PayrollLineItem[] }>(`/api/workforce/payroll/${id}`);
  },

  approvePayrollPeriod(id: string): Promise<{ period: PayrollPeriod }> {
    return call<{ period: PayrollPeriod }>(`/api/workforce/payroll/${id}`, { method: 'PATCH', body: JSON.stringify({ action: 'approve' }) });
  },

  deletePayrollPeriod(id: string): Promise<void> {
    return call<void>(`/api/workforce/payroll/${id}`, { method: 'DELETE' });
  },

  listPayrollRates(params?: { user_node_id?: string }): Promise<{ rates: PayrollRate[] }> {
    const q = new URLSearchParams();
    if (params?.user_node_id) q.set('user_node_id', params.user_node_id);
    return call<{ rates: PayrollRate[] }>(`/api/workforce/payroll-rates?${q}`);
  },

  setPayrollRate(data: { user_node_id: string; hourly_rate: number; effective_from: string; notes?: string }): Promise<{ rate: PayrollRate }> {
    return call<{ rate: PayrollRate }>('/api/workforce/payroll-rates', { method: 'POST', body: JSON.stringify(data) });
  },

  listPayrollExports(period_id?: string): Promise<{ exports: PayrollExport[]; payslips: Payslip[] }> {
    const q = period_id ? `?period_id=${period_id}` : '';
    return call<{ exports: PayrollExport[]; payslips: Payslip[] }>(`/api/workforce/payroll-export${q}`);
  },

  generatePayrollExport(data: { period_id: string; export_format?: PayrollExport['export_format']; metadata?: Record<string, unknown> }): Promise<{ export: PayrollExport; payslips: Payslip[] }> {
    return call<{ export: PayrollExport; payslips: Payslip[] }>('/api/workforce/payroll-export', json(data));
  },

  listTrainingCourses(): Promise<{ courses: TrainingCourse[] }> {
    return call<{ courses: TrainingCourse[] }>('/api/workforce/training-courses');
  },

  createTrainingCourse(data: { name: string; description?: string; is_required?: boolean; expiry_days?: number }): Promise<{ course: TrainingCourse }> {
    return call<{ course: TrainingCourse }>('/api/workforce/training-courses', { method: 'POST', body: JSON.stringify(data) });
  },

  updateTrainingCourse(id: string, data: Partial<Pick<TrainingCourse, 'name' | 'description' | 'is_required' | 'expiry_days'>>): Promise<{ course: TrainingCourse }> {
    return call<{ course: TrainingCourse }>(`/api/workforce/training-course/${id}`, { method: 'PATCH', body: JSON.stringify(data) });
  },

  deleteTrainingCourse(id: string): Promise<void> {
    return call<void>(`/api/workforce/training-course/${id}`, { method: 'DELETE' });
  },

  listCompletions(params?: { resource_id?: string; course_id?: string; expiring_soon?: boolean }): Promise<{ completions: TrainingCompletion[] }> {
    const q = new URLSearchParams();
    if (params?.resource_id) q.set('resource_id', params.resource_id);
    if (params?.course_id) q.set('course_id', params.course_id);
    if (params?.expiring_soon) q.set('expiring_soon', 'true');
    return call<{ completions: TrainingCompletion[] }>(`/api/workforce/training-completions?${q}`);
  },

  logCompletion(data: { course_id: string; resource_id: string; user_node_id?: string | null; completed_at: string; cert_url?: string; notes?: string }): Promise<{ completion: TrainingCompletion }> {
    return call<{ completion: TrainingCompletion }>('/api/workforce/training-completions', { method: 'POST', body: JSON.stringify(data) });
  },

  listAssets(params?: { condition?: string }): Promise<{ assets: WorkforceAsset[] }> {
    const q = new URLSearchParams();
    if (params?.condition) q.set('condition', params.condition);
    return call<{ assets: WorkforceAsset[] }>(`/api/workforce/assets?${q}`);
  },

  createAsset(data: { name: string; description?: string; serial_number?: string; condition?: string }): Promise<{ asset: WorkforceAsset }> {
    return call<{ asset: WorkforceAsset }>('/api/workforce/assets', { method: 'POST', body: JSON.stringify(data) });
  },

  updateAsset(id: string, data: Partial<Pick<WorkforceAsset, 'name' | 'description' | 'serial_number' | 'condition'>>): Promise<{ asset: WorkforceAsset }> {
    return call<{ asset: WorkforceAsset }>(`/api/workforce/asset/${id}`, { method: 'PATCH', body: JSON.stringify(data) });
  },

  retireAsset(id: string): Promise<void> {
    return call<void>(`/api/workforce/asset/${id}`, { method: 'DELETE' });
  },

  listAssignments(params?: { user_node_id?: string; asset_id?: string; active?: boolean }): Promise<{ assignments: AssetAssignment[] }> {
    const q = new URLSearchParams();
    if (params?.user_node_id) q.set('user_node_id', params.user_node_id);
    if (params?.asset_id) q.set('asset_id', params.asset_id);
    if (params?.active) q.set('active', 'true');
    return call<{ assignments: AssetAssignment[] }>(`/api/workforce/asset-assignments?${q}`);
  },

  assignAsset(data: { asset_id: string; user_node_id: string; notes?: string }): Promise<{ assignment: AssetAssignment }> {
    return call<{ assignment: AssetAssignment }>('/api/workforce/asset-assignments', { method: 'POST', body: JSON.stringify(data) });
  },

  returnAsset(assignment_id: string, data?: { condition_at_return?: string; notes?: string }): Promise<{ assignment: AssetAssignment }> {
    return call<{ assignment: AssetAssignment }>('/api/workforce/asset-assignments', { method: 'PATCH', body: JSON.stringify({ assignment_id, ...data }) });
  },

  listComplianceOps(): Promise<{ requirements: ComplianceRequirement[]; tasks: ComplianceTask[]; maintenance: AssetMaintenance[] }> {
    return call<{ requirements: ComplianceRequirement[]; tasks: ComplianceTask[]; maintenance: AssetMaintenance[] }>('/api/workforce/compliance-ops');
  },

  createComplianceRequirement(data: {
    requirement_type: ComplianceRequirement['requirement_type'];
    name: string;
    description?: string | null;
    course_id?: string | null;
    asset_id?: string | null;
    required_for_employment_type?: EmploymentType | null;
    due_within_days?: number | null;
    recurrence_days?: number | null;
    active?: boolean;
  }): Promise<{ requirement: ComplianceRequirement }> {
    return call<{ requirement: ComplianceRequirement }>('/api/workforce/compliance-ops', json({ kind: 'requirement', ...data }));
  },

  createAssetMaintenance(data: { asset_id: string; scheduled_for: string; notes?: string | null }): Promise<{ maintenance: AssetMaintenance }> {
    return call<{ maintenance: AssetMaintenance }>('/api/workforce/compliance-ops', json({ kind: 'maintenance', ...data }));
  },

  createComplianceTask(data: {
    resource_id: string;
    requirement_id?: string | null;
    user_node_id?: string | null;
    due_date?: string | null;
    source_type?: ComplianceTask['source_type'];
    source_id?: string | null;
    notes?: string | null;
  }): Promise<{ task: ComplianceTask }> {
    return call<{ task: ComplianceTask }>('/api/workforce/compliance-ops', json({ kind: 'task', ...data }));
  },

  listWorkLocations(): Promise<{ locations: WorkLocation[] }> {
    return call<{ locations: WorkLocation[] }>('/api/workforce/work-locations');
  },

  createWorkLocation(data: {
    name: string;
    latitude: number;
    longitude: number;
    radius_meters?: number;
    min_accuracy_meters?: number;
    applies_to_all?: boolean;
    resource_id?: string | null;
    user_node_id?: string | null;
  }): Promise<{ location: WorkLocation }> {
    return call<{ location: WorkLocation }>('/api/workforce/work-locations', json(data));
  },

  getEmployeeProfile(resource_id: string): Promise<EmployeeProfile> {
    return call<EmployeeProfile>(`/api/workforce/employee-profile?resource_id=${resource_id}`);
  },

  listEmployeeMaster(status?: string): Promise<{ profiles: EmployeeMasterProfile[] }> {
    const q = status ? `?status=${status}` : '';
    return call<{ profiles: EmployeeMasterProfile[] }>(`/api/workforce/employee-master${q}`);
  },

  saveEmployeeMaster(data: {
    resource_id: string;
    user_node_id?: string | null;
    employee_number?: string | null;
    legal_name: string;
    preferred_name?: string | null;
    employment_status?: EmploymentStatus;
    employment_type?: EmploymentType;
    job_title?: string | null;
    department?: string | null;
    hire_date?: string | null;
    termination_date?: string | null;
    manager_user_node_id?: string | null;
    primary_email?: string | null;
    primary_phone?: string | null;
    emergency_contact?: Record<string, unknown>;
    custom_fields?: Record<string, unknown>;
  }): Promise<{ profile: EmployeeMasterProfile }> {
    return call<{ profile: EmployeeMasterProfile }>('/api/workforce/employee-master', json(data));
  },

  getSchedulePlanner(date: string): Promise<{ date: string; plans: SchedulePlanRow[]; findings: ScheduleFinding[] }> {
    return call<{ date: string; plans: SchedulePlanRow[]; findings: ScheduleFinding[] }>(`/api/workforce/schedule-planner?date=${date}`);
  },

  createComplianceRule(data: {
    name: string;
    max_daily_hours?: number | null;
    max_weekly_hours?: number | null;
    break_required_after_hours?: number | null;
    min_break_minutes?: number | null;
    effective_from?: string;
  }): Promise<{ rule: ComplianceRule }> {
    return call<{ rule: ComplianceRule }>('/api/workforce/schedule-planner', json(data));
  },

  getTimeLedger(resource_id?: string): Promise<{ events: TimeClockEvent[]; corrections: TimeCorrection[] }> {
    const q = resource_id ? `?resource_id=${resource_id}` : '';
    return call<{ events: TimeClockEvent[]; corrections: TimeCorrection[] }>(`/api/workforce/time-ledger${q}`);
  },

  appendTimeLedgerEvent(data: {
    resource_id: string;
    user_node_id?: string | null;
    punch_id?: string | null;
    event_type: TimeClockEvent['event_type'];
    occurred_at?: string;
    source?: TimeClockEvent['source'];
    notes?: string | null;
    metadata?: Record<string, unknown>;
  }): Promise<{ event: TimeClockEvent }> {
    return call<{ event: TimeClockEvent }>('/api/workforce/time-ledger', json({ kind: 'event', ...data }));
  },

  requestTimeCorrection(data: {
    resource_id: string;
    punch_id?: string | null;
    correction_type: TimeCorrection['correction_type'];
    original_values?: Record<string, unknown>;
    new_values?: Record<string, unknown>;
    notes?: string | null;
  }): Promise<{ correction: TimeCorrection }> {
    return call<{ correction: TimeCorrection }>('/api/workforce/time-ledger', json({ kind: 'correction', ...data }));
  },

  generateAiPlan: (project_id: string, description: string) =>
    call<{ plan: AiPlan }>('/api/workforce/project-plan', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ project_id, description }),
    }),

  listAiPlans: (project_id: string) =>
    call<{ plans: AiPlan[] }>(`/api/workforce/project-plan?project_id=${project_id}`),

  applyAiPlan: (plan_id: string, task_indices?: number[]) =>
    call<{ applied: number }>('/api/workforce/project-plan-apply', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ plan_id, task_indices }),
    }),
};
