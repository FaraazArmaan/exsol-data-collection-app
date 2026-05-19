export function renderImpersonationBanner(impersonation) {
  const existing = document.getElementById('impersonation-banner');
  if (existing) existing.remove();
  if (!impersonation) {
    document.body.classList.remove('has-impersonation-banner');
    return;
  }

  const expiresAt = new Date(impersonation.expiresAt).getTime();

  const banner = document.createElement('div');
  banner.id = 'impersonation-banner';

  const label = document.createElement('span');
  label.className = 'impersonation-banner__label';
  label.append('Acting as ');
  const target = document.createElement('strong');
  target.textContent = impersonation.targetUserName;
  label.append(target, ' in ');
  const ws = document.createElement('strong');
  ws.textContent = impersonation.workspaceName;
  label.append(ws);
  banner.append(label);

  const reason = document.createElement('span');
  reason.className = 'impersonation-banner__reason';
  reason.textContent = `Reason: ${impersonation.reason}`;
  banner.append(reason);

  const timer = document.createElement('span');
  timer.id = 'impersonation-timer';
  timer.className = 'impersonation-banner__timer';
  timer.textContent = '--:--';
  banner.append(timer);

  const exit = document.createElement('button');
  exit.id = 'impersonation-exit';
  exit.className = 'impersonation-banner__exit';
  exit.textContent = 'Exit';
  banner.append(exit);

  document.body.prepend(banner);
  document.body.classList.add('has-impersonation-banner');

  const update = () => {
    const remaining = expiresAt - Date.now();
    if (remaining <= 0) {
      timer.textContent = 'expired';
      return;
    }
    const mins = Math.floor(remaining / 60_000);
    const secs = Math.floor((remaining % 60_000) / 1000);
    timer.textContent = `${mins}:${secs.toString().padStart(2, '0')} left`;
  };
  update();
  setInterval(update, 1000);

  exit.addEventListener('click', async () => {
    exit.disabled = true;
    await fetch('/api/admin/impersonate', { method: 'DELETE', credentials: 'include' });
    window.location.reload();
  });
}
