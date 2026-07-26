import React, { useState, useEffect, useRef } from 'react';
import { Bell, Search, Calendar, AlertCircle, Clock, CheckCircle2, ChevronRight } from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { ROLE_BADGE, ROLE_LABEL } from '../../utils/badges';
import { api } from '../../api/services';
import { Lead, AdminRequest } from '../../types';
import { useNavigate } from 'react-router-dom';

export interface NotificationItem {
  id: string;
  title: string;
  subtitle: string;
  type: 'overdue' | 'today' | 'request';
  link: string;
}

export const TopBar: React.FC<{ title: string }> = ({ title }) => {
  const { role, user } = useAuth();
  const navigate = useNavigate();
  const [isOpen, setIsOpen] = useState(false);
  const [notifications, setNotifications] = useState<NotificationItem[]>([]);
  const popoverRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const fetchNotifications = async () => {
      if (!user || !role) return;
      try {
        const todayStr = new Date().toISOString().split('T')[0];
        const items: NotificationItem[] = [];

        // Fetch leads assigned/visible to user
        const leads: Lead[] = await api.leads.getAll(role, user.id).catch(() => []);
        
        leads.forEach(lead => {
          if (lead.nextFollowUp) {
            if (lead.nextFollowUp < todayStr) {
              items.push({
                id: `followup-overdue-${lead.id}`,
                title: `Overdue Follow-up: ${lead.name}`,
                subtitle: `Scheduled for ${lead.nextFollowUp}`,
                type: 'overdue',
                link: `/leads/${lead.id}`
              });
            } else if (lead.nextFollowUp === todayStr) {
              items.push({
                id: `followup-today-${lead.id}`,
                title: `Follow-up Due Today: ${lead.name}`,
                subtitle: `Scheduled for today`,
                type: 'today',
                link: `/leads/${lead.id}`
              });
            }
          }
        });

        // Admin requests for Admins
        if (role === 'SUPER_ADMIN' || role === 'ADMIN') {
          const requests: AdminRequest[] = await api.adminRequests.getAll().catch(() => []);
          const pending = requests.filter(r => r.status === 'Pending');
          pending.forEach(req => {
            items.push({
              id: `req-${req.id}`,
              title: `Pending ${req.type.toUpperCase()} Request`,
              subtitle: `Requested by team member`,
              type: 'request',
              link: '/admin'
            });
          });
        }

        setNotifications(items);
      } catch (err) {
        console.error('Failed to fetch notifications:', err);
      }
    };

    fetchNotifications();
    const interval = setInterval(fetchNotifications, 60000); // refresh every minute
    return () => clearInterval(interval);
  }, [user, role]);

  // Close popover on click outside
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (popoverRef.current && !popoverRef.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const overdueCount = notifications.filter(n => n.type === 'overdue').length;
  const todayCount = notifications.filter(n => n.type === 'today').length;

  return (
    <div className="h-16 bg-white border-b border-[#DFDFDF] flex items-center justify-between px-8 fixed top-0 right-0 left-[260px] z-20">
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

        {/* Notification Bell with Dropdown */}
        <div className="relative" ref={popoverRef}>
          <button 
            onClick={() => setIsOpen(!isOpen)}
            className={`relative p-2 rounded-[6px] transition-all group ${isOpen ? 'bg-black/5' : 'hover:bg-[#F9F9F9]'}`}
            title="Notifications & Reminders"
          >
            <Bell className="w-4 h-4 text-[#161616]/60 group-hover:text-[#161616] transition-colors" />
            {notifications.length > 0 && (
              <span className={`absolute top-1 right-1 min-w-[14px] h-[14px] px-1 flex items-center justify-center text-[9px] font-black text-white rounded-full ${overdueCount > 0 ? 'bg-red-500 animate-pulse' : 'bg-[#161616]'}`}>
                {notifications.length}
              </span>
            )}
          </button>

          {/* Notification Dropdown Panel */}
          {isOpen && (
            <div className="absolute right-0 mt-2 w-80 bg-white border border-[#DFDFDF] rounded-[8px] shadow-2xl z-50 overflow-hidden animate-in fade-in slide-in-from-top-2 duration-150">
              <div className="p-4 bg-[#161616] text-white flex items-center justify-between">
                <div>
                  <h3 className="text-xs font-black uppercase tracking-widest text-white/90">Notifications</h3>
                  <p className="text-[10px] text-white/40 mt-0.5 font-medium">
                    {overdueCount > 0 ? `${overdueCount} Overdue follow-up(s)` : `${notifications.length} Active alert(s)`}
                  </p>
                </div>
                <span className="text-[10px] font-bold bg-white/10 px-2 py-0.5 rounded text-white/80">
                  {notifications.length} New
                </span>
              </div>

              <div className="max-h-[320px] overflow-y-auto divide-y divide-[#DFDFDF]/50">
                {notifications.length === 0 ? (
                  <div className="p-6 text-center text-xs text-[#161616]/40 font-medium flex flex-col items-center gap-2">
                    <CheckCircle2 className="w-6 h-6 text-green-500 opacity-60" />
                    You are all caught up! No due reminders.
                  </div>
                ) : (
                  notifications.map(item => (
                    <div 
                      key={item.id}
                      onClick={() => {
                        setIsOpen(false);
                        navigate(item.link);
                      }}
                      className="p-3.5 hover:bg-[#F9F9F9] transition-all cursor-pointer flex items-center justify-between group"
                    >
                      <div className="flex items-start gap-3">
                        {item.type === 'overdue' && (
                          <div className="p-1.5 rounded bg-red-50 border border-red-100 text-red-600 mt-0.5">
                            <AlertCircle className="w-3.5 h-3.5" />
                          </div>
                        )}
                        {item.type === 'today' && (
                          <div className="p-1.5 rounded bg-amber-50 border border-amber-100 text-amber-600 mt-0.5">
                            <Clock className="w-3.5 h-3.5" />
                          </div>
                        )}
                        {item.type === 'request' && (
                          <div className="p-1.5 rounded bg-blue-50 border border-blue-100 text-blue-600 mt-0.5">
                            <Calendar className="w-3.5 h-3.5" />
                          </div>
                        )}
                        <div>
                          <p className="text-xs font-bold text-[#161616] group-hover:text-black tracking-tight">{item.title}</p>
                          <p className="text-[10px] text-[#161616]/50 font-medium mt-0.5">{item.subtitle}</p>
                        </div>
                      </div>
                      <ChevronRight className="w-3.5 h-3.5 text-[#161616]/20 group-hover:text-[#161616]/60 transition-colors" />
                    </div>
                  ))
                )}
              </div>
            </div>
          )}
        </div>

        {/* Role badge — monochromatic */}
        <span className={`text-[10px] font-bold px-2.5 py-1 rounded-[3px] uppercase tracking-wider ${role ? ROLE_BADGE[role] : 'border border-[#DFDFDF] text-[#161616]/50'}`}>
          {role ? (ROLE_LABEL[role] || role) : ''}
        </span>
      </div>
    </div>
  );
};

