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
  team_members: Array<{ id: string; display_name: string; role_label: string | null }>;
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
};
