import React, { useState, useEffect } from 'react';
import { useAuth } from '../context/AuthContext';
import { Users, Briefcase, TrendingUp, AlertCircle, ArrowRight, CheckCircle, Clock } from 'lucide-react';
import { api } from '../api/services';
import { useNavigate } from 'react-router-dom';
import { STATUS_BADGE } from '../utils/badges';
import { Lead, Deal, Project, AdminRequest } from '../types';

export const Dashboard: React.FC = () => {
  const { role, user } = useAuth();
  const navigate = useNavigate();

  const [myLeads, setMyLeads] = useState<Lead[]>([]);
  const [myDeals, setMyDeals] = useState<Deal[]>([]);
  const [myProjects, setMyProjects] = useState<Project[]>([]);
  const [pendingRequests, setPendingRequests] = useState<AdminRequest[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    if (user && role) {
      Promise.all([
        api.leads.getAll(role, user.id),
        api.deals.getAll(role, user.id),
        api.projects.getAll(role, user.id),
        api.adminRequests.getAll()
      ]).then(([leads, deals, projects, requests]) => {
        setMyLeads(leads);
        setMyDeals(deals);
        setMyProjects(projects);
        setPendingRequests(requests.filter(r => r.status === 'Pending'));
        setIsLoading(false);
      });
    }
  }, [role, user]);

  const isSalesRep = role === 'SALES_REP';
  
  const openDealsValue = myDeals.reduce((s, d) => s + (d.status === 'Open' ? Number(d.value) : 0), 0);
  const activeProjects = myProjects.filter((p) => p.status !== 'Completed').length;

  const hour = new Date().getHours();
  const greeting = hour < 12 ? 'Good Morning' : hour < 17 ? 'Good Afternoon' : 'Good Evening';

  const kpis = [
    { label: 'Active Leads', value: myLeads.length, sub: 'Total active', path: '/leads', icon: Users },
    { label: 'Open Deals', value: myDeals.filter((d) => d.status === 'Open').length, sub: `$${openDealsValue.toLocaleString()} value`, path: '/deals', icon: Briefcase },
    { label: 'Active Projects', value: activeProjects, sub: 'In delivery', path: '/projects', icon: TrendingUp },
    { label: 'Pending Actions', value: pendingRequests.length, sub: 'Requires review', path: '/payments', icon: AlertCircle },
  ];

  if (isLoading) {
    return <div className="text-center py-10 text-[#161616]/40 text-sm">Loading dashboard data...</div>;
  }

  return (
    <div className="flex flex-col gap-8">
      {/* Greeting */}
      <div className="flex justify-between items-end">
        <div>
          <h2 className="text-2xl font-bold text-[#161616] tracking-tight">{greeting}, {user?.username}</h2>
          <p className="text-sm text-[#161616]/40 mt-1 font-medium">
            Here's what's happening with {isSalesRep ? 'your' : 'the'} pipeline today.
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
        {/* Recent Leads Table */}
        <div className="lg:col-span-2 bg-white border border-[#DFDFDF] rounded-[6px] overflow-hidden">
          <div className="flex justify-between items-center px-5 py-4 border-b border-[#DFDFDF]">
            <h3 className="text-[11px] font-bold text-[#161616]/40 uppercase tracking-widest">Recent Leads</h3>
            <button
              onClick={() => navigate('/leads')}
              className="flex items-center gap-1 text-[11px] font-bold text-[#161616] hover:opacity-50 transition-opacity"
            >
              VIEW ALL <ArrowRight className="w-3 h-3" />
            </button>
          </div>
          <table className="w-full border-collapse">
            <tbody>
              {myLeads.length === 0 ? (
                <tr><td className="px-5 py-10 text-center text-[#161616]/30 italic text-sm">No leads found.</td></tr>
              ) : (
                myLeads.slice(0, 5).map((lead) => (
                  <tr
                    key={lead.id}
                    onClick={() => navigate(`/leads/${lead.id}`)}
                    className="border-b border-[#DFDFDF] last:border-0 hover:bg-[#F9F9F9] cursor-pointer transition-colors"
                  >
                    <td className="px-5 py-3">
                      <div className="flex items-center gap-3">
                        <div className="w-7 h-7 rounded-full bg-[#DFDFDF] flex items-center justify-center text-[11px] font-bold text-[#161616]">
                          {lead.name ? lead.name[0] : '?'}
                        </div>
                        <div>
                          <p className="text-sm font-semibold text-[#161616]">{lead.name}</p>
                          <p className="text-[11px] text-[#161616]/40">{lead.email}</p>
                        </div>
                      </div>
                    </td>
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

        {/* Right Column */}
        <div className="flex flex-col gap-4">
          {/* Tasks */}
          <div className="bg-white border border-[#DFDFDF] rounded-[6px] overflow-hidden">
            <div className="px-5 py-4 border-b border-[#DFDFDF]">
              <h3 className="text-[11px] font-bold text-[#161616]/40 uppercase tracking-widest">Your Tasks</h3>
            </div>
            <div className="p-5 flex flex-col gap-4">
              {pendingRequests.length > 0 ? (
                pendingRequests.slice(0, 3).map((req, i) => (
                  <div key={i} className="flex items-start gap-3">
                    <div className="w-4 h-4 rounded-[3px] border-2 mt-0.5 shrink-0 flex items-center justify-center border-[#DFDFDF]"></div>
                    <div>
                      <p className="text-sm text-[#161616] font-medium leading-snug">Approve {req.type} request</p>
                      <p className="text-[10px] text-[#161616]/40 flex items-center gap-1 mt-0.5">
                        <Clock className="w-3 h-3" /> Deal #{req.relatedDealId}
                      </p>
                    </div>
                  </div>
                ))
              ) : (
                <div className="text-[11px] text-[#161616]/30 italic">No pending tasks.</div>
              )}
            </div>
          </div>

          {/* Pipeline Health */}
          <div className="bg-[#161616] rounded-[6px] p-5">
            <h3 className="text-[11px] font-bold text-white/30 uppercase tracking-widest mb-5">Pipeline Health</h3>
            {(['New', 'Contacted', 'Qualified', 'Closed'] as const).map((s, i) => {
              const count = myLeads.filter((l) => l.status === s).length;
              const pct = myLeads.length ? Math.round((count / myLeads.length) * 100) : 0;
              const opacities = ['opacity-30', 'opacity-50', 'opacity-75', 'opacity-100'];
              return (
                <div key={s} className="mb-3.5 last:mb-0">
                  <div className="flex justify-between text-[10px] font-bold mb-1.5">
                    <span className="text-white/50">{s}</span>
                    <span className="text-white/30 tabular-nums">{count}</span>
                  </div>
                  <div className="w-full h-1 bg-white/10 rounded-full">
                    <div className={`h-1 bg-white ${opacities[i]} rounded-full transition-all`} style={{ width: `${pct}%` }}></div>
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
