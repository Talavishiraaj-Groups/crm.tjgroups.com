import React, { useState, useEffect } from 'react';
import { api } from '../api/services';
import { Commission, User } from '../types';
import { TrendingUp, CheckCircle2, Clock } from 'lucide-react';
import { STATUS_BADGE } from '../utils/badges';

export const FinancePage: React.FC = () => {
  const [commissions, setCommissions] = useState<Commission[]>([]);
  const [users, setUsers] = useState<User[]>([]);
  const [kpis, setKpis] = useState<{ totalValue: number; totalCommissions: number; payoutsPending: number; payoutsPaid: number } | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  const fetchFinanceData = () => {
    setIsLoading(true);
    Promise.all([
      api.finance.getCommissions(), 
      api.finance.getKPIs(),
      api.users.getAll()
    ]).then(([comm, kpi, usersData]) => {
      setCommissions(comm);
      setKpis(kpi);
      setUsers(usersData);
      setIsLoading(false);
    });
  };

  useEffect(() => {
    fetchFinanceData();
  }, []);

  const handleProcess = async (id: string) => {
    if (!window.confirm('Mark this commission as PAID?')) return;
    try {
      await api.finance.processCommission(id);
      fetchFinanceData();
    } catch (err) {
      console.error(err);
      alert('Failed to process payout');
    }
  };

  const getUsername = (id: string) => users.find(u => u.id === id)?.username || `ID: ${id}`;

  if (isLoading || !kpis) {
    return <div className="bg-white border border-[#DFDFDF] rounded-[6px] p-12 text-center text-[#161616]/30 italic text-sm">Loading financial data...</div>;
  }

  const kpiList = [
    { label: 'Total Deal Value', value: `$${kpis.totalValue.toLocaleString()}`, sub: 'Settled revenue', invert: false },
    { label: 'Total Commissions', value: `$${kpis.totalCommissions.toLocaleString()}`, sub: 'Across all reps', invert: false },
    { label: 'Payouts Pending', value: `$${kpis.payoutsPending.toLocaleString()}`, sub: 'Awaiting approval', invert: false },
    { label: 'Payouts Paid', value: `$${kpis.payoutsPaid.toLocaleString()}`, sub: 'Successfully settled', invert: true },
  ];

  return (
    <div className="flex flex-col gap-6">
      <div className="flex justify-between items-center">
        <div>
          <h2 className="text-xl font-bold text-[#161616] tracking-tight">Finance & Commissions</h2>
          <p className="text-sm text-[#161616]/40 font-medium mt-0.5">Full financial overview — restricted to Super Admin.</p>
        </div>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {kpiList.map(({ label, value, sub, invert }) => (
          <div key={label} className={`rounded-[6px] p-5 border ${invert ? 'bg-[#161616] border-[#161616]' : 'bg-white border-[#DFDFDF]'}`}>
            <div className="flex justify-between items-start mb-3">
              <span className={`text-[10px] font-bold uppercase tracking-widest ${invert ? 'text-white/30' : 'text-[#161616]/30'}`}>{label}</span>
              <TrendingUp className={`w-4 h-4 ${invert ? 'text-white/20' : 'text-[#161616]/10'}`} />
            </div>
            <div className={`text-2xl font-bold tabular-nums ${invert ? 'text-white' : 'text-[#161616]'}`}>{value}</div>
            <div className={`text-[10px] font-semibold mt-2 ${invert ? 'text-white/30' : 'text-[#161616]/30'}`}>{sub}</div>
          </div>
        ))}
      </div>

      <div className="bg-white border border-[#DFDFDF] rounded-[6px] overflow-hidden">
        <div className="flex justify-between items-center px-5 py-4 border-b border-[#DFDFDF]">
          <h3 className="text-[10px] font-bold text-[#161616]/30 uppercase tracking-widest">Commission Ledger</h3>
          <span className="text-[10px] text-[#161616]/30 font-mono">{commissions.length} entries</span>
        </div>
        <table className="w-full border-collapse">
          <thead>
            <tr className="border-b border-[#DFDFDF]">
              {['Deal ID', 'Setter', 'Amount', 'Closer', 'Amount', 'Status', 'Action'].map((h) => (
                <th key={h} className="text-left px-5 py-3 text-[10px] font-bold text-[#161616]/30 uppercase tracking-widest">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {commissions.length === 0 ? (
              <tr><td colSpan={7} className="px-5 py-16 text-center text-[#161616]/30 italic text-sm">No commissions found.</td></tr>
            ) : (
              commissions.map((c) => (
                <tr key={c.id} className="border-b border-[#DFDFDF] last:border-0 hover:bg-[#F9F9F9] transition-colors">
                  <td className="px-5 py-3.5 text-xs font-mono text-[#161616]/40">#{c.dealId.split('-')[0]}</td>
                  <td className="px-5 py-3.5 text-sm text-[#161616]/60 font-medium">{getUsername(c.setterId)}</td>
                  <td className="px-5 py-3.5 text-sm font-bold text-[#161616] tabular-nums">${c.setterCommissionAmount.toLocaleString()}</td>
                  <td className="px-5 py-3.5 text-sm text-[#161616]/60 font-medium">{getUsername(c.closerId)}</td>
                  <td className="px-5 py-3.5 text-sm font-bold text-[#161616] tabular-nums">${c.closerCommissionAmount.toLocaleString()}</td>
                  <td className="px-5 py-3.5">
                    <span className={`flex items-center gap-1.5 px-2 py-0.5 rounded-[3px] text-[10px] font-bold uppercase tracking-wider w-fit ${STATUS_BADGE[c.payoutStatus]}`}>
                      {c.payoutStatus === 'Paid' ? <CheckCircle2 className="w-3 h-3" /> : <Clock className="w-3 h-3" />}
                      {c.payoutStatus}
                    </span>
                  </td>
                  <td className="px-5 py-3.5">
                    {c.payoutStatus !== 'Paid' && (
                      <button 
                        onClick={() => handleProcess(c.id)}
                        className="text-[10px] font-bold text-white bg-[#161616] px-3 py-1 rounded-[4px] hover:opacity-80 transition-all"
                      >
                        SETTLE
                      </button>
                    )}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
};
