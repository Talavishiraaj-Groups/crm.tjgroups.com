import React, { useState, useEffect, useRef, useCallback } from 'react';
import { Bell, Calendar, AlertCircle, Clock, CheckCircle2, ChevronRight, Mail } from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { ROLE_BADGE, ROLE_LABEL } from '../../utils/badges';
import { api } from '../../api/services';
import { Lead, AdminRequest } from '../../types';
import { useNavigate } from 'react-router-dom';

export interface NotificationItem {
  id: string;
  title: string;
  subtitle: string;
  type: 'overdue' | 'today' | 'request' | 'email_sent_today' | 'email_received' | 'followup_stale';
  link: string;
}

export const TopBar: React.FC<{ title: string }> = ({ title }) => {
  const { role, user } = useAuth();
  const navigate = useNavigate();
  const [isOpen, setIsOpen] = useState(false);
  const [notifications, setNotifications] = useState<NotificationItem[]>([]);
  const popoverRef = useRef<HTMLDivElement>(null);

  const fetchNotifications = useCallback(async () => {
    if (!user || !role) return;
    try {
      const todayStr = new Date().toISOString().split('T')[0];
      // Midnight today, as an instant, so the server can discard older rows
      // before it does any other work.
      const since = new Date(`${todayStr}T00:00:00`).toISOString();

      const got = await api.batch([
        { key: 'leads', action: 'getLeads' },
        // Today's outbound email across every lead the caller can see, in one
        // read. This used to be ONE REQUEST PER LEAD inside a loop — 183
        // requests a minute, forever, against a free-tier backend with a daily
        // runtime budget. It was by far the most expensive thing in the app,
        // and it ran on every screen because this bar is in the shell.
        { key: 'emailLogs', action: 'getLogs', payload: { logAction: 'EMAIL,EMAIL_SENT', since } },
        // Replies that arrived while nobody was looking. This is the one
        // notification people actually need: a client got in touch.
        { key: 'replies', action: 'getLogs', payload: { logAction: 'EMAIL_RECEIVED', since } },
        { key: 'requests', action: 'getAdminRequests' },
        // Who is responsible for each lead. Rides the existing batch, so it
        // costs no extra round trip — and without it a Super Admin sees
        // "Reply from Acme" across the whole organisation with no idea whose
        // desk it belongs on.
        { key: 'users', action: 'getUsers' },
      ]);

      const leads = got.get<Record<string, unknown>[]>('leads', []).map(api.map.lead);
      const emailLogs = got.get<Record<string, unknown>[]>('emailLogs', []).map(api.map.log);

      // Which leads had mail sent today — resolved once, then looked up.
      const emailedToday = new Set(
        emailLogs
          .filter(l => l.timestamp?.startsWith(todayStr))
          .map(l => l.entityId)
      );

      const users = got.get<Record<string, unknown>[]>('users', []).map(api.map.user);
      const userById = new Map(users.map((u) => [u.id, u]));

      /**
       * The person answerable for a lead, by name.
       *
       * Owner first, then setter, then closer — the owner is who the lead
       * belongs to, the others are who is working it. Falls back to the
       * username when no display name has been filled in, and to nothing at
       * all rather than printing "Unassigned" where a name should be.
       */
      const responsibleFor = (lead: { ownerRepId?: string; setterId?: string; closerId?: string }) => {
        const id = lead.ownerRepId || lead.setterId || lead.closerId;
        if (!id) return '';
        const u = userById.get(id);
        if (!u) return '';
        return u.displayName || u.username || '';
      };

      /** "Acme Ltd · Dolapo Busari", or just the lead when nobody is assigned. */
      const withOwner = (leadName: string, lead: Parameters<typeof responsibleFor>[0]) => {
        const who = responsibleFor(lead);
        return who ? `${leadName} · ${who}` : leadName;
      };

      const items: NotificationItem[] = [];

      // A reply from a client comes first — it is the only item here that
      // someone outside the company initiated, and the only one with a
      // counterparty waiting on an answer.
      const leadById = new Map(leads.map((l) => [l.id, l]));
      for (const entry of got.get<Record<string, unknown>[]>('replies', []).map(api.map.log)) {
        const lead = leadById.get(entry.entityId);
        if (!lead) continue;
        items.push({
          id: `reply-${entry.id}`,
          title: `Reply from ${withOwner(lead.name, lead)}`,
          subtitle: entry.details || 'A new message is waiting.',
          type: 'email_received',
          link: `/leads/${lead.id}`,
        });
      }

      // Follow-ups that have been sitting overdue for more than a day. An
      // overdue date on its own is noise by the second day; one that has been
      // ignored for 24 hours is a decision someone has quietly not made.
      const dayAgo = Date.now() - 24 * 60 * 60 * 1000;
      for (const lead of leads) {
        if (!lead.nextFollowUp || lead.nextFollowUp >= todayStr) continue;
        if (lead.followUpStatus === 'Completed') continue;
        const due = Date.parse(`${lead.nextFollowUp}T23:59:59`);
        if (Number.isNaN(due) || due > dayAgo) continue;
        items.push({
          id: `stale-${lead.id}`,
          title: `${withOwner(lead.name, lead)}: follow-up over 24h overdue`,
          // Moving the date now requires a reason, so this says what will
          // actually be asked rather than leaving it as a suggestion.
          subtitle: lead.followUpDelayReason
            ? `Explained: ${lead.followUpDelayReason}`
            : 'Log what happened, or set a new date — you will be asked why.',
          type: 'followup_stale',
          link: `/leads/${lead.id}`,
        });
      }

      for (const lead of leads) {
        if (lead.nextFollowUp) {
          if (lead.nextFollowUp < todayStr) {
            items.push({
              id: `followup-overdue-${lead.id}`,
              title: `Overdue Follow-up: ${withOwner(lead.name, lead)}`,
              subtitle: `Scheduled for ${lead.nextFollowUp}`,
              type: 'overdue',
              link: `/leads/${lead.id}`
            });
          } else if (lead.nextFollowUp === todayStr) {
            items.push({
              id: `followup-today-${lead.id}`,
              title: `Follow-up Due Today: ${withOwner(lead.name, lead)}`,
              subtitle: `Scheduled for today`,
              type: 'today',
              link: `/leads/${lead.id}`
            });
          }
        }

        if (emailedToday.has(lead.id) && (!lead.nextFollowUp || lead.nextFollowUp <= todayStr)) {
          items.push({
            id: `email-sent-today-${lead.id}`,
            title: `Email Sent Today: ${lead.name}`,
            subtitle: `Mandatory: Set follow-up date (Max 3 days)`,
            type: 'email_sent_today',
            link: `/leads/${lead.id}`
          });
        }
      }

      if (role === 'SUPER_ADMIN' || role === 'ADMIN') {
        const requests = got.get<Record<string, unknown>[]>('requests', []).map(api.map.adminRequest);
        for (const req of requests.filter((r: AdminRequest) => r.status === 'Pending')) {
          items.push({
            id: `req-${req.id}`,
            title: `Pending ${req.type.toUpperCase()} Request`,
            // "Requested by team member" told an approver nothing they could
            // act on. The whole point of the queue is knowing whose request
            // is waiting.
            subtitle: (() => {
              const u = userById.get(req.requestedBy);
              const who = u ? (u.displayName || u.username) : '';
              return who ? `Requested by ${who}` : 'Requested by a team member';
            })(),
            type: 'request',
            link: '/admin'
          });
        }
      }

      setNotifications(items);
    } catch (err) {
      console.error('Failed to fetch notifications:', err);
    }
  }, [user, role]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    fetchNotifications();

    // Polling costs real budget: this backend has a daily runtime allowance
    // shared by everyone signed in. A badge does not need minute-accuracy, and
    // a tab nobody is looking at does not need refreshing at all.
    const POLL_MS = 5 * 60 * 1000;

    const tick = () => {
      if (document.visibilityState === 'visible') fetchNotifications();
    };
    const interval = setInterval(tick, POLL_MS);

    // Coming back to the tab is exactly when stale numbers are noticed, so
    // refresh then rather than waiting out the rest of the interval.
    const onVisible = () => {
      if (document.visibilityState === 'visible') fetchNotifications();
    };
    document.addEventListener('visibilitychange', onVisible);

    return () => {
      clearInterval(interval);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [fetchNotifications]);

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
        {/* A global search box used to sit here. It had no handler at all —
            typing did nothing — so it was removed rather than left as a
            control that looks functional and is not. The Leads and Deals
            pages have working search of their own. */}

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
                        {item.type === 'email_sent_today' && (
                          <div className="p-1.5 rounded bg-[#161616] text-white mt-0.5 shadow-sm animate-pulse">
                            <Mail className="w-3.5 h-3.5 text-white" />
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

