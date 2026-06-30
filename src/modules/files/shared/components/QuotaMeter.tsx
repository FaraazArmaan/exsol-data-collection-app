import { useEffect, useState } from 'react';
import { getQuota } from '../api';

function gb(bytes: number): string {
  return `${(bytes / 1073741824).toFixed(1)} GB`;
}

interface Props {
  clientId: string;
  refreshKey: number; // bump to re-fetch after uploads / bulk deletes
}

export function QuotaMeter({ clientId, refreshKey }: Props) {
  const [data, setData] = useState<{ byte_limit: number; bytes_used: number } | null>(null);

  useEffect(() => {
    let alive = true;
    getQuota(clientId).then((q) => { if (alive) setData(q); }).catch(() => { if (alive) setData(null); });
    return () => { alive = false; };
  }, [clientId, refreshKey]);

  if (!data) return null;
  const pct = data.byte_limit > 0 ? Math.min(100, Math.round((data.bytes_used / data.byte_limit) * 100)) : 0;
  const level = pct >= 100 ? 'over' : pct >= 80 ? 'warn' : 'ok';

  return (
    <div className="fm-quota">
      <div className="fm-quota__row">
        <span className="fm-quota__used">{gb(data.bytes_used)} / {gb(data.byte_limit)}</span>
        <span className="fm-quota__limit">{pct}%</span>
      </div>
      <div className="fm-quota__bar" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100}>
        <div className={`fm-quota__fill fm-quota__fill--${level}`} style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}
