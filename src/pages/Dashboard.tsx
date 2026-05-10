import React, { useState, useEffect } from 'react';
import { useAuth } from '../context/AuthContext';
import { 
  Users, Briefcase, TrendingUp, AlertCircle, ArrowRight, 
  Clock, MessageSquare, Phone, Mail, ShieldCheck, 
  ClipboardCheck, Send, CheckCircle2
} from 'lucide-react';
import { api } from '../api/services';
import { useNavigate } from 'react-router-dom';
import { STATUS_BADGE } from '../utils/badges';
import { Lead, Deal, Project, AdminRequest, Log } from '../types';

const LOG_ICON: Record<string, any> = {
  CALL: Phone,
  MESSAGE: MessageSquare,
  EMAIL: Mail,
  STATUS_CHANGE: Clock,
  CONVERSION: TrendingUp,
  GUIDANCE: AlertCircle,
  COMMISSION_GENERATED: ShieldCheck,
  DAILY_LOG: ClipboardCheck
};

export const Dashboard: React.FC = () => {
  const { role, user } = useAuth();
  const navigate = useNavigate();

  const [myLeads, setMyLeads] = useState<Lead[]>([]);
  const [myDeals, setMyDeals] = useState<Deal[]>([]);
  const [myProjects, setMyProjects] = useState<Project[]>([]);
  const [recentLogs, setRecentLogs] = useState<Log[]>([]);
  const [pendingRequests, setPendingRequests] = useState<AdminRequest[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  
  // Daily Log State
  const [dailyNote, setDailyNote] = useState('');
  const [isLoggingDaily, setIsLoggingDaily] = useState(false);
  const [hasLoggedToday, setHasLoggedToday] = useState(false);

  const fetchData = async () => {
    if (!user || !role) return;
    setIsLoading(true);
    
    try {
      const [leads, deals, projects, requests] = await Promise.all([
        api.leads.getAll(role, user.id).catch(() => [] as Lead[]),
        api.deals.getAll(role, user.id).catch(() => [] as Deal[]),
        api.projects.getAll(role, user.id).catch(() => [] as Project[]),
        api.adminRequests.getAll().catch(() => [] as AdminRequest[])
      ]);

      setMyLeads(leads);
      setMyDeals(deals);
      setMyProjects(projects);
      setPendingRequests(requests.filter(r => r.status === 'Pending'));

      try {
        const logs = await api.logs.getByEntity('GLOBAL');
        const sortedLogs = (logs || []).sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
        setRecentLogs(sortedLogs);
        
        // Check if user has logged today
        const today = new Date().toDateString();
        const loggedToday = sortedLogs.some(l => 
          l.action === 'DAILY_LOG' && 
          l.userId === user.id && 
          new Date(l.timestamp).toDateString() === today
        );
        setHasLoggedToday(loggedToday);
      } catch (err) {
        setRecentLogs([]);
      }
    } catch (err) {
      console.error("Dashboard fetch error:", err);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
  }, [role, user]);

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
      alert('Failed to submit daily summary.');
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
          {/* Daily Summary Box (For Sales Reps) */}
          {isSalesRep && (
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

          {/* Activity Feed */}
          <div className="bg-white border border-[#DFDFDF] rounded-[8px] overflow-hidden shadow-sm">
            <div className="flex justify-between items-center px-6 py-5 border-b border-[#DFDFDF] bg-[#F9F9F9]">
              <h3 className="text-[11px] font-black text-[#161616]/40 uppercase tracking-[0.2em]">Global Operational Activity</h3>
              <Clock className="w-4 h-4 text-[#161616]/20" />
            </div>
            <div className="p-0 max-h-[500px] overflow-y-auto">
              {recentLogs.length === 0 ? (
                <div className="px-6 py-20 text-center text-[#161616]/30 italic text-sm">No operational data available.</div>
              ) : (
                recentLogs.map((log) => {
                  const Icon = LOG_ICON[log.action] || Clock;
                  return (
                    <div key={log.id} className="flex items-center gap-5 px-6 py-4 hover:bg-[#F9F9F9] transition-colors border-b border-[#DFDFDF] last:border-0 group cursor-pointer" onClick={() => log.entityType === 'Lead' && navigate(`/leads/${log.entityId}`)}>
                      <div className="w-10 h-10 rounded-full bg-[#161616]/5 flex items-center justify-center shrink-0 group-hover:bg-[#161616] transition-all">
                        <Icon className="w-4 h-4 text-[#161616]/30 group-hover:text-white transition-all" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex justify-between items-center mb-1">
                          <div className="flex items-center gap-2">
                            <span className="text-[10px] font-black text-[#161616] uppercase tracking-tighter">{log.action}</span>
                            <span className="text-[9px] font-bold text-[#161616]/20 uppercase">@{log.userId}</span>
                          </div>
                          <span className="text-[10px] font-mono text-[#161616]/30">{new Date(log.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
                        </div>
                        <p className="text-[11px] text-[#161616]/60 font-medium truncate tracking-tight">{log.details}</p>
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          </div>
        </div>

        {/* Right Column */}
        <div className="flex flex-col gap-6">
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
