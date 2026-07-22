import { DndContext, PointerSensor, useDraggable, useDroppable, useSensor, useSensors, type DragEndEvent } from '@dnd-kit/core';
import { useCallback, useEffect, useMemo, useState, type CSSProperties, type ReactNode } from 'react';
import { apiFetch } from '../../lib/api-client';
import { Button, IconButton } from './Button';
import { Overlay } from './Overlay';

export type WorkspaceBlockSize = 'compact' | 'standard' | 'wide';
type WorkspaceBlockDefinition = {
  id: string;
  label: string;
  defaultSize?: WorkspaceBlockSize;
  sizes?: readonly WorkspaceBlockSize[];
};
export interface WorkspaceLayoutDefinition {
  namespace: string;
  tabs?: ReadonlyArray<{ id: string; label: string }>;
  blocks?: ReadonlyArray<WorkspaceBlockDefinition>;
}
export interface WorkspaceLayoutValue {
  version: 1;
  tabs?: string[];
  blocks?: Array<{ id: string; size: WorkspaceBlockSize }>;
}
interface StoredLayoutResponse {
  personal_layout: WorkspaceLayoutValue | null;
  default_layout: WorkspaceLayoutValue | null;
  is_owner: boolean;
}

function uniqueAllowed(ids: readonly string[], incoming?: readonly string[]) {
  const chosen = new Set((incoming ?? []).filter((id) => ids.includes(id)));
  return [...(incoming ?? []).filter((id) => chosen.has(id)), ...ids.filter((id) => !chosen.has(id))]
    .filter((id, index, all) => all.indexOf(id) === index);
}

export function normalizeWorkspaceLayout(definition: WorkspaceLayoutDefinition, value?: WorkspaceLayoutValue | null): WorkspaceLayoutValue {
  const tabIds = definition.tabs?.map((tab) => tab.id) ?? [];
  const blockIds = definition.blocks?.map((block) => block.id) ?? [];
  const sizeById = new Map((value?.blocks ?? []).map((block) => [block.id, block.size]));
  return {
    version: 1,
    ...(tabIds.length ? { tabs: uniqueAllowed(tabIds, value?.tabs) } : {}),
    ...(blockIds.length ? {
      blocks: uniqueAllowed(blockIds, value?.blocks?.map((block) => block.id)).map((id) => ({
        id,
        size: (() => {
          const block = definition.blocks?.find((candidate) => candidate.id === id);
          const fallback = block?.defaultSize ?? 'standard';
          const allowed = block?.sizes ?? ['compact', 'standard', 'wide'];
          const saved = sizeById.get(id);
          return saved && allowed.includes(saved) ? saved : fallback;
        })(),
      })),
    } : {}),
  };
}

export function orderedWorkspaceItems<T extends { id: string }>(items: readonly T[], order?: readonly string[]) {
  const position = new Map((order ?? []).map((id, index) => [id, index]));
  return [...items].sort((a, b) => (position.get(a.id) ?? items.indexOf(a)) - (position.get(b.id) ?? items.indexOf(b)));
}

export function useWorkspaceLayout(definition: WorkspaceLayoutDefinition) {
  const [personal, setPersonal] = useState<WorkspaceLayoutValue | null>(null);
  const [workspaceDefault, setWorkspaceDefault] = useState<WorkspaceLayoutValue | null>(null);
  const [isOwner, setIsOwner] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const effective = useMemo(
    () => normalizeWorkspaceLayout(definition, personal ?? workspaceDefault),
    [definition, personal, workspaceDefault],
  );

  useEffect(() => {
    let current = true;
    setLoaded(false);
    apiFetch<StoredLayoutResponse>(`/api/workspace-layouts?namespace=${encodeURIComponent(definition.namespace)}`)
      .then((result) => {
        if (!current) return;
        if (result.ok) {
          setPersonal(result.data.personal_layout);
          setWorkspaceDefault(result.data.default_layout);
          setIsOwner(result.data.is_owner);
        }
        setLoaded(true);
      });
    return () => { current = false; };
  }, [definition.namespace]);

  async function save(scope: 'personal' | 'default', value: WorkspaceLayoutValue | null) {
    setSaving(true);
    setError('');
    const result = await apiFetch<{ ok: true }>(`/api/workspace-layouts?namespace=${encodeURIComponent(definition.namespace)}`, {
      method: 'PUT', body: JSON.stringify({ scope, layout: value }),
    });
    setSaving(false);
    if (!result.ok) { setError('Could not save this layout. Your current page remains unchanged.'); return false; }
    if (scope === 'personal') setPersonal(value);
    else setWorkspaceDefault(value);
    return true;
  }

  const blockStyle = (id: string): CSSProperties => {
    const index = effective.blocks?.findIndex((block) => block.id === id) ?? 0;
    const size = effective.blocks?.find((block) => block.id === id)?.size ?? 'standard';
    return { order: index + 1, ['--workspace-block-span' as string]: size === 'compact' ? 4 : size === 'wide' ? 12 : 6 };
  };
  return { effective, isOwner, loaded, saving, error, save, blockStyle };
}

type WorkspaceLayoutState = ReturnType<typeof useWorkspaceLayout>;

function move<T>(items: T[], from: number, delta: -1 | 1) {
  const to = from + delta;
  if (to < 0 || to >= items.length) return items;
  const result = [...items];
  [result[from], result[to]] = [result[to]!, result[from]!];
  return result;
}

function moveTo<T>(items: T[], from: number, to: number) {
  if (from < 0 || to < 0 || from === to) return items;
  const result = [...items];
  const [item] = result.splice(from, 1);
  if (item === undefined) return items;
  result.splice(to, 0, item);
  return result;
}

function LayoutRow({ children, className, dragId, label }: { children: ReactNode; className?: string; dragId: string; label: string }) {
  const { attributes, isDragging, listeners, setNodeRef: setDragNodeRef } = useDraggable({ id: dragId });
  const { setNodeRef: setDropNodeRef } = useDroppable({ id: dragId });
  const setNodeRef = useCallback((node: HTMLElement | null) => { setDragNodeRef(node); setDropNodeRef(node); }, [setDragNodeRef, setDropNodeRef]);
  return <li ref={setNodeRef} className={[className, isDragging && 'is-dragging'].filter(Boolean).join(' ')}>
    <button type="button" className="ui-workspace-layout__drag" aria-label={`Drag to reorder ${label}`} title="Drag to reorder" {...attributes} {...listeners}>⠿</button>
    {children}
  </li>;
}

export function WorkspaceLayoutControl({ definition, layout, label = 'Customize workspace' }: {
  definition: WorkspaceLayoutDefinition;
  layout: WorkspaceLayoutState;
  label?: string;
}) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<WorkspaceLayoutValue>(() => layout.effective);
  const [saveAsDefault, setSaveAsDefault] = useState(false);
  useEffect(() => { if (open) setDraft(layout.effective); }, [layout.effective, open]);
  const tabs = definition.tabs ?? [];
  const blocks = definition.blocks ?? [];
  const orderedTabs = orderedWorkspaceItems(tabs, draft.tabs);
  const orderedBlocks = orderedWorkspaceItems(blocks, draft.blocks?.map((block) => block.id));
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }));
  const setTabOrder = (ids: string[]) => setDraft((current) => ({ ...current, tabs: ids }));
  const setBlocks = (next: WorkspaceLayoutValue['blocks']) => setDraft((current) => ({ ...current, blocks: next }));
  async function save() { if (await layout.save(saveAsDefault ? 'default' : 'personal', draft)) setOpen(false); }
  function onDragEnd(event: DragEndEvent) {
    const active = String(event.active.id);
    const over = event.over ? String(event.over.id) : '';
    if (!over || active === over) return;
    if (active.startsWith('tab:') && over.startsWith('tab:')) {
      const ids = orderedTabs.map((item) => item.id);
      setTabOrder(moveTo(ids, ids.indexOf(active.slice(4)), ids.indexOf(over.slice(4))));
    }
    if (active.startsWith('block:') && over.startsWith('block:')) {
      const values = orderedBlocks.map((item) => ({ id: item.id, size: draft.blocks?.find((entry) => entry.id === item.id)?.size ?? item.defaultSize ?? 'standard' }));
      setBlocks(moveTo(values, values.findIndex((item) => item.id === active.slice(6)), values.findIndex((item) => item.id === over.slice(6))));
    }
  }

  return <>
    <Button type="button" variant="secondary" size="compact" onClick={() => setOpen(true)}>{label}</Button>
    <Overlay
      open={open}
      onClose={() => setOpen(false)}
      variant="drawer"
      title="Customize workspace"
      description="Arrange recognized sections only. Required actions, permissions, and responsive safeguards stay intact."
      footer={<>
        <Button type="button" variant="quiet" onClick={() => { void layout.save(saveAsDefault ? 'default' : 'personal', null); setOpen(false); }} disabled={layout.saving}>Reset</Button>
        <Button type="button" variant="primary" onClick={() => { void save(); }} loading={layout.saving}>Save layout</Button>
      </>}
    >
      <DndContext sensors={sensors} onDragEnd={onDragEnd}><div className="ui-workspace-layout">
        {tabs.length ? <section>
          <h3>System tabs</h3><p>Drag or use the arrows to reorder tabs. Every permitted tab remains available.</p>
          <ol className="ui-workspace-layout__list">
            {orderedTabs.map((tab, index) => <LayoutRow key={tab.id} dragId={`tab:${tab.id}`} label={tab.label}>
              <span>{tab.label}</span>
              <span className="ui-workspace-layout__actions">
                <IconButton label={`Move ${tab.label} earlier`} size="compact" variant="quiet" disabled={index === 0} onClick={() => setTabOrder(move(orderedTabs.map((item) => item.id), index, -1))}>↑</IconButton>
                <IconButton label={`Move ${tab.label} later`} size="compact" variant="quiet" disabled={index === orderedTabs.length - 1} onClick={() => setTabOrder(move(orderedTabs.map((item) => item.id), index, 1))}>↓</IconButton>
              </span>
            </LayoutRow>)}
          </ol>
        </section> : null}
        {blocks.length ? <section>
          <h3>Page blocks</h3><p>Choose an approved width; phone layouts stack these blocks automatically.</p>
          <ol className="ui-workspace-layout__list">
            {orderedBlocks.map((block, index) => {
              const current = draft.blocks?.find((entry) => entry.id === block.id)?.size ?? block.defaultSize ?? 'standard';
              const sizes = block.sizes ?? ['compact', 'standard', 'wide'];
              return <LayoutRow key={block.id} className="ui-workspace-layout__block" dragId={`block:${block.id}`} label={block.label}>
                <span>{block.label}</span>
                {sizes.length > 1 ? <label>Width<select value={current} onChange={(event) => setBlocks((draft.blocks ?? []).map((entry) => entry.id === block.id ? { ...entry, size: event.target.value as WorkspaceBlockSize } : entry))}>{sizes.map((size) => <option key={size} value={size}>{size[0]?.toUpperCase()}{size.slice(1)}</option>)}</select></label> : <span className="ui-workspace-layout__fixed">Full width</span>}
                <span className="ui-workspace-layout__actions">
                  <IconButton label={`Move ${block.label} earlier`} size="compact" variant="quiet" disabled={index === 0} onClick={() => setBlocks(move(orderedBlocks.map((item) => ({ id: item.id, size: draft.blocks?.find((entry) => entry.id === item.id)?.size ?? item.defaultSize ?? 'standard' })), index, -1))}>↑</IconButton>
                  <IconButton label={`Move ${block.label} later`} size="compact" variant="quiet" disabled={index === orderedBlocks.length - 1} onClick={() => setBlocks(move(orderedBlocks.map((item) => ({ id: item.id, size: draft.blocks?.find((entry) => entry.id === item.id)?.size ?? item.defaultSize ?? 'standard' })), index, 1))}>↓</IconButton>
                </span>
              </LayoutRow>;
            })}
          </ol>
        </section> : null}
        {layout.isOwner ? <label className="ui-inline-choice"><input type="checkbox" checked={saveAsDefault} onChange={(event) => setSaveAsDefault(event.target.checked)} />Save this as the workspace default</label> : null}
        {layout.error ? <p className="ui-field__error" role="alert">{layout.error}</p> : null}
      </div></DndContext>
    </Overlay>
  </>;
}
