import { useEffect, useId, useMemo, useRef, useState } from 'react';
import type { ProductCategory } from '../../shared/types';

interface Props {
  value: string | null;
  categories: ProductCategory[];
  canCreate: boolean;
  onSelect: (categoryId: string | null) => void;
  onCreate: (name: string) => Promise<ProductCategory>;
}

/**
 * Typeahead combobox with inline "+ Create" affordance.
 *
 * The selected category id is owned by the parent (`value`). Internally we
 * track:
 *   - `query`:     the typed text used for filtering / the create-flow label
 *   - `open`:      dropdown visibility
 *   - `highlight`: which option is currently keyboard-focused (index into the
 *                  flat option list, starting with "— Uncategorized —" at 0)
 *
 * The flat option list, in order, is:
 *   [0]        Uncategorized
 *   [1..n]     Filtered categories (case-insensitive contains)
 *   [n+1]     "+ Create '<query>'"  (only when canCreate && no exact match)
 */
export function CategoryCombobox({
  value,
  categories,
  canCreate,
  onSelect,
  onCreate,
}: Props) {
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  // -1 = no highlight yet; the first ArrowDown lands on index 0.
  const [highlight, setHighlight] = useState(-1);
  const [creating, setCreating] = useState(false);

  const wrapRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const listboxId = useId();

  const selectedName = useMemo(() => {
    if (!value) return '';
    return categories.find((c) => c.id === value)?.name ?? '';
  }, [value, categories]);

  // Filter as the user types; when the dropdown is open without a query we
  // still show every category (useful for "I just want to browse").
  const q = query.trim().toLowerCase();
  const filtered = useMemo(() => {
    if (q.length === 0) return categories;
    return categories.filter((c) => c.name.toLowerCase().includes(q));
  }, [categories, q]);

  const exactMatch = useMemo(
    () => categories.some((c) => c.name.toLowerCase() === q),
    [categories, q],
  );
  const showCreate = canCreate && q.length > 0 && !exactMatch;

  // Build the canonical option list so keyboard navigation has a stable
  // index space. `create` is a sentinel option appended at the tail.
  type Option =
    | { kind: 'uncategorized' }
    | { kind: 'category'; cat: ProductCategory }
    | { kind: 'create'; name: string };

  const options: Option[] = useMemo(() => {
    const out: Option[] = [{ kind: 'uncategorized' }];
    for (const c of filtered) out.push({ kind: 'category', cat: c });
    if (showCreate) out.push({ kind: 'create', name: query.trim() });
    return out;
  }, [filtered, showCreate, query]);

  // Whenever the option set shrinks, clamp the highlight so the index never
  // dangles off the end. A value of -1 (no highlight) is preserved.
  useEffect(() => {
    setHighlight((h) => (h < 0 ? h : Math.min(h, options.length - 1)));
  }, [options.length]);

  // Click-outside closes the dropdown. Using mousedown (not click) means we
  // catch the close before any other handler runs.
  useEffect(() => {
    if (!open) return;
    function onDocMouseDown(e: MouseEvent) {
      if (!wrapRef.current) return;
      if (e.target instanceof Node && !wrapRef.current.contains(e.target)) {
        setOpen(false);
      }
    }
    document.addEventListener('mousedown', onDocMouseDown);
    return () => document.removeEventListener('mousedown', onDocMouseDown);
  }, [open]);

  function openWith(initialQuery?: string) {
    if (initialQuery != null) setQuery(initialQuery);
    setOpen(true);
    setHighlight(-1);
  }

  async function selectOption(opt: Option) {
    if (opt.kind === 'uncategorized') {
      onSelect(null);
      setQuery('');
      setOpen(false);
      return;
    }
    if (opt.kind === 'category') {
      onSelect(opt.cat.id);
      setQuery('');
      setOpen(false);
      return;
    }
    // create
    if (creating) return;
    setCreating(true);
    try {
      const created = await onCreate(opt.name);
      onSelect(created.id);
      setQuery('');
      setOpen(false);
    } finally {
      setCreating(false);
    }
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      if (!open) {
        setOpen(true);
        return;
      }
      setHighlight((h) => Math.min(h + 1, options.length - 1));
      return;
    }
    if (e.key === 'ArrowUp') {
      e.preventDefault();
      setHighlight((h) => Math.max(h - 1, 0));
      return;
    }
    if (e.key === 'Enter') {
      e.preventDefault();
      if (!open) return;
      const opt = options[highlight];
      if (opt) void selectOption(opt);
      return;
    }
    if (e.key === 'Escape') {
      e.preventDefault();
      setOpen(false);
      return;
    }
  }

  // When the input is closed it shows the currently-selected category name
  // (or empty placeholder); when open it shows what the user is typing so the
  // filter/create flow makes sense visually.
  const inputValue = open ? query : selectedName;

  const optionId = (i: number) => `${listboxId}-opt-${i}`;

  return (
    <div className="pm-combobox" ref={wrapRef}>
      <input
        ref={inputRef}
        type="text"
        className="pm-combobox-input"
        role="combobox"
        aria-expanded={open}
        aria-controls={listboxId}
        aria-autocomplete="list"
        aria-activedescendant={open && highlight >= 0 && options[highlight] ? optionId(highlight) : undefined}
        placeholder="Uncategorized"
        value={inputValue}
        onFocus={() => openWith()}
        onClick={() => { if (!open) openWith(); }}
        onChange={(e) => {
          if (!open) setOpen(true);
          setQuery(e.target.value);
          // Reset highlight so the user must explicitly arrow into the list
          // before Enter does anything; avoids surprise selections.
          setHighlight(-1);
        }}
        onKeyDown={onKeyDown}
      />

      {open && (
        <ul
          id={listboxId}
          role="listbox"
          className="pm-combobox-list"
        >
          {options.map((opt, i) => {
            const selected = i === highlight;
            const id = optionId(i);
            if (opt.kind === 'uncategorized') {
              return (
                <li
                  key="uncat"
                  id={id}
                  role="option"
                  aria-selected={selected}
                  className="pm-combobox-option"
                  onMouseDown={(e) => { e.preventDefault(); void selectOption(opt); }}
                  onMouseEnter={() => setHighlight(i)}
                >
                  — Uncategorized —
                </li>
              );
            }
            if (opt.kind === 'category') {
              return (
                <li
                  key={opt.cat.id}
                  id={id}
                  role="option"
                  aria-selected={selected}
                  className="pm-combobox-option"
                  onMouseDown={(e) => { e.preventDefault(); void selectOption(opt); }}
                  onMouseEnter={() => setHighlight(i)}
                >
                  {opt.cat.name}
                </li>
              );
            }
            // create
            return (
              <li
                key="__create"
                id={id}
                role="option"
                aria-selected={selected}
                className="pm-combobox-option pm-combobox-create"
                onMouseDown={(e) => { e.preventDefault(); void selectOption(opt); }}
                onMouseEnter={() => setHighlight(i)}
              >
                + Create "{opt.name}"
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
