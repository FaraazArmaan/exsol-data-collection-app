import { useEffect, useState } from 'react';
import ChecklistPanel from './ChecklistPanel';
import { hrApi, amsOps } from '../shared/api';
import type { OrgNode, ChecklistItem } from '../shared/types';

// Offboarding reuses ChecklistPanel and wires the two action_hint items to the
// EXISTING AMS operations — disable login (delete credential) and reassign a
// leaver's direct reports up to their manager (user-nodes-move). HR orchestrates;
// AMS enforces its own _platform.users.* permission (Owner passes; a non-owner
// without the grant gets a 403 shown as an action error).
export default function OffboardingTab({ perms }: { perms: ReadonlySet<string> }) {
  const [nodes, setNodes] = useState<OrgNode[]>([]);
  const [actionError, setActionError] = useState<string | null>(null);
  const [busyItem, setBusyItem] = useState<string | null>(null);

  useEffect(() => { hrApi.org().then((r) => setNodes(r.nodes)).catch(() => setNodes([])); }, []);
  const byId = new Map(nodes.map((n) => [n.id, n]));

  async function run(itemId: string, instanceId: string, fn: () => Promise<void>, refresh: () => void) {
    setBusyItem(itemId);
    setActionError(null);
    try {
      await fn();
      await hrApi.toggleItem(instanceId, itemId, true);
      refresh();
      hrApi.org().then((r) => setNodes(r.nodes)).catch(() => {}); // reflect tree changes
    } catch (e) {
      setActionError((e as { code?: string })?.code ?? 'action_failed');
    } finally {
      setBusyItem(null);
    }
  }

  const renderAction = (item: ChecklistItem, ctx: { subjectId: string | null; instanceId: string; refresh: () => void }) => {
    if (!item.action_hint || !ctx.subjectId || item.done) return null;
    const subject = byId.get(ctx.subjectId);

    if (item.action_hint === 'disable_access') {
      return (
        <div className="hr-item-action">
          <button
            className="btn btn-ghost" disabled={busyItem === item.id}
            onClick={() => run(item.id, ctx.instanceId, () => amsOps.disableLogin(ctx.subjectId!), ctx.refresh)}
          >{busyItem === item.id ? 'Disabling…' : 'Disable login'}</button>
        </div>
      );
    }

    if (item.action_hint === 'reassign_subtree') {
      const reports = subject ? nodes.filter((n) => n.parent_id === subject.id) : [];
      if (!subject || reports.length === 0) {
        return <div className="hr-item-note">No direct reports to reassign.</div>;
      }
      const newParent = subject.parent_id;
      const newLevel = subject.parent_id ? subject.level_number : 1;
      return (
        <div className="hr-item-action">
          <button
            className="btn btn-ghost" disabled={busyItem === item.id}
            onClick={() => run(item.id, ctx.instanceId, async () => {
              for (const r of reports) await amsOps.moveNode(r.id, newParent, newLevel);
            }, ctx.refresh)}
          >{busyItem === item.id ? 'Reassigning…' : `Reassign ${reports.length} report${reports.length > 1 ? 's' : ''} to manager`}</button>
        </div>
      );
    }
    return null;
  };

  return (
    <>
      {actionError && (
        <div className="hr-state hr-state-error" role="alert">
          Action failed ({actionError}). This needs user-management permission.
        </div>
      )}
      <ChecklistPanel
        kind="offboarding" perms={perms}
        startLabel="Start offboarding" subjectLabel="Departing person"
        emptyHint="Pick a departing person above to start their exit checklist."
        renderItemAction={renderAction}
      />
    </>
  );
}
