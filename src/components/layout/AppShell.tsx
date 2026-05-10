import React from 'react';
import { Outlet, useLocation } from 'react-router-dom';
import { Sidebar } from './Sidebar';
import { TopBar } from './TopBar';

const PAGE_TITLES: Record<string, string> = {
  '/': 'Dashboard',
  '/leads': 'Leads',
  '/deals': 'Deals',
  '/projects': 'Projects',
  '/payments': 'Payments & Paperwork',
  '/meetings': 'Setter Meetings',
  '/team': 'Team & Availability',
  '/finance': 'Finance & Commissions',
  '/admin': 'User Management',
};

export const AppShell: React.FC = () => {
  const location = useLocation();

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
          <Outlet />
        </div>
      </main>
    </div>
  );
};
