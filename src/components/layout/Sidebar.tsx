import React from 'react';
import { NavLink, useNavigate } from 'react-router-dom';
import {
  LayoutDashboard,
  Users,
  Briefcase,
  FileText,
  CheckSquare,
  UserCircle,
  DollarSign,
  ShieldCheck,
  LogOut,
  BookOpen
} from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import logo from '../../assets/tjgroups-logo-dark.png';

const navItems = [
  { name: 'Dashboard', icon: LayoutDashboard, path: '/', roles: ['SUPER_ADMIN', 'ADMIN', 'SALES_REP'], exact: true },
  { name: 'Leads', icon: Users, path: '/leads', roles: ['SUPER_ADMIN', 'ADMIN', 'SALES_REP'] },
  { name: 'Deals', icon: Briefcase, path: '/deals', roles: ['SUPER_ADMIN', 'ADMIN', 'SALES_REP'] },
  { name: 'Projects', icon: CheckSquare, path: '/projects', roles: ['SUPER_ADMIN', 'ADMIN', 'SALES_REP'] },
  { name: 'Payments', icon: FileText, path: '/payments', roles: ['SUPER_ADMIN', 'ADMIN', 'SALES_REP'] },
  { name: 'Team', icon: UserCircle, path: '/team', roles: ['SUPER_ADMIN', 'ADMIN'] },
  { name: 'Finance', icon: DollarSign, path: '/finance', roles: ['SUPER_ADMIN'] },
  { name: 'Admin', icon: ShieldCheck, path: '/admin', roles: ['SUPER_ADMIN'] },
  { name: 'Guide', icon: BookOpen, path: '/guide', roles: ['SUPER_ADMIN', 'ADMIN', 'SALES_REP'] },
];

const roleLabel: Record<string, string> = {
  SUPER_ADMIN: 'Super Admin',
  ADMIN: 'Administrator',
  SALES_REP: 'Sales Rep',
};

export const Sidebar: React.FC = () => {
  const { role, user, logout } = useAuth();
  const navigate = useNavigate();

  const handleLogout = () => {
    logout();
    navigate('/login');
  };

  const filtered = navItems.filter((item) => item.roles.includes(role || ''));

  return (
    <div className="w-[260px] h-screen bg-white border-r border-[#DFDFDF] flex flex-col fixed left-0 top-0 z-20">
      {/* Logo */}
      <div className="flex items-center px-6 h-16 border-b border-[#DFDFDF]">
        <img src={logo} alt="TJGROPS" className="h-8 w-auto" />
      </div>

      {/* Nav */}
      <nav className="flex-1 px-3 py-4 flex flex-col gap-1 overflow-y-auto">
        {filtered.map((item) => (
          <NavLink
            key={item.path}
            to={item.path}
            end={item.exact}
            className={({ isActive }) =>
              `flex items-center gap-3 px-3 py-2.5 rounded-[6px] text-sm font-medium transition-all ${
                isActive
                  ? 'bg-[#161616] text-white'
                  : 'text-[#161616]/60 hover:bg-[#F9F9F9] hover:text-[#161616]'
              }`
            }
          >
            <item.icon className="w-4 h-4 shrink-0" />
            {item.name}
          </NavLink>
        ))}
      </nav>

      {/* User + Logout */}
      <div className="border-t border-[#DFDFDF] p-4">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-full bg-[#161616] text-white flex items-center justify-center text-xs font-bold shrink-0">
            {user?.username?.[0]?.toUpperCase() || '?'}
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-xs font-bold text-[#161616] truncate">{user?.username}</p>
            <p className="text-[10px] text-[#161616]/40">{roleLabel[role || ''] || role}</p>
          </div>
          <button
            onClick={handleLogout}
            className="p-1.5 rounded-[6px] hover:bg-[#F9F9F9] text-[#161616]/40 hover:text-red-500 transition-all"
            title="Logout"
          >
            <LogOut className="w-4 h-4" />
          </button>
        </div>
      </div>
    </div>
  );
};
