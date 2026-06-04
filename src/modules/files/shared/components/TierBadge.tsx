import type { FileTier } from '../types';

const TIER_ICON: Record<FileTier, string> = {
  public:       '🌐',
  role:         '👥',
  restricted:   '🛡',
  confidential: '🔒',
};

const TIER_LABEL: Record<FileTier, string> = {
  public:       'Public',
  role:         'Role-based',
  restricted:   'Restricted',
  confidential: 'Confidential',
};

interface Props {
  tier: FileTier;
  ownerOverride?: boolean;
}

export function TierBadge({ tier, ownerOverride }: Props) {
  return (
    <span
      title={ownerOverride ? `${TIER_LABEL[tier]} (visible via Owner override)` : TIER_LABEL[tier]}
      style={{
        display: 'inline-flex', gap: 4, alignItems: 'center', fontSize: 11, color: '#999',
      }}
    >
      <span>{TIER_ICON[tier]}</span>
      <span>{TIER_LABEL[tier]}</span>
    </span>
  );
}
