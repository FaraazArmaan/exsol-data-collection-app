import type { FileTier } from '../types';

const TIER_LABEL: Record<FileTier, string> = {
  public:       'Public',
  role:         'Role',
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
      className={`fm-tier fm-tier--${tier}`}
      title={ownerOverride ? `${TIER_LABEL[tier]} (visible via Owner override)` : TIER_LABEL[tier]}
    >
      {TIER_LABEL[tier]}
    </span>
  );
}
