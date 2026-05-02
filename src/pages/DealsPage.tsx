import React, { useState, useEffect } from 'react';
import { api } from '../api/services';
import { Deal, Lead } from '../types';
import { useAuth } from '../context/AuthContext';
import { Plus } from 'lucide-react';
import { STATUS_BADGE } from '../utils/badges';

export const DealsPage: React.FC = () => {
  const { role, user } = useAuth();
  const [deals, setDeals] = useState<Deal[]>([]);
  const [leads, setLeads] = useState<Lead[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  
  // New Deal Modal
  const [showModal, setShowModal] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [formData, setFormData] = useState({
    leadId: '', value: 0
  });

  const fetchData = () => {
    if (user && role) {
      setIsLoading(true);
      Promise.all([
        api.deals.getAll(role, user.id),
        api.leads.getAll(role, user.id)
      ]).then(([dealsData, leadsData]) => {
        setDeals(dealsData);
        setLeads(leadsData);
        setIsLoading(false);
      });
    }
  };

  useEffect(() => {
    fetchData();
  }, [role, user]);

  const handleCreateDeal = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user || !formData.leadId) return;
    setIsSaving(true);
    try {
      await api.deals.create({
        leadId: formData.leadId,
        value: formData.value,
        status: 'Open',
        ownerRepId: user.id
      });
      setShowModal(false);
      setFormData({ leadId: '', value: 0 });
      fetchData();
    } catch (err) {
      console.error(err);
      alert('Failed to create deal');
    } finally {
      setIsSaving(false);
    }
  };

  const getLeadName = (leadId: string) => leads.find((l) => l.id === leadId)?.name || leadId;
  const totalValue = deals.reduce((s, d) => s + Number(d.value), 0);
  const openCount = deals.filter((d) => d.status === 'Open').length;
  const wonCount = deals.filter((d) => d.status === 'Won').length;

  return (
    <div className="flex flex-col gap-6 relative">
      <div className="flex justify-between items-center">
        <div>
          <h2 className="text-xl font-bold text-[#161616] tracking-tight">Deals Pipeline</h2>
          <p className="text-sm text-[#161616]/40 font-medium mt-0.5">Track all active and closed deals.</p>
        </div>
        <button 
          onClick={() => setShowModal(true)}
          className="flex items-center gap-2 bg-[#161616] text-white px-4 py-2 rounded-[6px] text-xs font-bold hover:opacity-90 transition-all"
        >
          <Plus className="w-4 h-4" /> NEW DEAL
        </button>
      </div>

      {/* KPIs */}
      <div className="grid grid-cols-3 gap-4">
        <div className="bg-white border border-[#DFDFDF] rounded-[6px] p-5">
          <div className="text-[10px] font-bold text-[#161616]/30 uppercase tracking-widest mb-2">Total Pipeline Value</div>
          <div className="text-2xl font-bold text-[#161616] tabular-nums">${totalValue.toLocaleString()}</div>
        </div>
        <div className="bg-white border border-[#DFDFDF] rounded-[6px] p-5">
          <div className="text-[10px] font-bold text-[#161616]/30 uppercase tracking-widest mb-2">Open Deals</div>
          <div className="text-2xl font-bold text-[#161616] tabular-nums">{openCount}</div>
        </div>
        <div className="bg-[#161616] rounded-[6px] p-5">
          <div className="text-[10px] font-bold text-white/30 uppercase tracking-widest mb-2">Deals Won</div>
          <div className="text-2xl font-bold text-white tabular-nums">{wonCount}</div>
        </div>
      </div>

      {/* Table */}
      {isLoading ? (
        <div className="bg-white border border-[#DFDFDF] rounded-[6px] p-12 text-center text-[#161616]/30 italic text-sm">Loading deals...</div>
      ) : (
        <div className="bg-white border border-[#DFDFDF] rounded-[6px] overflow-hidden">
          <table className="w-full border-collapse">
            <thead>
              <tr className="border-b border-[#DFDFDF]">
                {['Deal ID', 'Client', 'Value', 'Status', 'Owner', 'Created'].map((h) => (
                  <th key={h} className="text-left px-5 py-3 text-[10px] font-bold text-[#161616]/30 uppercase tracking-widest">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {deals.length === 0 ? (
                <tr><td colSpan={6} className="px-5 py-16 text-center text-[#161616]/30 italic text-sm">No deals found. Convert a qualified lead to create a deal.</td></tr>
              ) : (
                deals.map((deal) => (
                  <tr key={deal.id} className="border-b border-[#DFDFDF] last:border-0 hover:bg-[#F9F9F9] transition-colors">
                    <td className="px-5 py-3.5 text-xs font-mono text-[#161616]/40">#{deal.id.split('-')[0]}</td>
                    <td className="px-5 py-3.5 text-sm font-semibold text-[#161616]">{getLeadName(deal.leadId)}</td>
                    <td className="px-5 py-3.5 text-sm font-bold text-[#161616] tabular-nums">${Number(deal.value).toLocaleString()}</td>
                    <td className="px-5 py-3.5">
                      <span className={`px-2 py-0.5 rounded-[3px] text-[10px] font-bold uppercase tracking-wider ${STATUS_BADGE[deal.status]}`}>
                        {deal.status}
                      </span>
                    </td>
                    <td className="px-5 py-3.5 text-sm text-[#161616]/40">{deal.ownerRepId}</td>
                    <td className="px-5 py-3.5 text-sm text-[#161616]/40">{deal.createdAt ? new Date(deal.createdAt).toLocaleDateString() : 'N/A'}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      )}

      {/* New Deal Modal */}
      {showModal && (
        <div className="fixed inset-0 bg-[#161616]/20 backdrop-blur-sm flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-[6px] border border-[#DFDFDF] w-full max-w-[400px] shadow-2xl overflow-hidden">
            <div className="px-6 py-4 border-b border-[#DFDFDF] flex justify-between items-center">
              <h3 className="text-sm font-bold text-[#161616] uppercase tracking-widest">Create New Deal</h3>
              <button onClick={() => setShowModal(false)} className="text-[#161616]/30 hover:text-[#161616]">✕</button>
            </div>
            <form onSubmit={handleCreateDeal} className="p-6 flex flex-col gap-4">
              <div>
                <label className="text-[10px] font-bold text-[#161616]/40 uppercase tracking-widest block mb-1">Select Lead</label>
                <select 
                  required value={formData.leadId} onChange={e => setFormData({...formData, leadId: e.target.value})}
                  className="w-full px-3 py-2 border border-[#DFDFDF] rounded-[4px] text-sm focus:outline-none focus:border-[#161616]/50 bg-white"
                >
                  <option value="">— Choose a Lead —</option>
                  {leads.map(l => (
                    <option key={l.id} value={l.id}>{l.name} ({l.status})</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="text-[10px] font-bold text-[#161616]/40 uppercase tracking-widest block mb-1">Deal Value ($)</label>
                <input 
                  type="number" required value={formData.value} onChange={e => setFormData({...formData, value: Number(e.target.value)})}
                  className="w-full px-3 py-2 border border-[#DFDFDF] rounded-[4px] text-sm focus:outline-none focus:border-[#161616]/50" 
                />
              </div>
              <div className="flex justify-end gap-2 mt-2">
                <button type="button" onClick={() => setShowModal(false)} className="px-4 py-2 text-xs font-bold text-[#161616]/50 hover:text-[#161616]">CANCEL</button>
                <button type="submit" disabled={isSaving} className="bg-[#161616] text-white px-5 py-2 rounded-[4px] text-xs font-bold hover:opacity-90 disabled:opacity-50">
                  {isSaving ? 'SAVING...' : 'CREATE DEAL'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
