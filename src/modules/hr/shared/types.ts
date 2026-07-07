// Shared HR types — kept in one place so pages, components and tests agree.
// HR reads the canonical user_nodes tree; it stores no duplicate person rows.

export interface OrgNode {
  id: string;
  parent_id: string | null;
  level_number: number | null;
  display_name: string;
  email: string | null;
  phone: string | null;
  role_label: string | null;
  role_color: string | null;
  level_label: string | null;
  has_login: boolean;
  sort_order: number;
  created_at: string;
}

export type ChecklistKind = 'onboarding' | 'offboarding';

export interface ChecklistTemplate {
  id: string;
  kind: ChecklistKind;
  name: string;
  is_default: boolean;
  item_count: number;
}

export interface ChecklistInstanceSummary {
  id: string;
  kind: ChecklistKind;
  subject_user_node_id: string | null;
  subject_name: string;
  status: 'open' | 'completed' | 'cancelled';
  created_at: string;
  completed_at: string | null;
  total: number;
  done: number;
}

export interface ChecklistItem {
  id: string;
  position: number;
  label: string;
  description: string | null;
  action_hint: string | null;
  done: boolean;
  done_at: string | null;
}

export interface HeadcountRow {
  level_number: number | null;
  level_label: string | null;
  role_label: string | null;
  role_color: string | null;
  count: number;
}
export interface JoinRow { id: string; display_name: string; role_label: string | null; created_at: string }
export interface ExitRow { id: string; subject_name: string; completed_at: string | null }
export interface HrDashboard {
  headcount: HeadcountRow[];
  totalHeadcount: number;
  joins: { last30: number; last90: number; recent: JoinRow[] };
  exits: { last30: number; last90: number; recent: ExitRow[] };
  workforce: { entries: number; hours: number };
}
