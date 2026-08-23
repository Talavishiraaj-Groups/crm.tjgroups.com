import React, { useState } from 'react';
import { Outlet, useLocation } from 'react-router-dom';
import { Sidebar } from './Sidebar';
import { TopBar } from './TopBar';
import { ApiHealthBanner } from '../ui/ApiHealthBanner';
import { EnvironmentBanner } from '../ui/EnvironmentBanner';
import { ChangePasswordModal } from '../auth/ChangePasswordModal';
import { useAuth } from '../../context/AuthContext';

const PAGE_TITLES: Record<string, string> = {
  '/': 'Dashboard',
  '/leads': 'Leads',
  '/deals': 'Deals',
  '/projects': 'Projects',
  '/payments': 'Payments & Paperwork',
  '/meetings': 'Setter Meetings',
  '/daily-logs': 'Daily Contribution Logs',
  '/team': 'Team & Availability',
  '/finance': 'Finance & Commissions',
  '/admin': 'User Management',
  '/insights': 'Insights & Productivity',
  '/deleted-leads': 'Deleted Leads',
};

export const AppShell: React.FC = () => {
  const location = useLocation();
  const { user, refreshUser } = useAuth();

  // Dismissed only after an actual change. A flagged account keeps seeing
  // this on every page until the password is replaced — the flag exists
  // because the old value was readable by other people, and a prompt anyone
  // can click past would not address that.
  const [changed, setChanged] = useState(false);
  const mustChange = Boolean(user?.mustChangePassword) && !changed;

  const getTitle = (path: string) => {
    // Exact match
    if (PAGE_TITLES[path]) return PAGE_TITLES[path];
    // Prefix match (e.g. /leads/l1)
    const prefix = '/' + path.split('/')[1];
    if (PAGE_TITLES[prefix]) return PAGE_TITLES[prefix];
    return 'Dashboard';
  };

  return (
    <div className="flex min-h-screen bg-[#F9F9F9]">
      <Sidebar />
      <main className="flex-1 ml-[260px]">
        <TopBar title={getTitle(location.pathname)} />
        <div className="p-8 mt-16">
          <EnvironmentBanner />
          <ApiHealthBanner />
          <Outlet />
        </div>
      </main>

      {mustChange && (
        <ChangePasswordModal
          required
          onDone={() => {
            setChanged(true);
            // Re-read the user so the flag clears for this session too.
            refreshUser().catch(() => {});
          }}
        />
      )}
    </div>
  );
};
