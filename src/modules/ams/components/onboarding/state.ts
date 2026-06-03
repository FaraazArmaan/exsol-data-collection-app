// Wizard state shape + reducer + validators + auto-seed.
// Pure module: no React, no DOM.

export type WizardStep = 'name' | 'products' | 'roles' | 'levels' | 'cardinality' | 'owner' | 'success';

export interface RoleDraft {
  key: string;
  label: string;
  color: string;
  bucket_family?: 'business' | 'employees' | 'customers' | 'products' | null;
}

export interface LevelDraft {
  level_number: number;
  label?: string | null;
  allowed_role_keys: string[];
}

export interface CardinalityDraft {
  parent_role_key: string | null;
  child_role_key: string;
  max_children: number;
}

export interface OwnerDraft {
  display_name: string;
  email: string;
  phone?: string | null;
  notes?: string | null;
  temp_password: string;
}

export interface WizardState {
  step: WizardStep;
  name: string;
  enabled_products: string[];
  roles: RoleDraft[];
  levels: LevelDraft[];
  cardinality_rules: CardinalityDraft[];
  owner: OwnerDraft;
  submitting: boolean;
  submitError: { code: string; section: WizardStep | null; details?: Record<string, unknown> } | null;
}

export const initialState: WizardState = {
  step: 'name',
  name: '',
  enabled_products: [],
  roles: [],
  levels: [],
  cardinality_rules: [],
  owner: { display_name: '', email: '', phone: null, notes: null, temp_password: '' },
  submitting: false,
  submitError: null,
};

export type WizardAction =
  | { type: 'goToStep'; step: WizardStep }
  | { type: 'setName'; value: string }
  | { type: 'toggleProduct'; productKey: string }
  | { type: 'addRole'; role: RoleDraft }
  | { type: 'removeRole'; index: number }
  | { type: 'addLevel'; level: LevelDraft }
  | { type: 'removeLevel'; index: number }
  | { type: 'addCardinality'; rule: CardinalityDraft }
  | { type: 'removeCardinality'; index: number }
  | { type: 'setOwner'; patch: Partial<OwnerDraft> }
  | { type: 'submitStart' }
  | { type: 'submitError'; error: { code: string; section: WizardStep | null; details?: Record<string, unknown> } }
  | { type: 'submitSuccess' };

export function reducer(state: WizardState, action: WizardAction): WizardState {
  switch (action.type) {
    case 'goToStep': return { ...state, step: action.step, submitError: null };
    case 'setName': return { ...state, name: action.value };
    case 'toggleProduct': {
      const has = state.enabled_products.includes(action.productKey);
      return { ...state, enabled_products: has
        ? state.enabled_products.filter((k) => k !== action.productKey)
        : [...state.enabled_products, action.productKey] };
    }
    case 'addRole': return { ...state, roles: [...state.roles, action.role] };
    case 'removeRole': return { ...state, roles: state.roles.filter((_, i) => i !== action.index) };
    case 'addLevel': return { ...state, levels: [...state.levels, action.level] };
    case 'removeLevel': return { ...state, levels: state.levels.filter((_, i) => i !== action.index) };
    case 'addCardinality': return { ...state, cardinality_rules: [...state.cardinality_rules, action.rule] };
    case 'removeCardinality': return { ...state, cardinality_rules: state.cardinality_rules.filter((_, i) => i !== action.index) };
    case 'setOwner': return { ...state, owner: { ...state.owner, ...action.patch } };
    case 'submitStart': return { ...state, submitting: true, submitError: null };
    case 'submitError': return { ...state, submitting: false, submitError: action.error };
    case 'submitSuccess': return { ...state, submitting: false, submitError: null, step: 'success' };
  }
}

export type ValidatorResult = { ok: true } | { ok: false; reason: string };

export const validators: Record<Exclude<WizardStep, 'success'>, (s: WizardState) => ValidatorResult> = {
  name: (s) => s.name.trim().length === 0
    ? { ok: false, reason: 'Name is required' }
    : { ok: true },
  products: () => ({ ok: true }),
  roles: () => ({ ok: true }),    // empty is OK; auto-seed at submit
  levels: () => ({ ok: true }),   // empty is OK; auto-seed at submit
  cardinality: () => ({ ok: true }),
  owner: (s) => {
    if (s.owner.display_name.trim().length === 0) return { ok: false, reason: 'Display name is required' };
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s.owner.email)) return { ok: false, reason: 'Valid email is required' };
    if (s.owner.temp_password.length < 8) return { ok: false, reason: 'Temp password must be ≥ 8 chars' };
    return { ok: true };
  },
};

// Auto-seed roles + levels for the lightweight "skip everything" path.
// Server also auto-seeds defensively, but doing it client-side too keeps
// the wizard's submitted body consistent with the resolveOwnerRoleKey result.
export function applyAutoSeed(state: WizardState): WizardState {
  let roles = state.roles;
  let levels = state.levels;
  if (roles.length === 0) {
    roles = [{ key: 'owner', label: 'Owner', color: '#3b82f6' }];
  }
  if (levels.length === 0) {
    levels = [{ level_number: 1, label: 'Primary', allowed_role_keys: [roles[0]!.key] }];
  }
  return { ...state, roles, levels };
}

// Resolve the Owner's role key per spec §4.5: first role in `roles` whose
// key appears in level 1's allowed_role_keys.
export function resolveOwnerRoleKey(state: WizardState): string | null {
  const lv1 = state.levels.find((l) => l.level_number === 1);
  if (!lv1 || lv1.allowed_role_keys.length === 0) return null;
  const match = state.roles.find((r) => lv1.allowed_role_keys.includes(r.key));
  return match?.key ?? null;
}

// The 6 ordered steps (no 'success' — that's a terminal post-submit state).
export const STEP_ORDER: Array<Exclude<WizardStep, 'success'>> =
  ['name', 'products', 'roles', 'levels', 'cardinality', 'owner'];
