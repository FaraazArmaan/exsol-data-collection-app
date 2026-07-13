import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useUserAuth } from '../user-auth-context';
import { useNavItems } from '../nav/useNavItems';
import {
  workforceMeClockIn,
  workforceMeClockOut,
  workforceMeEndBreak,
  workforceMeStartBreak,
  workforceMeTimeStatus,
  type WorkforceMeTimeStatus,
} from '../api';

function StatTile({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="card tile">
      <div className="tile-stat-label">{label}</div>
      <div className="tile-stat-value">{value}</div>
    </div>
  );
}

function StubTile({ title, description }: { title: string; description: string }) {
  return (
    <div className="card tile tile-disabled" title="Coming soon" aria-disabled="true">
      <div className="tile-title">{title}</div>
      <div className="tile-sub">{description}</div>
      <div className="tile-disabled-badge">Coming soon</div>
    </div>
  );
}

function formatTime(iso: string): string {
  return new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

function browserLocation(): Promise<{ latitude: number; longitude: number; accuracy_meters: number }> {
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) {
      reject(new Error('Location access is not available in this browser.'));
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (pos) => resolve({
        latitude: pos.coords.latitude,
        longitude: pos.coords.longitude,
        accuracy_meters: pos.coords.accuracy,
      }),
      () => reject(new Error('Allow location access to clock in.')),
      { enableHighAccuracy: true, timeout: 12000, maximumAge: 0 },
    );
  });
}

function WorkforceTimeCard({ enabled }: { enabled: boolean }) {
  const [status, setStatus] = useState<WorkforceMeTimeStatus | null>(null);
  const [loading, setLoading] = useState(enabled);
  const [busy, setBusy] = useState('');
  const [message, setMessage] = useState('');

  async function load() {
    if (!enabled) return;
    setLoading(true);
    const res = await workforceMeTimeStatus();
    if (res.ok) {
      setStatus(res.data);
      setMessage('');
    } else if (res.error.code === 'employee_profile_not_linked') {
      setStatus(null);
      setMessage('Your Team user is not linked to an active employee profile.');
    } else {
      setMessage(res.error.message || res.error.code);
    }
    setLoading(false);
  }

  useEffect(() => { void load(); }, [enabled]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!enabled) return null;

  const openPunch = status?.open_punch ?? null;
  const openBreak = status?.open_break ?? null;
  const state = openBreak ? 'On break' : openPunch ? 'Clocked in' : 'Not clocked in';

  async function act(action: 'clock-in' | 'clock-out' | 'start-break' | 'end-break') {
    setBusy(action);
    setMessage('');
    let res;
    try {
      if (action === 'clock-in') {
        const location = await browserLocation();
        res = await workforceMeClockIn(location);
      } else if (action === 'clock-out') {
        res = await workforceMeClockOut();
      } else if (action === 'start-break') {
        res = await workforceMeStartBreak();
      } else {
        res = await workforceMeEndBreak();
      }
      if (!res.ok) {
        const code = res.error.code;
        setMessage(
          code === 'outside_geofence' ? 'You are outside an approved work location.'
            : code === 'location_accuracy_too_low' ? 'Location accuracy is too low. Move near the worksite and try again.'
              : code === 'geofence_unconfigured' ? 'No approved work location is assigned to your profile.'
                : res.error.message || code,
        );
        return;
      }
      await load();
    } catch (err) {
      setMessage(err instanceof Error ? err.message : 'Unable to complete time action.');
    } finally {
      setBusy('');
    }
  }

  return (
    <section className="dash-time-card card">
      <div className="dash-time-head">
        <div>
          <h2 className="section-title">Today&apos;s time</h2>
          <p className="muted">
            {loading ? 'Loading...' : status ? `${status.employee.legal_name} · ${status.employee.resource_name}` : 'Employee profile required'}
          </p>
        </div>
        <span className={`dash-time-state ${openPunch ? 'is-active' : ''}`}>{state}</span>
      </div>

      {status && (
        <div className="dash-time-body">
          <div className="dash-time-metric">
            <span>Clock in</span>
            <strong>{openPunch ? formatTime(openPunch.punched_in_at) : '--'}</strong>
          </div>
          <div className="dash-time-metric">
            <span>Break</span>
            <strong>{openBreak ? formatTime(openBreak.started_at) : 'None open'}</strong>
          </div>
          <div className="dash-time-metric">
            <span>Worksites</span>
            <strong>{status.locations.length}</strong>
          </div>
        </div>
      )}

      {message && <div className="dash-time-message">{message}</div>}

      {status && (
        <div className="dash-time-actions">
          {!openPunch && (
            <button className="btn btn-primary" disabled={!!busy || status.locations.length === 0} onClick={() => void act('clock-in')}>
              {busy === 'clock-in' ? 'Checking...' : 'Clock in'}
            </button>
          )}
          {openPunch && !openBreak && (
            <>
              <button className="btn btn-secondary" disabled={!!busy} onClick={() => void act('start-break')}>
                {busy === 'start-break' ? 'Starting...' : 'Start break'}
              </button>
              <button className="btn btn-primary" disabled={!!busy} onClick={() => void act('clock-out')}>
                {busy === 'clock-out' ? 'Clocking out...' : 'Clock out'}
              </button>
            </>
          )}
          {openBreak && (
            <button className="btn btn-primary" disabled={!!busy} onClick={() => void act('end-break')}>
              {busy === 'end-break' ? 'Ending...' : 'End break'}
            </button>
          )}
        </div>
      )}
    </section>
  );
}

export default function UserDashboardHome() {
  const { slug } = useParams<{ slug: string }>();
  const { user, client, enabledModules } = useUserAuth();
  const navItems = useNavItems();

  if (!user || !client || !slug) return null;

  const isOwner = user.level_number == null || user.level_number === 1;
  const workforceEnabled = enabledModules.some((m) => m.key === 'workforce');

  return (
    <div className="page">
      <header className="page-header">
        <h1 className="page-title">Welcome back, {user.display_name}</h1>
        <p className="muted" style={{ margin: '4px 0 0', fontSize: 13 }}>
          {client.name} · {user.role.label}
        </p>
      </header>

      <section className="tile-row">
        <StatTile label="Role" value={user.role.label} />
        <StatTile label="Modules available" value={navItems.length} />
        <StatTile label="Workspace" value={client.name} />
      </section>

      <WorkforceTimeCard enabled={workforceEnabled} />

      <section>
        <h2 className="section-title">Quick actions</h2>
        <div className="tile-row">
          {navItems.map((item) => (
            <Link key={item.moduleKey} to={item.href} className="card tile tile-link">
              <div className="tile-title">{item.label}</div>
              <div className="tile-sub">Open module</div>
            </Link>
          ))}
          {isOwner && (
            <>
              <Link to={`/c/${slug}/team`} className="card tile tile-link">
                <div className="tile-title">Manage team</div>
                <div className="tile-sub">Add, edit, and remove users in your workspace.</div>
              </Link>
              <StubTile title="Settings" description="Configure workspace preferences and integrations." />
            </>
          )}
        </div>
      </section>
    </div>
  );
}
