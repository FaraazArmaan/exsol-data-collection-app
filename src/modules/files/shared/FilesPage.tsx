import type React from 'react';
import { useEffect, useState } from 'react';
import type { CategoryKey } from './categories';
import type { BulkAction, FileRow, FileType } from './types';
import { bulkAction, listFiles } from './api';
import { FilterBar, type SortKey } from './components/FilterBar';
import { FileGrid } from './components/FileGrid';
import { UploadModal } from './components/UploadModal';
import { FileDetailModal } from './components/FileDetailModal';
import { QuotaMeter } from './components/QuotaMeter';
import { BulkActionBar } from './components/BulkActionBar';

interface Props {
  clientId: string | null;       // null = admin vault
  isL1Owner: boolean;
}

export function FilesPage({ clientId, isL1Owner }: Props) {
  const [activeType, setActiveType] = useState<FileType | null>('document');
  const [selectedCategories, setSelectedCategories] = useState<CategoryKey[]>([]);
  const [search, setSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [sort, setSort] = useState<SortKey>('newest');
  const [files, setFiles] = useState<FileRow[]>([]);
  const [showUpload, setShowUpload] = useState(false);
  const [droppedFile, setDroppedFile] = useState<File | null>(null);
  const [dragActive, setDragActive] = useState(false);
  const [detailId, setDetailId] = useState<string | null>(null);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [quotaRefresh, setQuotaRefresh] = useState(0);

  function load() {
    listFiles(clientId, {
      type: activeType ?? undefined,
      category: selectedCategories,
      search: debouncedSearch || undefined,
      sort,
    }).then((r) => setFiles(r.files)).catch(() => setFiles([]));
  }

  useEffect(() => {
    const t = window.setTimeout(() => setDebouncedSearch(search), 300);
    return () => window.clearTimeout(t);
  }, [search]);

  useEffect(load, [clientId, activeType, selectedCategories.join(','), debouncedSearch, sort]); // eslint-disable-line react-hooks/exhaustive-deps

  function toggleSelect(id: string) {
    setSelectedIds((cur) => {
      const next = new Set(cur);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  async function runBulk(a: BulkAction) {
    try {
      await bulkAction(a);
    } finally {
      setSelectedIds(new Set());
      load();
      setQuotaRefresh((n) => n + 1);
    }
  }

  function onDrop(e: React.DragEvent<HTMLDivElement>) {
    e.preventDefault();
    setDragActive(false);
    const f = e.dataTransfer.files?.[0];
    if (!f) return;
    setDroppedFile(f);
    setShowUpload(true);
  }

  return (
    <div
      className={`fm${dragActive ? ' is-drag' : ''}`}
      onDragOver={(e) => { e.preventDefault(); if (!dragActive) setDragActive(true); }}
      onDragLeave={(e) => { if (e.currentTarget === e.target) setDragActive(false); }}
      onDrop={onDrop}
    >
      <header className="fm__header">
        <div className="fm__heading">
          <h2>File Manager</h2>
          <p className="fm__subtitle">
            {clientId === null
              ? 'Admin vault — files shared across the platform'
              : 'Your workspace documents and media'}
          </p>
        </div>
        <div className="fm__actions">
          {clientId && <QuotaMeter clientId={clientId} refreshKey={quotaRefresh} />}
          <button type="button" className="fm-btn fm-btn--primary" onClick={() => { setDroppedFile(null); setShowUpload(true); }}>
            Upload
          </button>
        </div>
      </header>

      <FilterBar
        selected={selectedCategories} onChange={setSelectedCategories}
        search={search} onSearchChange={setSearch}
        sort={sort} onSortChange={setSort}
      />

      <FileGrid
        files={files}
        activeType={activeType}
        onTypeChange={setActiveType}
        onOpen={(f) => setDetailId(f.id)}
        selectedIds={selectedIds}
        onToggleSelect={toggleSelect}
      />

      <BulkActionBar
        selectedIds={Array.from(selectedIds)}
        isL1Owner={isL1Owner}
        onAction={runBulk}
        onClear={() => setSelectedIds(new Set())}
      />

      {showUpload && (
        <UploadModal
          clientId={clientId} isL1Owner={isL1Owner} isAdminVault={clientId === null}
          initialFile={droppedFile}
          onClose={() => { setShowUpload(false); setDroppedFile(null); }}
          onUploaded={() => { load(); setQuotaRefresh((n) => n + 1); }}
        />
      )}
      {detailId && (
        <FileDetailModal
          id={detailId} clientId={clientId} isL1Owner={isL1Owner} isAdminVault={clientId === null}
          onClose={() => setDetailId(null)}
          onChanged={() => { load(); setQuotaRefresh((n) => n + 1); }}
        />
      )}
    </div>
  );
}
