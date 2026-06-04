// MIME → file_type classification + write-time MIME allow-list.
// Used by:
//   - POST /api/files (commit) to auto-classify rows
//   - POST /api/files-upload-url to reject unsafe MIMEs before reserving a key

export type FileType = 'document' | 'image' | 'video' | 'audio' | 'external';

const DOCUMENT_MIMES = new Set<string>([
  'application/pdf',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.ms-powerpoint',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  'text/plain',
  'text/csv',
  'text/markdown',
  'application/json',
  'application/xml',
  'text/xml',
]);

const BLOCKED_MIMES = new Set<string>([
  'application/x-msdownload',
  'application/x-executable',
  'application/x-dosexec',
  'application/javascript',
  'application/ecmascript',
  'text/javascript',
  'application/x-sh',
  'application/x-csh',
]);

export function classifyFileType(mime: string | undefined | null): FileType {
  if (!mime) return 'external';
  const m = mime.toLowerCase();
  if (m.startsWith('image/')) return 'image';
  if (m.startsWith('video/')) return 'video';
  if (m.startsWith('audio/')) return 'audio';
  if (DOCUMENT_MIMES.has(m)) return 'document';
  return 'external';
}

export function isAllowedMime(mime: string): boolean {
  return !BLOCKED_MIMES.has(mime.toLowerCase());
}
