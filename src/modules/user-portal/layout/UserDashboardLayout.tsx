import { Outlet } from 'react-router-dom';
import { AppShell } from '../../../components/ui/AppShell';
import { Sidebar } from './Sidebar';
import { TopBar } from './TopBar';
import { ImpersonationBanner } from './ImpersonationBanner';

export function UserDashboardLayout() {
  return (
    <AppShell navigation={<Sidebar />} banner={<ImpersonationBanner />} header={<TopBar />}>
      <Outlet />
    </AppShell>
  );
}
