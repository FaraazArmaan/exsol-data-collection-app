import { Navigate, useParams } from 'react-router-dom';
import { useUserAuth } from '../user-auth-context';
import { useNavItems } from '../nav/useNavItems';

export default function ModuleStub() {
  const { slug, moduleKey } = useParams<{ slug: string; moduleKey: string }>();
  const { user, permissions } = useUserAuth();
  const navItems = useNavItems();

  if (!slug || !moduleKey || !user) return null;

  const item = navItems.find((n) => n.moduleKey === moduleKey);
  if (!item) return <Navigate to={`/c/${slug}`} replace />;

  // Pull the verbs the user has on this Module, grouped per bucket.
  // Permission keys look like '<moduleKey>.<bucket>.<verb>'.
  const prefix = `${moduleKey}.`;
  const bucketVerbs = new Map<string, string[]>();
  for (const key of Object.keys(permissions)) {
    if (!key.startsWith(prefix)) continue;
    const rest = key.slice(prefix.length);
    const lastDot = rest.lastIndexOf('.');
    if (lastDot < 1) continue;
    const bucket = rest.slice(0, lastDot);
    const verb = rest.slice(lastDot + 1);
    const list = bucketVerbs.get(bucket) ?? [];
    list.push(verb);
    bucketVerbs.set(bucket, list);
  }

  const isOwner = user.level_number == null || user.level_number === 1;

  return (
    <div style={{ maxWidth: 720 }}>
      <h1 style={{ margin: 0, fontSize: 24 }}>{item.label}</h1>
      <p className="muted" style={{ margin: '8px 0 24px', fontSize: 14 }}>
        This module's UI is coming soon.
      </p>

      <div className="card" style={{ padding: 16 }}>
        <h3 style={{ margin: '0 0 8px', fontSize: 14, textTransform: 'uppercase', letterSpacing: 0.5 }}>
          Your permissions here
        </h3>
        {isOwner ? (
          <p style={{ margin: 0, fontSize: 13 }}>You are the Owner — full access to all buckets.</p>
        ) : bucketVerbs.size === 0 ? (
          <p className="muted" style={{ margin: 0, fontSize: 13 }}>No explicit permissions granted.</p>
        ) : (
          <ul style={{ margin: 0, paddingLeft: 18, fontSize: 13 }}>
            {Array.from(bucketVerbs.entries()).sort().map(([bucket, verbs]) => (
              <li key={bucket}>
                <strong>{bucket}</strong>: {verbs.sort().join(', ')}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
