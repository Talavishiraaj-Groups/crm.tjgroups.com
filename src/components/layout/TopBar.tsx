import React from 'react';
import { Bell, Search } from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { ROLE_BADGE, ROLE_LABEL } from '../../utils/badges';

export const TopBar: React.FC<{ title: string }> = ({ title }) => {
  const { role } = useAuth();

  return (
    <div className="h-16 bg-white border-b border-[#DFDFDF] flex items-center justify-between px-8 fixed top-0 right-0 left-[260px] z-10">
      <h1 className="text-[15px] font-bold text-[#161616] tracking-tight">{title}</h1>

      <div className="flex items-center gap-4">
        {/* Search */}
        <div className="relative">
          <Search className="w-4 h-4 text-[#161616]/20 absolute left-3 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            placeholder="Search..."
            className="pl-9 pr-4 py-2 bg-[#F9F9F9] border border-[#DFDFDF] rounded-[6px] text-sm focus:outline-none focus:border-[#161616]/30 transition-all w-[200px] text-[#161616] placeholder:text-[#161616]/30"
          />
        </div>

        {/* Notification */}
        <button className="relative p-2 hover:bg-[#F9F9F9] rounded-[6px] transition-all group">
          <Bell className="w-4 h-4 text-[#161616]/30 group-hover:text-[#161616]/60 transition-colors" />
          {/* Subtle dot — not red, just dark */}
          <span className="absolute top-1.5 right-1.5 w-1.5 h-1.5 bg-[#161616] rounded-full opacity-70"></span>
        </button>

        {/* Role badge — monochromatic */}
        <span className={`text-[10px] font-bold px-2.5 py-1 rounded-[3px] uppercase tracking-wider ${role ? ROLE_BADGE[role] : 'border border-[#DFDFDF] text-[#161616]/50'}`}>
          {role ? (ROLE_LABEL[role] || role) : ''}
        </span>
      </div>
    </div>
  );
};
