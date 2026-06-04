// src/modules/ams/components/onboarding/OnboardClientChooser.tsx
//
// Two-card screen mounted when admin clicks + Add Client. Picks between:
//   - Upload template → parses XLSX → mounts OnboardClientImportPreview
//   - Add manually → mounts the existing OnboardClientWizard
//
// Also exposes "Download blank template" as a client-side Blob download.

import { useState, type ChangeEvent, type ReactNode } from 'react';
import { parseTemplateXlsx } from '../../../shared/onboarding-import/template-parser';
import { buildBlankTemplateXlsx } from '../../../shared/onboarding-import/template-blob';
import type { ParsedTemplate, TemplateParseError, OnboardClientBulkSuccess } from '../../../shared/onboarding-import/types';
import { OnboardClientImportPreview } from './OnboardClientImportPreview';
import { OnboardClientWizard } from './OnboardClientWizard';

interface Props {
  onClose: () => void;
  onCreated: () => void;
}

type Mode = 'chooser' | 'wizard' | 'preview';

export function OnboardClientChooser({ onClose, onCreated }: Props) {
  const [mode, setMode] = useState<Mode>('chooser');
  const [parsed, setParsed] = useState<ParsedTemplate | null>(null);
  const [parseWarnings, setParseWarnings] = useState<TemplateParseError[]>([]);
  const [fileError, setFileError] = useState<string | null>(null);
  const [success, setSuccess] = useState<OnboardClientBulkSuccess | null>(null);

  async function handleFile(e: ChangeEvent<HTMLInputElement>) {
    setFileError(null);
    const file = e.target.files?.[0];
    if (!file) return;
    if (!file.name.toLowerCase().endsWith('.xlsx')) {
      setFileError('Please upload an .xlsx file.');
      return;
    }
    const buf = await file.arrayBuffer();
    const result = parseTemplateXlsx(buf);
    const fatal = result.errors.filter((er) => /missing required|could not read/i.test(er.message));
    if (fatal.length > 0 || !result.template) {
      setFileError(fatal.map((er) => er.message).join('; ') || 'Template parse failed.');
      return;
    }
    setParsed(result.template);
    setParseWarnings(result.errors);
    setMode('preview');
  }

  function downloadTemplate() {
    const buf = buildBlankTemplateXlsx();
    const blob = new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = 'onboarding-template.xlsx';
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  if (success) {
    return (
      <Shell title="Workspace created" onClose={onClose}>
        <p style={{ marginTop: 0 }}>
          <strong>{success.client.name}</strong> created with {success.team_member_count} team member{success.team_member_count === 1 ? '' : 's'}.
        </p>
        <p className="muted" style={{ fontSize: 12 }}>
          Share these temp passwords with each user. Each can be re-revealed up to 3 times after this dialog closes.
        </p>
        <div style={{ maxHeight: '50vh', overflowY: 'auto' }}>
          <table style={{ width: '100%', fontSize: 12, borderCollapse: 'collapse' }}>
            <thead>
              <tr>
                {['Display name', 'Email', 'Temp password'].map((h) => (
                  <th key={h} style={{ textAlign: 'left', padding: '4px 6px', borderBottom: '1px solid var(--border-subtle)' }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {success.credentials.map((c, i) => (
                <tr key={i}>
                  <td style={{ padding: '4px 6px' }}>{c.display_name}</td>
                  <td style={{ padding: '4px 6px' }}>{c.email}</td>
                  <td style={{ padding: '4px 6px', fontFamily: 'var(--font-mono)' }}>{c.temp_password}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 12 }}>
          <button type="button" className="btn btn-primary" onClick={() => { onCreated(); onClose(); }}>Done</button>
        </div>
      </Shell>
    );
  }

  if (mode === 'wizard') {
    return <OnboardClientWizard onClose={onClose} onCreated={onCreated} />;
  }
  if (mode === 'preview' && parsed) {
    return (
      <OnboardClientImportPreview
        initial={parsed}
        parseWarnings={parseWarnings}
        onCancel={() => { setMode('chooser'); setParsed(null); }}
        onCreated={(res) => { setSuccess(res); }}
      />
    );
  }

  return (
    <Shell title="New workspace" onClose={onClose}>
      <p className="muted" style={{ marginTop: 0 }}>How are we doing this?</p>
      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
        <div className="card" style={{ flex: '1 1 280px', padding: 16 }}>
          <h3 style={{ marginTop: 0, fontSize: 15 }}>📄 Upload a template</h3>
          <p className="muted" style={{ fontSize: 12 }}>Have a filled sheet? Drop it here.</p>
          <label className="btn btn-primary" style={{ display: 'inline-block', cursor: 'pointer' }}>
            Choose file
            <input type="file" accept=".xlsx" onChange={handleFile} style={{ display: 'none' }} />
          </label>
          <p className="muted" style={{ fontSize: 11, marginTop: 8 }}>
            <button type="button" className="btn btn-ghost" onClick={downloadTemplate}>
              Download blank template
            </button>
          </p>
          {fileError && <p className="error" style={{ fontSize: 12 }}>{fileError}</p>}
        </div>

        <div className="card" style={{ flex: '1 1 280px', padding: 16 }}>
          <h3 style={{ marginTop: 0, fontSize: 15 }}>✏️ Add manually</h3>
          <p className="muted" style={{ fontSize: 12 }}>No template yet? We'll walk you through it step by step.</p>
          <button type="button" className="btn btn-primary" onClick={() => setMode('wizard')}>
            Start wizard
          </button>
        </div>
      </div>
    </Shell>
  );
}

function Shell({ title, children, onClose }: { title: string; children: ReactNode; onClose: () => void }) {
  return (
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 100 }}>
      <div className="card" onClick={(e) => e.stopPropagation()} style={{ width: 'min(680px, 92vw)', maxHeight: '92vh', overflow: 'auto' }}>
        <header style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
          <h2 style={{ margin: 0, fontSize: 18 }}>{title}</h2>
          <button type="button" className="btn btn-ghost" onClick={onClose} aria-label="Close">×</button>
        </header>
        {children}
      </div>
    </div>
  );
}
