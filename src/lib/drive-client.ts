/**
 * driveClient (Module 9)
 *
 * Thin, retry-aware abstraction over the Google Drive REST API. Used by:
 *   - imagePipeline   for product image upload + serving
 *   - exportEngine    to write generated XLSX/CSV files
 *   - backupEngine    to write workspace and system backups
 *
 * Authentication: a single service account whose JSON key lives in
 * GOOGLE_DRIVE_SERVICE_ACCOUNT_KEY. The account must have Editor access
 * to the root folder whose ID lives in GOOGLE_DRIVE_ROOT_FOLDER_ID.
 *
 * Folder layout (created lazily by ensurePath):
 *   <root>/
 *   └── <Workspace Name>/
 *       ├── Products/<sku>/...        (product images)
 *       ├── Documents/...              (user-uploaded files, Phase 5+)
 *       ├── Backups/...                (per-workspace ZIP backups)
 *       ├── Exports/...                (generated XLSX/CSV exports)
 *       └── Audit Archive/...          (rotated audit CSVs)
 *   <root>/System Backups/             (admin-only nightly tar.gz)
 *
 * Retry policy: 5xx and 429 are retried with exponential backoff
 * (250ms, 500ms, 1000ms, 2000ms, 4000ms). 4xx other than 429 fails
 * immediately. Network errors are retried like 5xx.
 */

import { google, type drive_v3 } from 'googleapis';

// ---------- Types ----------

export type ResumableUploadSession = {
  /** PUT bytes to this URL to perform the upload. */
  uploadUrl: string;
  /** Drive file ID assigned at session creation (file is empty until upload completes). */
  fileId: string;
};

export type DriveFile = {
  id: string;
  name: string;
  mimeType: string;
  parents: string[];
  size?: number;
  modifiedTime?: string;
};

export type ListOptions = {
  /** Restrict to files whose name matches this prefix. */
  namePrefix?: string;
  /** Restrict to a single mime type (e.g. 'image/webp'). */
  mimeType?: string;
  /** Page size (default 100, max 1000). */
  pageSize?: number;
  /** Page token from a prior list response. */
  pageToken?: string;
};

export type ListResult = {
  files: DriveFile[];
  nextPageToken?: string;
};

// ---------- Auth + client lifecycle ----------

let _drive: drive_v3.Drive | null = null;

/**
 * Returns the singleton Drive v3 client. The service-account credentials
 * are parsed from GOOGLE_DRIVE_SERVICE_ACCOUNT_KEY on first call.
 *
 * The key is a JSON string (the full service-account JSON, single line in
 * the .env or multi-line in a real env-var store). It must include
 * `client_email` and `private_key`.
 */
function drive(): drive_v3.Drive {
  if (_drive) return _drive;
  const raw = (process.env['GOOGLE_DRIVE_SERVICE_ACCOUNT_KEY'] ?? '').trim();
  if (!raw) {
    throw new Error('GOOGLE_DRIVE_SERVICE_ACCOUNT_KEY not configured');
  }
  let creds: { client_email?: string; private_key?: string };
  try {
    creds = JSON.parse(raw);
  } catch (err) {
    throw new Error(`GOOGLE_DRIVE_SERVICE_ACCOUNT_KEY is not valid JSON: ${String(err)}`);
  }
  if (!creds.client_email || !creds.private_key) {
    throw new Error('Service-account key missing client_email or private_key');
  }
  // PEM newlines: some env-var stores escape newlines as "\n"; un-escape if so.
  const privateKey = creds.private_key.includes('\\n')
    ? creds.private_key.replace(/\\n/g, '\n')
    : creds.private_key;

  const auth = new google.auth.JWT({
    email: creds.client_email,
    key: privateKey,
    scopes: ['https://www.googleapis.com/auth/drive'],
  });

  _drive = google.drive({ version: 'v3', auth });
  return _drive;
}

/**
 * Returns the configured root folder ID. All workspace folders are
 * created as children of this folder.
 */
export function rootFolderId(): string {
  const v = process.env['GOOGLE_DRIVE_ROOT_FOLDER_ID']?.trim();
  if (!v) throw new Error('GOOGLE_DRIVE_ROOT_FOLDER_ID not configured');
  return v;
}

// ---------- Retry helper ----------

type RetryConfig = {
  maxAttempts: number;
  initialDelayMs: number;
};

const DEFAULT_RETRY: RetryConfig = { maxAttempts: 5, initialDelayMs: 250 };

/**
 * Runs `op` with exponential backoff on transient errors (5xx, 429,
 * network failures). Returns the value on success; throws the last
 * error after maxAttempts.
 *
 * Non-retryable errors (4xx other than 429) throw immediately.
 */
async function withRetry<T>(op: () => Promise<T>, cfg: RetryConfig = DEFAULT_RETRY): Promise<T> {
  let attempt = 0;
  let delay = cfg.initialDelayMs;
  // The googleapis library throws errors with `code` (number) and sometimes
  // `errors[]`. We treat 429 and 5xx as retryable; anything else propagates.
  // Network errors (no `code`) are also retryable.
  // eslint-disable-next-line no-constant-condition
  while (true) {
    try {
      return await op();
    } catch (err: unknown) {
      attempt++;
      const status = (err as { code?: number }).code;
      const retryable = status === undefined || status === 429 || (status >= 500 && status < 600);
      if (!retryable || attempt >= cfg.maxAttempts) {
        throw err;
      }
      await sleep(delay);
      delay = Math.min(delay * 2, 8000);
    }
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ---------- Operations ----------

const FOLDER_MIME = 'application/vnd.google-apps.folder';

/**
 * Resolves the given path (relative to the configured root) to a Drive
 * folder ID, creating any missing intermediate folders. Idempotent.
 *
 * Example:
 *   ensurePath(['Acme Stores', 'Products', 'SKU-001'])
 *     → '<drive folder id of SKU-001>'
 *
 * In a hot path you may want to cache the returned ID in your own
 * application table (e.g. `workspaces.drive_folder_id`) to avoid
 * repeating these list-or-create queries.
 */
export async function ensurePath(segments: string[]): Promise<string> {
  if (segments.length === 0) return rootFolderId();
  let parentId = rootFolderId();
  for (const name of segments) {
    parentId = await ensureChildFolder(parentId, name);
  }
  return parentId;
}

/**
 * Finds a folder named `name` directly under `parentId`. Creates it if
 * absent. Returns the folder ID. If multiple folders share the name
 * (Drive permits this), returns the first.
 */
async function ensureChildFolder(parentId: string, name: string): Promise<string> {
  const existing = await withRetry(async () => {
    const r = await drive().files.list({
      q: `'${escapeQ(parentId)}' in parents and name = '${escapeQ(name)}' and mimeType = '${FOLDER_MIME}' and trashed = false`,
      fields: 'files(id, name)',
      pageSize: 1,
      supportsAllDrives: true,
      includeItemsFromAllDrives: true,
    });
    return r.data.files ?? [];
  });
  const first = existing[0];
  if (first?.id) return first.id;

  const created = await withRetry(async () => {
    const r = await drive().files.create({
      requestBody: { name, mimeType: FOLDER_MIME, parents: [parentId] },
      fields: 'id',
      supportsAllDrives: true,
    });
    return r.data;
  });
  if (!created.id) throw new Error(`Drive did not return an id for created folder "${name}"`);
  return created.id;
}

/**
 * Creates an empty file in the given folder and returns a resumable
 * upload session URL. The browser PUTs bytes to that URL directly —
 * the bytes never traverse our Netlify Function, avoiding the 6 MB
 * response/request cap.
 *
 * The `size` parameter is required by Drive's resumable upload protocol.
 * Pass the exact byte length the browser is about to upload.
 */
export async function requestUploadSession(
  parentFolderId: string,
  filename: string,
  mimeType: string,
  size: number,
): Promise<ResumableUploadSession> {
  // 1) Create the (empty) file metadata so we have a stable file ID.
  const metaResp = await withRetry(async () =>
    drive().files.create({
      requestBody: { name: filename, mimeType, parents: [parentFolderId] },
      fields: 'id',
      supportsAllDrives: true,
    }),
  );
  const fileId = metaResp.data.id;
  if (!fileId) throw new Error('Drive did not return a file id at upload-session init');

  // 2) Initiate a resumable upload session against that file. The Drive
  // REST API expects a PATCH to /upload/drive/v3/files/<id>?uploadType=resumable
  // with headers describing the content. The response Location header is
  // the URL the browser will PUT to.
  const auth = (drive() as unknown as { context: { _options: { auth: { getRequestHeaders: () => Promise<Record<string, string>> } } } }).context._options.auth;
  const headers = await auth.getRequestHeaders();

  const res = await fetch(
    `https://www.googleapis.com/upload/drive/v3/files/${encodeURIComponent(fileId)}?uploadType=resumable&supportsAllDrives=true`,
    {
      method: 'PATCH',
      headers: {
        ...headers,
        'Content-Type': 'application/json; charset=UTF-8',
        'X-Upload-Content-Type': mimeType,
        'X-Upload-Content-Length': String(size),
      },
      body: JSON.stringify({}),
    },
  );

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Failed to initiate resumable upload (${res.status}): ${text}`);
  }
  const uploadUrl = res.headers.get('location');
  if (!uploadUrl) throw new Error('Drive did not return a resumable upload URL');

  return { fileId, uploadUrl };
}

/**
 * Streams the file's bytes from Drive. Returns a ReadableStream so callers
 * can pipe directly to a response without buffering the whole file in
 * memory (important for large product images and ZIP backups).
 */
export async function getBytes(fileId: string): Promise<ReadableStream<Uint8Array>> {
  return withRetry(async () => {
    const r = await drive().files.get(
      { fileId, alt: 'media', supportsAllDrives: true },
      { responseType: 'stream' },
    );
    // The googleapis stream is a Node Readable. Convert to a Web ReadableStream
    // so it can be returned directly from a Netlify Function Response.
    const nodeStream = r.data as unknown as NodeJS.ReadableStream;
    return nodeReadableToWebStream(nodeStream);
  });
}

/**
 * Creates a single folder under the given parent. Prefer `ensurePath`
 * unless you specifically want to create a duplicate.
 */
export async function createFolder(parentId: string, name: string): Promise<string> {
  return ensureChildFolder(parentId, name);
}

/**
 * Moves `fileId` to `destFolderId`. Removes any prior parent.
 */
export async function move(fileId: string, destFolderId: string): Promise<void> {
  await withRetry(async () => {
    const current = await drive().files.get({
      fileId,
      fields: 'parents',
      supportsAllDrives: true,
    });
    const previousParents = (current.data.parents ?? []).join(',');
    await drive().files.update({
      fileId,
      addParents: destFolderId,
      removeParents: previousParents || undefined,
      fields: 'id, parents',
      supportsAllDrives: true,
    });
  });
}

/**
 * Soft-deletes a file (moves to Drive Trash). The service account can
 * later restore from Trash if needed; pass `hard = true` to permanently
 * delete instead.
 */
export async function deleteFile(fileId: string, hard = false): Promise<void> {
  await withRetry(async () => {
    if (hard) {
      await drive().files.delete({ fileId, supportsAllDrives: true });
    } else {
      await drive().files.update({
        fileId,
        requestBody: { trashed: true },
        supportsAllDrives: true,
      });
    }
  });
}

/**
 * Lists files directly under `folderId`. Use `pageToken` from the
 * previous response to paginate; absence of `nextPageToken` means done.
 */
export async function list(folderId: string, options: ListOptions = {}): Promise<ListResult> {
  const pageSize = Math.min(Math.max(options.pageSize ?? 100, 1), 1000);
  const qParts = [`'${escapeQ(folderId)}' in parents`, `trashed = false`];
  if (options.namePrefix) qParts.push(`name contains '${escapeQ(options.namePrefix)}'`);
  if (options.mimeType) qParts.push(`mimeType = '${escapeQ(options.mimeType)}'`);

  return withRetry(async () => {
    const r = await drive().files.list({
      q: qParts.join(' and '),
      fields: 'nextPageToken, files(id, name, mimeType, parents, size, modifiedTime)',
      pageSize,
      pageToken: options.pageToken,
      supportsAllDrives: true,
      includeItemsFromAllDrives: true,
    });
    const files = (r.data.files ?? []).map((f): DriveFile => ({
      id: f.id ?? '',
      name: f.name ?? '',
      mimeType: f.mimeType ?? '',
      parents: f.parents ?? [],
      size: f.size ? Number(f.size) : undefined,
      modifiedTime: f.modifiedTime ?? undefined,
    }));
    const next = r.data.nextPageToken ?? undefined;
    return next ? { files, nextPageToken: next } : { files };
  });
}

// ---------- Helpers ----------

/**
 * Drive's q-language uses single quotes around string literals; backslash
 * escapes embedded quotes. We don't accept user-controlled input in the
 * affected paths today, but this keeps us safe if that changes.
 */
function escapeQ(s: string): string {
  return s.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
}

/**
 * Converts a Node Readable into a Web ReadableStream<Uint8Array> so we
 * can return it from a Fetch-style Response. Available natively in Node 17+
 * via the `stream/web` module but used inline here for clarity.
 */
function nodeReadableToWebStream(node: NodeJS.ReadableStream): ReadableStream<Uint8Array> {
  return new ReadableStream({
    start(controller) {
      node.on('data', (chunk: Buffer | string) => {
        if (typeof chunk === 'string') controller.enqueue(new TextEncoder().encode(chunk));
        else controller.enqueue(new Uint8Array(chunk));
      });
      node.on('end', () => controller.close());
      node.on('error', (err) => controller.error(err));
    },
    cancel() {
      if ('destroy' in node && typeof (node as { destroy?: () => void }).destroy === 'function') {
        (node as { destroy: () => void }).destroy();
      }
    },
  });
}
