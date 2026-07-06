export interface OnboardTenant {
  name: string;
}

export interface ImportSummary {
  total: number;
  to_create: number;
  errors: number;
}

export interface ImportError {
  row: number;
  field?: string;
  message: string;
}

export interface DryRunResult {
  valid: number;
  errors: ImportError[];
  summary: ImportSummary;
}

export interface CommitResult {
  committed: boolean;
  created?: number;
  errors?: ImportError[];
  summary: ImportSummary;
}

export interface GenerateResult {
  token: string;
  expires_at: string;
}
