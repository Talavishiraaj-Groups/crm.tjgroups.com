import React, { useState, useEffect } from 'react';
import { useAuth } from '../context/AuthContext';
import { Users, Briefcase, TrendingUp, AlertCircle, ArrowRight, Clock, MessageSquare, Phone, Mail, ShieldCheck } from 'lucide-react';
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
  COMMISSION_GENERATED: ShieldCheck
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

  const fetchData = async () => {
    if (!user || !role) return;
    setIsLoading(true);
    
    try {
      // Use separate fetches to prevent one failure from breaking everything
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

      // Try fetching logs separately as it's the most likely to fail if not implemented
      try {
        const logs = await api.logs.getByEntity('GLOBAL');
        setRecentLogs(logs || []);
      } catch (err) {
        console.warn("Global logs not available:", err);
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

  const isSalesRep = role === 'SALES_REP';
  const openDealsValue = myDeals.reduce((s, d) => s + (isDealOpen(d.status) ? Number(d.value) : 0), 0);
  
  function isDealOpen(status: string) {
    const s = status.toUpperCase();
    return s === 'OPEN' || s === 'PROPOSAL SENT' || s === 'NEGOTIATION' || s === 'LEAD';
  }

  const activeProjects = myProjects.filter((p) => p.status !== 'Completed').length;
  const hour = new Date().getHours();
  const greeting = hour < 12 ? 'Good Morning' : hour < 17 ? 'Good Afternoon' : 'Good Evening';

  const kpis = [
    { label: 'Active Leads', value: myLeads.length, sub: 'Total active', path: '/leads', icon: Users },
    { label: 'Open Deals', value: myDeals.filter((d) => isDealOpen(d.status)).length, sub: `$${openDealsValue.toLocaleString()} value`, path: '/deals', icon: Briefcase },
    { label: 'Active Projects', value: activeProjects, sub: 'In delivery', path: '/projects', icon: TrendingUp },
    { label: 'Pending Actions', value: pendingRequests.length, sub: 'Requires review', path: '/payments', icon: AlertCircle },
  ];

  if (isLoading) {
    return (
      <div className="flex flex-col items-center justify-center py-20 animate-pulse">
        <div className="w-12 h-12 rounded-full border-4 border-[#161616]/10 border-t-[#161616] animate-spin mb-4"></div>
        <div className="text-[#161616]/40 text-sm font-bold tracking-widest uppercase">Syncing Dashboard...</div>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-8">
      {/* Greeting */}
      <div className="flex justify-between items-end">
        <div>
          <h2 className="text-2xl font-bold text-[#161616] tracking-tight">{greeting}, {user?.username}</h2>
          <p className="text-sm text-[#161616]/40 mt-1 font-medium italic">
            {isSalesRep ? "Focus on your pipeline today." : "System health and team performance overview."}
          </p>
        </div>
        <div className="text-[10px] font-bold text-[#161616]/30 uppercase tracking-widest bg-white px-3 py-1.5 rounded-full border border-[#DFDFDF]">
          {new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })}
        </div>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {kpis.map(({ label, value, sub, path, icon: Icon }) => (
          <div
            key={label}
            onClick={() => navigate(path)}
            className="bg-white border border-[#DFDFDF] rounded-[6px] p-5 cursor-pointer hover:border-[#161616]/30 hover:shadow-sm transition-all group"
          >
            <div className="flex justify-between items-start mb-4">
              <span className="text-[10px] font-bold text-[#161616]/40 uppercase tracking-widest">{label}</span>
              <Icon className="w-4 h-4 text-[#161616]/15 group-hover:text-[#161616]/30 transition-colors" />
            </div>
            <div className="text-3xl font-bold text-[#161616] tabular-nums">{value}</div>
            <div className="text-[10px] font-semibold text-[#161616]/40 mt-2">{sub}</div>
          </div>
        ))}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Recent Conversations / Logs */}
        <div className="lg:col-span-2 flex flex-col gap-6">
          <div className="bg-white border border-[#DFDFDF] rounded-[6px] overflow-hidden shadow-sm">
            <div className="flex justify-between items-center px-5 py-4 border-b border-[#DFDFDF] bg-[#F9F9F9]">
              <h3 className="text-[11px] font-bold text-[#161616]/40 uppercase tracking-widest">Recent Activity Feed</h3>
              <Clock className="w-3.5 h-3.5 text-[#161616]/20" />
            </div>
            <div className="p-1 max-h-[400px] overflow-y-auto">
              {recentLogs.length === 0 ? (
                <div className="px-5 py-16 text-center text-[#161616]/30 italic text-sm">No recent activity detected in the system logs.</div>
              ) : (
                recentLogs.slice(0, 15).map((log) => {
                  const Icon = LOG_ICON[log.action] || Clock;
                  return (
                    <div key={log.id} className="flex items-center gap-4 px-4 py-3 hover:bg-[#F9F9F9] transition-colors border-b border-[#DFDFDF] last:border-0 cursor-pointer" onClick={() => log.entityType === 'Lead' && navigate(`/leads/${log.entityId}`)}>
                      <div className="w-8 h-8 rounded-full bg-[#161616]/5 flex items-center justify-center shrink-0">
                        <Icon className="w-4 h-4 text-[#161616]/40" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex justify-between items-start">
                          <p className="text-[10px] font-black text-[#161616] uppercase tracking-tighter">{log.action}</p>
                          <span className="text-[10px] text-[#161616]/30 tabular-nums">{new Date(log.timestamp).toLocaleDateString()} {new Date(log.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
                        </div>
                        <p className="text-[11px] text-[#161616]/60 truncate mt-0.5">{log.details}</p>
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          </div>

          {/* Recent Leads */}
          <div className="bg-white border border-[#DFDFDF] rounded-[6px] overflow-hidden shadow-sm">
            <div className="flex justify-between items-center px-5 py-4 border-b border-[#DFDFDF] bg-[#F9F9F9]">
              <h3 className="text-[11px] font-bold text-[#161616]/40 uppercase tracking-widest">Newest Leads</h3>
              <button onClick={() => navigate('/leads')} className="text-[10px] font-bold text-[#161616] hover:underline uppercase tracking-widest">VIEW ALL</button>
            </div>
            <table className="w-full border-collapse">
              <tbody>
                {myLeads.length === 0 ? (
                  <tr><td className="px-5 py-10 text-center text-[#161616]/30 italic text-sm">No leads assigned yet.</td></tr>
                ) : (
                  myLeads.slice(0, 5).map((lead) => (
                    <tr key={lead.id} onClick={() => navigate(`/leads/${lead.id}`)} className="border-b border-[#DFDFDF] last:border-0 hover:bg-[#F9F9F9] cursor-pointer transition-colors">
                      <td className="px-5 py-3 text-sm font-semibold text-[#161616]">{lead.name}</td>
                      <td className="px-5 py-3 text-right">
                        <span className={`px-2 py-0.5 rounded-[3px] text-[10px] font-bold uppercase tracking-wider ${STATUS_BADGE[lead.status]}`}>
                          {lead.status}
                        </span>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>

        {/* Right Column */}
        <div className="flex flex-col gap-4">
          {/* Tasks / Requests */}
          <div className="bg-[#161616] rounded-[6px] overflow-hidden p-6 shadow-lg">
            <h3 className="text-[11px] font-bold text-white/30 uppercase tracking-widest mb-6">Action Required</h3>
            <div className="flex flex-col gap-4">
              {pendingRequests.length > 0 ? (
                pendingRequests.slice(0, 4).map((req, i) => (
                  <div key={i} className="bg-white/5 border border-white/10 rounded-[6px] p-4 cursor-pointer hover:bg-white/10 transition-all group" onClick={() => navigate('/payments')}>
                    <div className="flex justify-between items-start mb-2">
                      <span className="text-[10px] font-bold text-white/40 uppercase tracking-widest">{req.type}</span>
                      <AlertCircle className="w-3 h-3 text-white/20 group-hover:text-white/50 transition-colors" />
                    </div>
                    <p className="text-sm text-white/80 font-medium leading-snug">Review Deal #{req.relatedDealId.split('-')[0]}</p>
                    <div className="flex items-center gap-1 mt-3 text-[9px] font-bold text-white/30 uppercase tracking-widest">
                      Click to process <ArrowRight className="w-2.5 h-2.5" />
                    </div>
                  </div>
                ))
              ) : (
                <div className="text-[11px] text-white/20 italic bg-white/5 p-4 rounded-[4px] border border-dashed border-white/10">No urgent actions pending.</div>
              )}
            </div>
          </div>

          {/* Funnel Health */}
          <div className="bg-white border border-[#DFDFDF] rounded-[6px] p-6 shadow-sm">
            <h3 className="text-[11px] font-bold text-[#161616]/30 uppercase tracking-widest mb-6">Pipeline Health</h3>
            {(['New', 'Contacted', 'Qualified', 'Closed'] as const).map((s, i) => {
              const count = myLeads.filter((l) => l.status === s).length;
              const pct = myLeads.length ? Math.round((count / myLeads.length) * 100) : 0;
              return (
                <div key={s} className="mb-4 last:mb-0">
                  <div className="flex justify-between text-[10px] font-bold mb-2">
                    <span className="text-[#161616]/60 uppercase">{s}</span>
                    <span className="text-[#161616]/30 tabular-nums">{count} ({pct}%)</span>
                  </div>
                  <div className="w-full h-1.5 bg-[#F9F9F9] rounded-full overflow-hidden">
                    <div className={`h-full bg-[#161616] rounded-full transition-all`} style={{ width: `${pct}%`, opacity: 0.2 + (i * 0.2) }}></div>
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
