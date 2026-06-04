import { useEffect, useState } from 'react';
import type { CategoryKey } from './categories';
import type { FileRow, FileType } from './types';
import { listFiles } from './api';
import { FilterBar } from './components/FilterBar';
import { FileGrid } from './components/FileGrid';
import { UploadModal } from './components/UploadModal';
import { FileDetailModal } from './components/FileDetailModal';

interface Props {
  clientId: string | null;       // null = admin vault
  isL1Owner: boolean;
}

export function FilesPage({ clientId, isL1Owner }: Props) {
  const [activeType, setActiveType] = useState<FileType | null>('document');
  const [selectedCategories, setSelectedCategories] = useState<CategoryKey[]>([]);
  const [files, setFiles] = useState<FileRow[]>([]);
  const [showUpload, setShowUpload] = useState(false);
  const [detailId, setDetailId] = useState<string | null>(null);

  function load() {
    listFiles(clientId, {
      type: activeType ?? undefined,
      category: selectedCategories,
    }).then((r) => setFiles(r.files)).catch(() => setFiles([]));
  }

  useEffect(load, [clientId, activeType, selectedCategories.join(',')]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div style={{ maxWidth: 1100, margin: '0 auto', padding: 24 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <h2>Files</h2>
        <button type="button" onClick={() => setShowUpload(true)} style={{ background: '#fff', color: '#000', padding: '6px 14px' }}>
          + Upload
        </button>
      </div>
      <FilterBar selected={selectedCategories} onChange={setSelectedCategories} />
      <FileGrid
        files={files}
        activeType={activeType}
        onTypeChange={setActiveType}
        onOpen={(f) => setDetailId(f.id)}
      />
      {showUpload && (
        <UploadModal
          clientId={clientId} isL1Owner={isL1Owner} isAdminVault={clientId === null}
          onClose={() => setShowUpload(false)}
          onUploaded={load}
        />
      )}
      {detailId && (
        <FileDetailModal
          id={detailId} clientId={clientId} isL1Owner={isL1Owner} isAdminVault={clientId === null}
          onClose={() => setDetailId(null)}
          onChanged={load}
        />
      )}
    </div>
  );
}
