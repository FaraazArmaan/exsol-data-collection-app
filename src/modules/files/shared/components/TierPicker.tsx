import type { FileTier } from '../types';
import { RolePicker } from './RolePicker';
import { NodePicker } from './NodePicker';
import { UserPicker } from './UserPicker';

interface Props {
  clientId: string | null;
  tier: FileTier;
  onTierChange: (t: FileTier) => void;
  allowedRoleIds: string[];
  allowedNodeIds: string[];
  allowedUserNodeIds: string[];
  onAllowedRoleIdsChange: (next: string[]) => void;
  onAllowedNodeIdsChange: (next: string[]) => void;
  onAllowedUserNodeIdsChange: (next: string[]) => void;
  isL1Owner: boolean;
  isAdminVault: boolean;
}

const TIERS: { value: FileTier; label: string; hint: string }[] = [
  { value: 'public',       label: 'Public',       hint: 'anyone in workspace' },
  { value: 'role',         label: 'Role-based',   hint: 'specific roles' },
  { value: 'restricted',   label: 'Restricted',   hint: 'specific access-level nodes' },
  { value: 'confidential', label: 'Confidential', hint: 'specific users only' },
];

export function TierPicker(p: Props) {
  if (p.isAdminVault) {
    return <p style={{ color: '#888', fontSize: 12 }}>Admin vault files are visible to all ExSol operators.</p>;
  }
  const ownerOnly = (t: FileTier) => (t === 'restricted' || t === 'confidential') && !p.isL1Owner;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        {TIERS.map((t) => {
          const disabled = ownerOnly(t.value);
          return (
            <label key={t.value} style={{ display: 'flex', gap: 10, alignItems: 'center', opacity: disabled ? 0.5 : 1, cursor: disabled ? 'not-allowed' : 'pointer' }}>
              <input
                type="radio"
                name="tier"
                checked={p.tier === t.value}
                disabled={disabled}
                onChange={() => p.onTierChange(t.value)}
              />
              <span>{t.label} <em style={{ color: '#888', fontSize: 11 }}>— {t.hint}</em></span>
              {disabled && <em style={{ color: '#888', fontSize: 10 }}>Owner only</em>}
            </label>
          );
        })}
      </div>

      {p.tier === 'role' && (
        <div>
          <div style={{ fontSize: 11, color: '#888', marginBottom: 6 }}>Pick roles:</div>
          <RolePicker clientId={p.clientId} value={p.allowedRoleIds} onChange={p.onAllowedRoleIdsChange} />
        </div>
      )}
      {p.tier === 'restricted' && (
        <div>
          <div style={{ fontSize: 11, color: '#888', marginBottom: 6 }}>Pick subtree roots:</div>
          <NodePicker clientId={p.clientId} value={p.allowedNodeIds} onChange={p.onAllowedNodeIdsChange} />
        </div>
      )}
      {p.tier === 'confidential' && (
        <div>
          <div style={{ fontSize: 11, color: '#888', marginBottom: 6 }}>Pick specific users:</div>
          <UserPicker clientId={p.clientId} value={p.allowedUserNodeIds} onChange={p.onAllowedUserNodeIdsChange} />
          <p style={{ fontSize: 11, color: '#c93', marginTop: 8 }}>
            ⚠ Confidential files are hidden from most of your team. The Owner can always see them.
          </p>
        </div>
      )}
    </div>
  );
}
