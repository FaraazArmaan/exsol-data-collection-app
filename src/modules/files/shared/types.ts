import type { CategoryKey } from './categories';

export type FileType = 'document' | 'image' | 'video' | 'audio' | 'external';
export type FileStorageKind = 'blob' | 'url';
export type FileTier = 'public' | 'role' | 'restricted' | 'confidential';

export interface FileRow {
  id: string;
  client_id: string | null;
  type: FileType;
  storage_kind: FileStorageKind;
  blob_key: string | null;
  external_url: string | null;
  external_provider: string | null;
  title: string;
  description: string | null;
  filename: string | null;
  mime: string | null;
  byte_size: number | null;
  thumbnail_key: string | null;
  tier: FileTier;
  uploaded_by_user_node: string | null;
  uploaded_by_admin: string | null;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
  categories?: CategoryKey[];
}

export interface ListFilters {
  type?: FileType;
  category?: CategoryKey[];
  search?: string;
  sort?: 'newest' | 'oldest' | 'name' | 'size';
}

export interface ListResponse {
  files: FileRow[];
  has_more: boolean;
  next_cursor: string | null;
}

export interface UploadCommitBody {
  blob_key?: string;
  external_url?: string;
  external_provider?: string | null;
  title: string;
  description?: string;
  filename?: string;
  mime?: string;
  byte_size?: number;
  categories: CategoryKey[];
  tier: FileTier;
  allowed_role_ids?: string[];
  allowed_node_ids?: string[];
  allowed_user_node_ids?: string[];
}
