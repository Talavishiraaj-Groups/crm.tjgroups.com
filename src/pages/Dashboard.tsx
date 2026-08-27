import React, { useState, useEffect, useCallback } from 'react';
import { useAuth } from '../context/AuthContext';
import { 
  Users, Briefcase, TrendingUp, AlertCircle, ArrowRight,
  Clock, Mail, ShieldCheck, ClipboardCheck, Send, CheckCircle2
} from 'lucide-react';
import { api } from '../api/services';
import { useNavigate } from 'react-router-dom';
import { Lead, Deal, Project, AdminRequest, User } from '../types';
import { ZohoConnectButton } from '../components/zoho/ZohoConnectButton';
import { GlobalActivityFeed } from '../components/dashboard/GlobalActivityFeed';

export const Dashboard: React.FC = () => {
  const { role, user } = useAuth();
  const navigate = useNavigate();

  const [myLeads, setMyLeads] = useState<Lead[]>([]);
  const [myDeals, setMyDeals] = useState<Deal[]>([]);
  const [myProjects, setMyProjects] = useState<Project[]>([]);
  const [pendingRequests, setPendingRequests] = useState<AdminRequest[]>([]);
  const [allUsers, setAllUsers] = useState<User[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  
  // Daily Log State
  const [dailyNote, setDailyNote] = useState('');
  const [isLoggingDaily, setIsLoggingDaily] = useState(false);
  const [hasLoggedToday, setHasLoggedToday] = useState(false);

  const fetchData = useCallback(async () => {
    if (!user || !role) return;
    setIsLoading(true);

    try {
      // Six requests became one. On the deployed backend each invocation costs
      // a second or more before it does any work, so this is the difference
      // the user actually notices on a cold dashboard.
      const got = await api.batch([
        { key: 'leads', action: 'getLeads' },
        { key: 'deals', action: 'getDeals' },
        { key: 'projects', action: 'getProjects' },
        { key: 'requests', action: 'getAdminRequests' },
        { key: 'users', action: 'getUsers' },
        // Only the daily summaries. This used to pull every log row in the
        // database and throw almost all of them away in the browser.
        { key: 'dailyLogs', action: 'getLogs', payload: { logAction: 'DAILY_LOG' } },
      ]);

      const leads = got.get<Record<string, unknown>[]>('leads', []).map(api.map.lead);
      const deals = got.get<Record<string, unknown>[]>('deals', []).map(api.map.deal);
      const projects = got.get<Record<string, unknown>[]>('projects', []).map(api.map.project);
      const requests = got.get<Record<string, unknown>[]>('requests', []).map(api.map.adminRequest);
      const usersData = got.get<Record<string, unknown>[]>('users', []).map(api.map.user);
      const dailyLogs = got.get<Record<string, unknown>[]>('dailyLogs', []).map(api.map.log);

      setMyLeads(leads);
      setMyDeals(deals);
      setMyProjects(projects);
      setPendingRequests(requests.filter(r => r.status === 'Pending'));
      setAllUsers(usersData);

      // The only thing this page needs from the log history: whether this
      // person has written today's summary. The full list belongs to the
      // Daily Logs page, which fetches its own.
      const today = new Date().toDateString();
      setHasLoggedToday(dailyLogs.some(l =>
        l.userId === user.id &&
        new Date(l.timestamp).toDateString() === today
      ));
    } catch (err) {
      console.error("Dashboard fetch error:", err);
    } finally {
      setIsLoading(false);
    }
  }, [user, role]);

  useEffect(() => {
    // Loading remote data on mount. State lands after the request resolves,
    // never synchronously inside the effect body.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    fetchData();
  }, [fetchData]);

  const handleDailyLog = async () => {
    if (!dailyNote.trim() || !user) return;
    setIsLoggingDaily(true);
    try {
      await api.logs.create({
        entityId: 'USER_' + user.id,
        entityType: 'User',
        action: 'DAILY_LOG',
        userId: user.id,
        details: `DAILY SUMMARY: ${dailyNote}`
      });
      setDailyNote('');
      setHasLoggedToday(true);
      fetchData();
    } catch (err) {
      console.error(err);
      alert('Failed to log activity: ' + (err instanceof Error ? err.message : 'Unknown error'));
    } finally {
      setIsLoggingDaily(false);
    }
  };

  const isSalesRep = role === 'SALES_REP' || role === 'SETTER';
  const openDealsValue = myDeals.reduce((s, d) => s + (isDealOpen(d.status) ? Number(d.value) : 0), 0);
  
  function isDealOpen(status: string) {
    const s = status.toUpperCase();
    return s === 'OPEN' || s === 'PROPOSAL SENT' || s === 'NEGOTIATION' || s === 'LEAD';
  }

  const activeProjects = myProjects.filter((p) => p.status !== 'Completed').length;
  const hour = new Date().getHours();
  const greeting = hour < 12 ? 'Good Morning' : hour < 17 ? 'Good Afternoon' : 'Good Evening';

  const todayStr = new Date().toISOString().split('T')[0];
  const isFollowUpActive = (l: Lead): l is Lead & { nextFollowUp: string } => {
    if (!l.nextFollowUp || l.followUpStatus === 'Completed') return false;
    if (l.status === 'Closed' || l.status === 'Converted') return false;
    return true;
  };
  const overdueFollowUps = myLeads.filter((l): l is Lead & { nextFollowUp: string } => 
    isFollowUpActive(l) && l.nextFollowUp.split('T')[0] < todayStr
  );
  const todayFollowUps = myLeads.filter((l): l is Lead & { nextFollowUp: string } => 
    isFollowUpActive(l) && l.nextFollowUp.split('T')[0] === todayStr
  );

  const kpis = [
    { label: 'Active Leads', value: myLeads.length, sub: 'Total assigned', path: '/leads', icon: Users },
    { label: 'Open Deals', value: myDeals.filter((d) => isDealOpen(d.status)).length, sub: `$${openDealsValue.toLocaleString()} value`, path: '/deals', icon: Briefcase },
    { label: 'Active Projects', value: activeProjects, sub: 'In delivery', path: '/projects', icon: TrendingUp },
    { label: 'Pending Actions', value: pendingRequests.length, sub: 'Requires review', path: '/payments', icon: AlertCircle },
  ];

  if (isLoading) {
    return (
      <div className="flex flex-col items-center justify-center py-24 gap-4">
        <div className="w-10 h-10 border-2 border-[#161616] border-t-transparent rounded-full animate-spin"></div>
        <p className="text-[10px] font-black text-[#161616]/40 uppercase tracking-[0.2em]">Synchronizing Ecosystem</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-8">
      {/* Top Priority Reminder Alert Banner */}
      {overdueFollowUps.length > 0 && (
        <div className="bg-red-500 text-white p-4 rounded-[8px] flex items-center justify-between shadow-xl animate-in fade-in slide-in-from-top-2 duration-200">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-white/20 rounded-full">
              <AlertCircle className="w-5 h-5 text-white" />
            </div>
            <div>
              <h4 className="text-xs font-black uppercase tracking-widest">Urgent Action Required: {overdueFollowUps.length} Overdue Follow-up(s)</h4>
              <p className="text-[11px] text-white/80 font-medium">You have leads requiring immediate attention. Prioritize reaching out to maintain conversion SLAs.</p>
            </div>
          </div>
          <button 
            onClick={() => navigate('/leads')}
            className="bg-white text-red-600 px-4 py-2 rounded-[4px] text-[10px] font-black uppercase tracking-widest hover:bg-red-50 transition-all cursor-pointer shrink-0"
          >
            Review Leads →
          </button>
        </div>
      )}

      {/* Header Section */}
      <div className="flex justify-between items-end">
        <div>
          <h2 className="text-2xl font-black text-[#161616] tracking-tighter uppercase">{greeting}, {user?.username}</h2>
          <p className="text-xs text-[#161616]/40 mt-1 font-bold tracking-tight uppercase">
            {isSalesRep ? "YOUR PERSONAL PERFORMANCE DATA & PIPELINE" : "TEAM OVERSIGHT & ADMINISTRATIVE ANALYTICS"}
          </p>
        </div>
        <div className="flex flex-col items-end gap-1">
          <div className="text-[10px] font-black text-[#161616] uppercase tracking-widest bg-white px-4 py-2 rounded-[4px] border border-[#DFDFDF] shadow-sm">
            {new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })}
          </div>
          <div className="text-[9px] font-mono text-[#161616]/30 uppercase tracking-tighter">System Version 2.0.4 - Production Hardened</div>
        </div>
      </div>

      {/* KPI Section */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {kpis.map(({ label, value, sub, path, icon: Icon }) => (
          <div
            key={label}
            onClick={() => navigate(path)}
            className="bg-white border border-[#DFDFDF] rounded-[8px] p-6 cursor-pointer hover:border-[#161616] hover:shadow-xl transition-all group relative overflow-hidden"
          >
            <div className="flex justify-between items-start mb-6">
              <span className="text-[10px] font-black text-[#161616]/30 uppercase tracking-[0.15em]">{label}</span>
              <Icon className="w-4 h-4 text-[#161616]/10 group-hover:text-[#161616] transition-all" />
            </div>
            <div className="text-4xl font-black text-[#161616] tracking-tighter tabular-nums">{value}</div>
            <div className="text-[10px] font-bold text-[#161616]/40 mt-3 uppercase tracking-wider">{sub}</div>
            <div className="absolute bottom-0 left-0 w-full h-1 bg-[#161616] opacity-0 group-hover:opacity-100 transition-all scale-x-0 group-hover:scale-x-100"></div>
          </div>
        ))}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Activity & Log Section */}
        <div className="lg:col-span-2 flex flex-col gap-6">
          {/* Priority Follow-ups & Reminders Card */}
          <div className="bg-white border border-[#DFDFDF] rounded-[8px] overflow-hidden shadow-sm">
            <div className="flex justify-between items-center px-6 py-5 border-b border-[#DFDFDF] bg-[#F9F9F9]">
              <div className="flex items-center gap-2">
                <Clock className="w-4 h-4 text-[#161616]/40" />
                <h3 className="text-[11px] font-black text-[#161616] uppercase tracking-[0.2em]">Priority Follow-ups & Reminders</h3>
              </div>
              <span className="text-[9px] font-black px-2 py-0.5 rounded bg-[#161616] text-white uppercase tracking-widest">
                {overdueFollowUps.length + todayFollowUps.length} Pending
              </span>
            </div>
            <div className="p-0 max-h-[300px] overflow-y-auto divide-y divide-[#DFDFDF]">
              {overdueFollowUps.length === 0 && todayFollowUps.length === 0 ? (
                <div className="p-8 text-center text-xs text-[#161616]/40 font-medium flex flex-col items-center gap-2">
                  <CheckCircle2 className="w-6 h-6 text-green-500 opacity-60" />
                  No pending follow-up reminders for today. Great job!
                </div>
              ) : (
                [...overdueFollowUps, ...todayFollowUps].map(lead => {
                  const due = lead.nextFollowUp ? lead.nextFollowUp.split('T')[0] : '';
                  const isOverdue = due && due < todayStr;
                  return (
                    <div 
                      key={lead.id} 
                      className="px-6 py-4 flex items-center justify-between hover:bg-[#F9F9F9] transition-all"
                    >
                      <div className="flex items-center gap-4">
                        <div className={`p-2 rounded-full ${isOverdue ? 'bg-red-50 text-red-600 border border-red-200' : 'bg-amber-50 text-amber-600 border border-amber-200'}`}>
                          <AlertCircle className="w-4 h-4" />
                        </div>
                        <div>
                          <div className="flex items-center gap-2">
                            <h4 className="text-sm font-bold text-[#161616]">{lead.name}</h4>
                            <span className={`px-2 py-0.5 rounded text-[8px] font-black uppercase tracking-wider ${isOverdue ? 'bg-red-500 text-white' : 'bg-amber-500 text-white'}`}>
                              {isOverdue ? `OVERDUE (${due})` : 'DUE TODAY'}
                            </span>
                          </div>
                          <p className="text-[11px] text-[#161616]/50 font-medium mt-0.5">{lead.email} · {lead.phone}</p>
                        </div>
                      </div>
                      <div className="flex items-center gap-2">
                        <button
                          onClick={() => navigate(`/leads/${lead.id}`)}
                          className="flex items-center gap-1 bg-[#161616] text-white px-3 py-1.5 rounded-[4px] text-[10px] font-black uppercase tracking-widest hover:opacity-90 transition-all cursor-pointer"
                        >
                          View Lead <ArrowRight className="w-3 h-3" />
                        </button>
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          </div>

          {/* Daily Summary Box (For Everyone) */}
          {user && (
            <div className={`rounded-[8px] p-6 border transition-all ${hasLoggedToday ? 'bg-[#F9F9F9] border-[#DFDFDF]' : 'bg-[#161616] border-[#161616] shadow-2xl'}`}>
              <div className="flex justify-between items-center mb-5">
                <div className="flex items-center gap-3">
                  <ClipboardCheck className={`w-5 h-5 ${hasLoggedToday ? 'text-[#161616]/30' : 'text-white/40'}`} />
                  <h3 className={`text-[11px] font-black uppercase tracking-[0.2em] ${hasLoggedToday ? 'text-[#161616]/40' : 'text-white'}`}>End of Day Interaction Summary</h3>
                </div>
                {hasLoggedToday && <span className="flex items-center gap-1.5 text-[9px] font-black text-green-600 bg-green-50 px-2.5 py-1 rounded-full border border-green-100 uppercase tracking-widest"><CheckCircle2 className="w-3 h-3" /> SUBMITTED</span>}
              </div>
              {!hasLoggedToday ? (
                <div className="flex flex-col gap-4">
                  <textarea 
                    value={dailyNote} onChange={e => setDailyNote(e.target.value)}
                    placeholder="Summarize your key interactions and achievements for today..."
                    className="w-full bg-white/5 border border-white/10 rounded-[6px] p-4 text-sm text-white focus:outline-none focus:border-white/30 min-h-[80px] resize-none placeholder:text-white/10"
                  />
                  <div className="flex justify-end">
                    <button 
                      onClick={handleDailyLog} disabled={!dailyNote.trim() || isLoggingDaily}
                      className="bg-white text-[#161616] px-6 py-2.5 rounded-[4px] text-[10px] font-black uppercase tracking-[0.2em] hover:opacity-90 disabled:opacity-20 transition-all flex items-center gap-2"
                    >
                      {isLoggingDaily ? 'SUBMITTING...' : <><Send className="w-3.5 h-3.5" /> SUBMIT LOG</>}
                    </button>
                  </div>
                </div>
              ) : (
                <p className="text-xs text-[#161616]/40 font-medium italic">Your daily contribution has been recorded. Focus on your evening rest.</p>
              )}
            </div>
          )}

          {/* Activity for ONE calendar day, in the viewer''s timezone.
              This used to render the entire log history newest-first, so
              seeing this morning meant scrolling past months. Managers get
              arrows to step back through previous days. */}
          <GlobalActivityFeed
            nameOf={(userId) =>
              allUsers.find((u) => u.id === userId)?.username || String(userId).slice(0, 8)
            }
            canBrowseDays={role === 'SUPER_ADMIN' || role === 'ADMIN'}
          />
        </div>

        {/* Right Column */}
        <div className="flex flex-col gap-6">
          {/* Zoho Mail Connection Card */}
          {user && (
            <div className="bg-white border border-[#DFDFDF] rounded-[8px] p-6 shadow-sm">
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-[11px] font-black text-[#161616]/30 uppercase tracking-[0.2em]">Zoho Integration</h3>
                <Mail className="w-4 h-4 text-[#161616]/20" />
              </div>
              {(() => {
                const fullUser = allUsers.find(u => u.id === user.id);
                const isLinked = Boolean(fullUser?.zohoEmail || fullUser?.zohoLinked);
                
                if (isLinked) {
                  return (
                    <div className="space-y-4">
                      <div className="bg-green-50 border border-green-200 rounded-[6px] p-3 text-left">
                        <p className="text-[9px] font-black text-green-700 uppercase tracking-widest mb-1">Status: Connected ✓</p>
                        <p className="text-xs text-green-900 font-bold truncate">@{fullUser?.zohoEmail || fullUser?.username}</p>
                      </div>
                      <button
                        onClick={async () => {
                          if (!window.confirm("Unlink Zoho Mail from CRM?")) return;
                          try {
                            await api.users.unlinkZoho(user.id);
                            alert("Zoho Mail account unlinked.");
                            window.location.reload();
                          } catch {
                            alert("Failed to unlink Zoho account.");
                          }
                        }}
                        className="w-full bg-red-50 text-red-600 border border-red-200 py-2 rounded-[4px] text-[10px] font-black uppercase tracking-widest hover:bg-red-100 transition-all cursor-pointer"
                      >
                        Disconnect Zoho Mail
                      </button>
                    </div>
                  );
                }

                // The authorisation URL is minted server-side so the OAuth
                // client id stays out of the browser bundle and the request
                // carries a signed, user-bound `state`.
                return <ZohoConnectButton />;
              })()}
            </div>
          )}

          {/* Urgent Actions Overlay */}
          <div className="bg-[#161616] rounded-[8px] p-6 shadow-2xl relative overflow-hidden">
            <h3 className="text-[11px] font-black text-white/30 uppercase tracking-[0.2em] mb-6">Pending Authorizations</h3>
            <div className="flex flex-col gap-4 relative z-10">
              {pendingRequests.length > 0 ? (
                pendingRequests.slice(0, 3).map((req, i) => (
                  <div key={i} className="bg-white/5 border border-white/10 rounded-[6px] p-4 cursor-pointer hover:bg-white/10 transition-all group" onClick={() => navigate('/admin')}>
                    <div className="flex justify-between items-start mb-3">
                      <span className={`px-2 py-0.5 rounded-[3px] text-[8px] font-black uppercase tracking-widest ${req.type === 'payment' ? 'bg-white text-[#161616]' : 'bg-white/20 text-white/60'}`}>{req.type}</span>
                      <ShieldCheck className="w-3 h-3 text-white/10 group-hover:text-white/40 transition-colors" />
                    </div>
                    <p className="text-xs text-white/80 font-bold uppercase tracking-tight truncate">Request from {req.requestedBy}</p>
                    <div className="flex items-center gap-1.5 mt-4 text-[9px] font-black text-white/30 uppercase tracking-widest group-hover:text-white transition-all">
                      AUTHORIZE <ArrowRight className="w-3 h-3" />
                    </div>
                  </div>
                ))
              ) : (
                <div className="flex flex-col items-center justify-center py-8 gap-3 border border-dashed border-white/10 rounded-[6px]">
                  <CheckCircle2 className="w-6 h-6 text-white/10" />
                  <p className="text-[10px] font-black text-white/20 uppercase tracking-widest">Ecosystem Clean</p>
                </div>
              )}
            </div>
          </div>

          {/* Pipeline Funnel */}
          <div className="bg-white border border-[#DFDFDF] rounded-[8px] p-6 shadow-sm">
            <div className="flex items-center justify-between mb-8">
              <h3 className="text-[11px] font-black text-[#161616]/30 uppercase tracking-[0.2em]">Funnel Conversion</h3>
              <TrendingUp className="w-4 h-4 text-[#161616]/20" />
            </div>
            {(['New', 'Contacted', 'Qualified', 'Converted'] as const).map((s, i) => {
              const count = myLeads.filter((l) => l.status === s).length;
              const total = myLeads.length || 1;
              const pct = Math.round((count / total) * 100);
              return (
                <div key={s} className="mb-6 last:mb-0">
                  <div className="flex justify-between text-[10px] font-black mb-2 uppercase tracking-widest">
                    <span className="text-[#161616]">{s}</span>
                    <span className="text-[#161616]/40 tabular-nums">{count} UNITS</span>
                  </div>
                  <div className="w-full h-1.5 bg-[#F9F9F9] rounded-full overflow-hidden border border-[#DFDFDF]">
                    <div className={`h-full bg-[#161616] rounded-full transition-all duration-1000`} style={{ width: `${pct}%`, opacity: 0.2 + (i * 0.2) }}></div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
};
