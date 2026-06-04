// Pure CSV-to-typed-row helper used by BulkInviteModal. No DOM, no React.
// The server's Zod schema for /api/user-nodes-bulk is authoritative; this
// helper produces the same shape so a happy parse round-trips without further
// transformation. Rows missing required columns are surfaced as parseErrors,
// not silently dropped.

export interface ParsedRow {
  display_name: string;
  role_key: string;
  level_number: number | null;
  parent_email: string | null;
  email: string | null;
  phone: string | null;
  notes: string | null;
  create_login: boolean;
  temp_password: string;
}

export interface ParseError {
  // 1-indexed row number in the user's CSV (header is row 1).
  row: number;
  message: string;
}

export interface ParseResult {
  rows: ParsedRow[];
  parseErrors: ParseError[];
}

const KNOWN_COLUMNS = new Set<keyof ParsedRow>([
  'display_name', 'role_key', 'level_number', 'parent_email',
  'email', 'phone', 'notes', 'create_login', 'temp_password',
]);
const REQUIRED_COLUMNS: (keyof ParsedRow)[] = ['display_name', 'role_key'];

export function parseCsv(text: string): ParseResult {
  const parseErrors: ParseError[] = [];
  const lines = splitLines(text);
  if (lines.length === 0) return { rows: [], parseErrors: [{ row: 1, message: 'empty input' }] };

  const headerCells = splitCsvLine(lines[0]!).map((c) => c.trim());
  // Detect unknown columns and emit one soft warning per — they're ignored but
  // we surface the typo so the user can fix their template.
  for (const h of headerCells) {
    if (h === '') continue;
    if (!KNOWN_COLUMNS.has(h as keyof ParsedRow)) {
      parseErrors.push({ row: 1, message: `unknown column "${h}" — ignored` });
    }
  }
  // Reject if any REQUIRED column is missing from header.
  for (const req of REQUIRED_COLUMNS) {
    if (!headerCells.includes(req)) {
      parseErrors.push({ row: 1, message: `missing required column "${req}"` });
    }
  }
  if (parseErrors.some((e) => /missing required/.test(e.message))) {
    return { rows: [], parseErrors };
  }

  const rows: ParsedRow[] = [];
  for (let i = 1; i < lines.length; i++) {
    const raw = lines[i]!;
    if (raw.trim() === '') continue;
    const cells = splitCsvLine(raw);
    const obj: Record<string, string> = {};
    for (let j = 0; j < headerCells.length; j++) {
      const k = headerCells[j]!;
      if (!KNOWN_COLUMNS.has(k as keyof ParsedRow)) continue;
      obj[k] = (cells[j] ?? '').trim();
    }
    rows.push(coerceRow(obj));
  }
  return { rows, parseErrors };
}

function coerceRow(o: Record<string, string>): ParsedRow {
  const level = o.level_number;
  const create = (o.create_login ?? '').toLowerCase();
  return {
    display_name: o.display_name ?? '',
    role_key: o.role_key ?? '',
    level_number: level === '' || level === undefined ? null : Number(level),
    parent_email: o.parent_email ? o.parent_email : null,
    email: o.email ? o.email : null,
    phone: o.phone ? o.phone : null,
    notes: o.notes ? o.notes : null,
    create_login: create === 'true' || create === '1' || create === 'yes',
    temp_password: o.temp_password ?? '',
  };
}

// Split on LF or CRLF without splitting inside quoted fields.
function splitLines(text: string): string[] {
  const out: string[] = [];
  let cur = '';
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]!;
    if (ch === '"') {
      // Toggle, but a doubled "" inside quotes is an escaped quote, not a toggle.
      if (inQuotes && text[i + 1] === '"') { cur += '""'; i++; continue; }
      inQuotes = !inQuotes;
      cur += ch;
      continue;
    }
    if ((ch === '\n' || ch === '\r') && !inQuotes) {
      // Swallow \r\n as one break.
      if (ch === '\r' && text[i + 1] === '\n') i++;
      out.push(cur);
      cur = '';
      continue;
    }
    cur += ch;
  }
  if (cur !== '') out.push(cur);
  return out;
}

function splitCsvLine(line: string): string[] {
  const out: string[] = [];
  let cur = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i]!;
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') { cur += '"'; i++; continue; }
      inQuotes = !inQuotes;
      continue;
    }
    if (ch === ',' && !inQuotes) {
      out.push(cur);
      cur = '';
      continue;
    }
    cur += ch;
  }
  out.push(cur);
  return out;
}
