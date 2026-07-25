import React, { useState } from 'react';
import { CheckCircle, History, ChevronLeft, ChevronRight, ClipboardCheck, AlertCircle, Calendar, Filter, Search } from 'lucide-react';
import { Log, User, UserRole } from '../types';
import { ROLE_LABEL } from '../utils/badges';

interface DailyLogsTabProps {
  logs: Log[];
  allUsers: User[];
  currentUser: User | null;
  currentUserRole: UserRole | null;
  hasLoggedToday: boolean;
  dailyNote: string;
  setDailyNote: (v: string) => void;
  isLoggingDaily: boolean;
  onSubmitLog: () => Promise<void>;
}

function formatDate(d: Date) {
  return d.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' });
}
function formatMonthYear(d: Date) {
  return d.toLocaleDateString('en-GB', { month: 'long', year: 'numeric' });
}
function isSameDay(a: Date, b: Date) {
  return a.toDateString() === b.toDateString();
}
function isSameMonth(a: Date, b: Date) {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth();
}

export const DailyLogsTab: React.FC<DailyLogsTabProps> = ({
  logs, allUsers, currentUser, currentUserRole, hasLoggedToday,
  dailyNote, setDailyNote, isLoggingDaily, onSubmitLog,
}) => {
  const isAdmin = currentUserRole === 'SUPER_ADMIN' || currentUserRole === 'ADMIN';

  // Filters state
  const [viewMode, setViewMode] = useState<'day' | 'month'>('day');
  const [viewDate, setViewDate] = useState(new Date());
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedUser, setSelectedUser] = useState<string>('all');
  const [selectedRole, setSelectedRole] = useState<string>('all');

  const today = new Date();
  const isToday = isSameDay(viewDate, today);
  const isCurrentMonth = isSameMonth(viewDate, today);

  // Time navigation
  const goBack = () => {
    const d = new Date(viewDate);
    if (viewMode === 'day') {
      d.setDate(d.getDate() - 1);
    } else {
      d.setMonth(d.getMonth() - 1);
    }
    setViewDate(d);
  };

  const goForward = () => {
    if (viewMode === 'day' && isToday) return;
    if (viewMode === 'month' && isCurrentMonth) return;

    const d = new Date(viewDate);
    if (viewMode === 'day') {
      d.setDate(d.getDate() + 1);
    } else {
      d.setMonth(d.getMonth() + 1);
    }
    setViewDate(d);
  };

  // Base list of daily logs
  const baseLogs = logs.filter(l => l.action === 'DAILY_LOG');

  // Filter by date (day or month)
  const dateFilteredLogs = baseLogs.filter(l => {
    const logDate = new Date(l.timestamp);
    if (viewMode === 'day') {
      return isSameDay(logDate, viewDate);
    } else {
      return isSameMonth(logDate, viewDate);
    }
  });

  // Filter by user, role, and search query
  const getUser = (userId: string) => allUsers.find(u => u.id === userId || u.username === userId);

  const filteredLogs = dateFilteredLogs.filter(log => {
    const foundUser = getUser(log.userId);
    
    // User Filter
    if (selectedUser !== 'all' && log.userId !== selectedUser) return false;

    // Role Filter
    if (selectedRole !== 'all' && foundUser?.role !== selectedRole) return false;

    // Search Query
    if (searchQuery.trim()) {
      const query = searchQuery.toLowerCase();
      const content = log.details.toLowerCase();
      const uname = foundUser?.username.toLowerCase() || '';
      if (!content.includes(query) && !uname.includes(query)) return false;
    }

    return true;
  });

  // Sort: Latest first
  filteredLogs.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());

  // Statistics & coverage
  const activeUsers = allUsers.filter(u => u.status === 'Active');
  const loggedUserIds = new Set(
    baseLogs.filter(l => isSameDay(new Date(l.timestamp), today)).map(l => l.userId)
  );
  const notLoggedYet = activeUsers.filter(u => !loggedUserIds.has(u.id));

  // Grouping logs by day (Only for Month mode)
  const groupedByDay: Record<string, Log[]> = {};
  if (viewMode === 'month') {
    filteredLogs.forEach(log => {
      const dateStr = new Date(log.timestamp).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', weekday: 'short' });
      if (!groupedByDay[dateStr]) groupedByDay[dateStr] = [];
      groupedByDay[dateStr].push(log);
    });
  }

  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
      {/* Left panel: Log summary form & coverage stats */}
      <div className="space-y-5">
        <div className="bg-[#161616] rounded-[10px] p-6 text-white shadow-xl">
          <h3 className="text-[10px] font-black text-white/30 uppercase tracking-[0.25em] mb-5">My Daily Contribution</h3>
          {!hasLoggedToday ? (
            <div className="space-y-3">
              <textarea
                placeholder="What did you accomplish today? Key calls, wins, blockers..."
                className="w-full bg-white/5 border border-white/10 rounded-[6px] p-4 text-sm font-medium focus:outline-none focus:border-white/30 transition-all resize-none text-white placeholder:text-white/20 h-36"
                value={dailyNote} onChange={e => setDailyNote(e.target.value)}
              />
              <div className="flex justify-between items-center">
                <span className="text-[10px] text-white/25 font-medium">{dailyNote.length} chars</span>
                <span className="text-[9px] text-white/10 font-medium">One log per day</span>
              </div>
              <button
                onClick={onSubmitLog}
                disabled={isLoggingDaily || !dailyNote.trim()}
                className="w-full bg-white text-[#161616] py-3.5 rounded-[6px] text-[11px] font-black uppercase tracking-[0.2em] hover:bg-[#F9F9F9] transition-all disabled:opacity-30 shadow-lg"
              >
                {isLoggingDaily ? 'Submitting…' : 'Log Daily Summary'}
              </button>
            </div>
          ) : (
            <div className="flex flex-col items-center py-6 text-center gap-4">
              <div className="w-14 h-14 rounded-full bg-green-500/20 flex items-center justify-center">
                <CheckCircle className="w-7 h-7 text-green-400" />
              </div>
              <div>
                <p className="text-sm font-black text-white uppercase tracking-widest mb-1">Logged ✓</p>
                <p className="text-[10px] text-white/30 font-medium">Your summary for today is recorded.</p>
              </div>
            </div>
          )}
        </div>

        {isToday && (
          <div className="bg-white border border-[#DFDFDF] rounded-[10px] overflow-hidden">
            <div className="px-5 py-3.5 border-b border-[#DFDFDF] bg-[#F9F9F9]">
              <p className="text-[10px] font-black text-[#161616]/30 uppercase tracking-widest flex items-center gap-1.5">
                <ClipboardCheck className="w-3.5 h-3.5" /> Team Coverage Today
              </p>
            </div>
            <div className="p-4 space-y-3">
              <div className="flex items-center justify-between text-[11px]">
                <span className="font-bold text-[#161616]/40 uppercase tracking-wider">Submitted</span>
                <span className="font-black text-green-600">{loggedUserIds.size} / {activeUsers.length}</span>
              </div>
              <div className="w-full h-2 bg-[#F9F9F9] rounded-full overflow-hidden border border-[#DFDFDF]">
                <div
                  className="h-full bg-green-500 rounded-full transition-all duration-500"
                  style={{ width: `${activeUsers.length ? (loggedUserIds.size / activeUsers.length) * 100 : 0}%` }}
                />
              </div>
              {notLoggedYet.length > 0 && (
                <div className="pt-1">
                  <p className="text-[9px] font-black text-[#161616]/25 uppercase tracking-widest mb-2 flex items-center gap-1">
                    <AlertCircle className="w-3 h-3" /> Not yet ({notLoggedYet.length})
                  </p>
                  <div className="flex flex-wrap gap-1">
                    {notLoggedYet.map(u => (
                      <span key={u.id} className="px-2 py-0.5 bg-[#F9F9F9] border border-[#DFDFDF] rounded-full text-[9px] font-bold text-[#161616]/40">
                        @{u.username}
                      </span>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </div>
        )}
      </div>

      {/* Right panel: Log Feed & Date navigation / Filters */}
      <div className="lg:col-span-2 space-y-4">
        {/* Filters and Controls */}
        <div className="bg-white border border-[#DFDFDF] rounded-[10px] p-5 shadow-sm space-y-4">
          <div className="flex flex-col md:flex-row gap-4 items-start md:items-center justify-between">
            {/* View Mode (Admins only) */}
            <div className="flex bg-[#F9F9F9] border border-[#DFDFDF] p-0.5 rounded-[6px]">
              <button
                type="button"
                onClick={() => { setViewMode('day'); setViewDate(new Date()); }}
                className={`px-3 py-1.5 rounded-[4px] text-[10px] font-bold uppercase tracking-wider transition-all cursor-pointer ${viewMode === 'day' ? 'bg-white shadow-sm text-[#161616]' : 'text-[#161616]/40 hover:text-[#161616]/60'}`}
              >
                Day Wise
              </button>
              {isAdmin && (
                <button
                  type="button"
                  onClick={() => { setViewMode('month'); setViewDate(new Date()); }}
                  className={`px-3 py-1.5 rounded-[4px] text-[10px] font-bold uppercase tracking-wider transition-all cursor-pointer ${viewMode === 'month' ? 'bg-white shadow-sm text-[#161616]' : 'text-[#161616]/40 hover:text-[#161616]/60'}`}
                >
                  Month Wise
                </button>
              )}
            </div>

            {/* Date Picker / Navigator */}
            <div className="flex items-center gap-1.5">
              <button onClick={goBack} className="w-7 h-7 flex items-center justify-center rounded-[4px] border border-[#DFDFDF] hover:bg-[#EBEBEB] transition-all text-[#161616]/40 cursor-pointer">
                <ChevronLeft className="w-3.5 h-3.5" />
              </button>
              <span className="text-[10px] font-black text-[#161616] px-3 min-w-[120px] text-center uppercase tracking-wide">
                {viewMode === 'day'
                  ? (isToday ? '— Today —' : formatDate(viewDate))
                  : (isCurrentMonth ? `— ${formatMonthYear(viewDate)} (Current) —` : formatMonthYear(viewDate))
                }
              </span>
              <button
                onClick={goForward}
                disabled={viewMode === 'day' ? isToday : isCurrentMonth}
                className="w-7 h-7 flex items-center justify-center rounded-[4px] border border-[#DFDFDF] hover:bg-[#EBEBEB] transition-all text-[#161616]/40 disabled:opacity-20 disabled:cursor-not-allowed cursor-pointer"
              >
                <ChevronRight className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>

          {/* Detailed Filters (Admin/Super Admin only) */}
          {isAdmin && (
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3 pt-3 border-t border-[#DFDFDF]">
              {/* Search */}
              <div className="relative flex items-center">
                <Search className="absolute left-2.5 w-3.5 h-3.5 text-[#161616]/30" />
                <input
                  type="text"
                  placeholder="Search logs or usernames..."
                  value={searchQuery}
                  onChange={e => setSearchQuery(e.target.value)}
                  className="w-full pl-8 pr-3 py-1.5 bg-[#F9F9F9] border border-[#DFDFDF] rounded-[6px] text-xs font-bold text-[#161616] focus:outline-none focus:border-[#161616]/40"
                />
              </div>

              {/* User filter */}
              <div className="relative">
                <select
                  value={selectedUser}
                  onChange={e => setSelectedUser(e.target.value)}
                  className="w-full px-3 py-1.5 bg-[#F9F9F9] border border-[#DFDFDF] rounded-[6px] text-xs font-bold text-[#161616] focus:outline-none focus:border-[#161616]/40 cursor-pointer appearance-none"
                >
                  <option value="all">Filter: All Team Members</option>
                  {activeUsers.map(u => (
                    <option key={u.id} value={u.id}>@{u.username}</option>
                  ))}
                </select>
              </div>

              {/* Role filter */}
              <div className="relative">
                <select
                  value={selectedRole}
                  onChange={e => setSelectedRole(e.target.value)}
                  className="w-full px-3 py-1.5 bg-[#F9F9F9] border border-[#DFDFDF] rounded-[6px] text-xs font-bold text-[#161616] focus:outline-none focus:border-[#161616]/40 cursor-pointer appearance-none"
                >
                  <option value="all">Filter: All Roles</option>
                  <option value="SUPER_ADMIN">Super Admins</option>
                  <option value="ADMIN">Team Leads / Admins</option>
                  <option value="SALES_REP">Sales Reps</option>
                  <option value="SETTER">Lead Setters</option>
                </select>
              </div>
            </div>
          )}
        </div>

        {/* Logs Feed Display */}
        <div className="bg-white border border-[#DFDFDF] rounded-[10px] overflow-hidden shadow-sm">
          <div className="divide-y divide-[#DFDFDF] max-h-[580px] overflow-y-auto">
            {viewMode === 'day' ? (
              // ── Day wise rendering ──────────────────────────────
              filteredLogs.length === 0 ? (
                <div className="flex flex-col items-center py-20 text-center gap-3">
                  <ClipboardCheck className="w-8 h-8 text-[#DFDFDF]" />
                  <p className="text-sm text-[#161616]/30 italic">No summaries found matching filters on this day.</p>
                </div>
              ) : (
                filteredLogs.map(log => {
                  const foundUser = getUser(log.userId);
                  const initial = foundUser ? foundUser.username[0].toUpperCase() : '?';
                  const username = foundUser ? foundUser.username : log.userId.slice(0, 10);
                  const roleLabel = foundUser ? ROLE_LABEL[foundUser.role] : 'Team Member';
                  const time = new Date(log.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
                  const content = log.details.replace(/^DAILY SUMMARY:\s*/i, '').trim();
                  const isMe = currentUser && (log.userId === currentUser.id || log.userId === currentUser.username);

                  return (
                    <div key={log.id} className={`p-5 hover:bg-[#FAFAFA] transition-colors ${isMe ? 'border-l-2 border-l-[#161616]' : ''}`}>
                      <div className="flex items-start gap-3">
                        <div className="w-9 h-9 rounded-full bg-[#161616] text-white flex items-center justify-center text-[11px] font-black uppercase shrink-0 mt-0.5">
                          {initial}
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-baseline justify-between mb-2">
                            <div className="flex items-center gap-2">
                              <span className="text-xs font-black text-[#161616] uppercase tracking-tight">@{username}</span>
                              {isMe && <span className="text-[8px] font-black bg-[#161616] text-white px-1.5 py-0.5 rounded-[3px] uppercase tracking-wider">You</span>}
                              <span className="text-[9px] font-bold text-[#161616]/25 uppercase tracking-widest">{roleLabel}</span>
                            </div>
                            <span className="text-[10px] font-mono text-[#161616]/20 shrink-0 ml-2">{time}</span>
                          </div>
                          <div className="bg-[#F9F9F9] border border-[#DFDFDF] rounded-[6px] px-4 py-3">
                            <p className="text-sm text-[#161616]/70 leading-relaxed font-medium whitespace-pre-wrap">{content}</p>
                          </div>
                        </div>
                      </div>
                    </div>
                  );
                })
              )
            ) : (
              // ── Month wise rendering ────────────────────────────
              Object.keys(groupedByDay).length === 0 ? (
                <div className="flex flex-col items-center py-20 text-center gap-3">
                  <ClipboardCheck className="w-8 h-8 text-[#DFDFDF]" />
                  <p className="text-sm text-[#161616]/30 italic">No summaries found matching filters in this month.</p>
                </div>
              ) : (
                Object.keys(groupedByDay).map(dateStr => (
                  <div key={dateStr} className="bg-white">
                    {/* Date Subheader */}
                    <div className="px-5 py-2.5 bg-[#F9F9F9] border-b border-[#DFDFDF] flex items-center justify-between">
                      <span className="text-[9px] font-black text-[#161616]/40 uppercase tracking-widest flex items-center gap-1.5">
                        <Calendar className="w-3 h-3 text-[#161616]/30" />
                        {dateStr}
                      </span>
                      <span className="text-[9px] font-bold text-[#161616]/30">{groupedByDay[dateStr].length} logs</span>
                    </div>
                    {/* Month wise logs list */}
                    <div className="divide-y divide-[#DFDFDF]/65">
                      {groupedByDay[dateStr].map(log => {
                        const foundUser = getUser(log.userId);
                        const initial = foundUser ? foundUser.username[0].toUpperCase() : '?';
                        const username = foundUser ? foundUser.username : log.userId.slice(0, 10);
                        const roleLabel = foundUser ? ROLE_LABEL[foundUser.role] : 'Team Member';
                        const time = new Date(log.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
                        const content = log.details.replace(/^DAILY SUMMARY:\s*/i, '').trim();
                        const isMe = currentUser && (log.userId === currentUser.id || log.userId === currentUser.username);

                        return (
                          <div key={log.id} className={`p-5 hover:bg-[#FAFAFA] transition-colors ${isMe ? 'border-l-2 border-l-[#161616]' : ''}`}>
                            <div className="flex items-start gap-3">
                              <div className="w-8 h-8 rounded-full bg-[#161616] text-white flex items-center justify-center text-[10px] font-black uppercase shrink-0 mt-0.5">
                                {initial}
                              </div>
                              <div className="flex-1 min-w-0">
                                <div className="flex items-baseline justify-between mb-2">
                                  <div className="flex items-center gap-2">
                                    <span className="text-xs font-black text-[#161616] uppercase tracking-tight">@{username}</span>
                                    {isMe && <span className="text-[8px] font-black bg-[#161616] text-white px-1.5 py-0.5 rounded-[3px] uppercase tracking-wider">You</span>}
                                    <span className="text-[9px] font-bold text-[#161616]/25 uppercase tracking-widest">{roleLabel}</span>
                                  </div>
                                  <span className="text-[10px] font-mono text-[#161616]/20 shrink-0 ml-2">{time}</span>
                                </div>
                                <div className="bg-[#F9F9F9] border border-[#DFDFDF] rounded-[6px] px-4 py-3">
                                  <p className="text-sm text-[#161616]/70 leading-relaxed font-medium whitespace-pre-wrap">{content}</p>
                                </div>
                              </div>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                ))
              )
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

