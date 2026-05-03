import React, { useState, useEffect } from 'react';
import { api } from '../api/services';
import { Deal, Lead, User } from '../types';
import { useAuth } from '../context/AuthContext';
import { Plus } from 'lucide-react';
import { STATUS_BADGE } from '../utils/badges';

export const DealsPage: React.FC = () => {
  const { role, user } = useAuth();
  const [deals, setDeals] = useState<Deal[]>([]);
  const [leads, setLeads] = useState<Lead[]>([]);
  const [users, setUsers] = useState<User[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  
  // New Deal Modal
  const [showModal, setShowModal] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [formData, setFormData] = useState({
    leadId: '', value: 0
  });

  // Won Modal — SUPER_ADMIN only
  const [showWonModal, setShowWonModal] = useState(false);
  const [selectedDealId, setSelectedDealId] = useState('');
  const [commissionData, setCommissionData] = useState({ 
    setterAmount: 0, 
    closerAmount: 0,
    setterId: '',
    closerId: ''
  });

  const fetchData = () => {
    if (user && role) {
      setIsLoading(true);
      Promise.all([
        api.deals.getAll(role, user.id),
        api.leads.getAll(role, user.id),
        api.users.getAll()
      ]).then(([dealsData, leadsData, usersData]) => {
        setDeals(dealsData);
        setLeads(leadsData);
        setUsers(usersData);
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
  
  const handleUpdateStatus = async (dealId: string, status: 'Won' | 'Lost') => {
    // Won flow — SUPER_ADMIN only (opens commission modal)
    if (status === 'Won') {
      if (role !== 'SUPER_ADMIN') return; // safety guard
      const deal = deals.find(d => d.id === dealId);
      if (deal) {
        const lead = leads.find(l => l.id === deal.leadId);
        setSelectedDealId(dealId);
        setCommissionData({ 
          setterAmount: Math.round(deal.value * 0.05), 
          closerAmount: Math.round(deal.value * 0.10),
          setterId: lead?.ownerRepId || '',
          closerId: deal.ownerRepId || ''
        });
        setShowWonModal(true);
      }
      return;
    }

    if (!window.confirm(`Mark this deal as ${status.toUpperCase()}?`)) return;
    try {
      await api.deals.updateStatus(dealId, status);
      fetchData();
    } catch (err) {
      console.error(err);
      alert('Failed to update status');
    }
  };

  const handleConfirmWon = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!commissionData.setterId || !commissionData.closerId) {
      alert('Please select both Setter and Closer');
      return;
    }
    setIsSaving(true);
    try {
      await api.deals.updateStatus(selectedDealId, 'Won', commissionData);
      setShowWonModal(false);
      fetchData();
    } catch (err) {
      console.error(err);
      alert('Failed to update status');
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
                {['Deal ID', 'Client', 'Value', 'Status', 'Owner', 'Actions'].map((h) => (
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
                    <td className="px-5 py-3.5 text-right">
                      {deal.status === 'Open' ? (
                        <div className="flex gap-2 justify-end">
                          {/* WON button — SUPER_ADMIN only. Sets Setter & Closer commission amounts. */}
                          {role === 'SUPER_ADMIN' && (
                            <button 
                              onClick={() => handleUpdateStatus(deal.id, 'Won')}
                              className="bg-[#161616] text-white px-3 py-1 rounded-[4px] text-[10px] font-black uppercase tracking-widest hover:opacity-90 transition-all"
                            >
                              WON
                            </button>
                          )}
                          <button 
                            onClick={() => handleUpdateStatus(deal.id, 'Lost')}
                            className="border border-[#DFDFDF] text-[#161616]/40 px-3 py-1 rounded-[4px] text-[10px] font-bold uppercase tracking-widest hover:border-[#161616]/40 hover:text-[#161616] transition-all"
                          >
                            LOST
                          </button>
                        </div>
                      ) : (
                        <span className="text-[10px] text-[#161616]/20 font-mono uppercase tracking-tighter">
                          {deal.createdAt ? new Date(deal.createdAt).toLocaleDateString() : 'N/A'}
                        </span>
                      )}
                    </td>
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

      {/* Won Deal Modal — SUPER_ADMIN only */}
      {showWonModal && (
        <div className="fixed inset-0 bg-[#161616]/20 backdrop-blur-sm flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-[6px] border border-[#DFDFDF] w-full max-w-[400px] shadow-2xl overflow-hidden">
            <div className="px-6 py-4 border-b border-[#DFDFDF] flex justify-between items-center">
              <h3 className="text-sm font-bold text-[#161616] uppercase tracking-widest">Mark Deal as Won</h3>
              <button onClick={() => setShowWonModal(false)} className="text-[#161616]/30 hover:text-[#161616]">✕</button>
            </div>
            <form onSubmit={handleConfirmWon} className="p-6 flex flex-col gap-4">
              <div className="bg-[#F9F9F9] p-4 rounded-[4px] border border-[#DFDFDF] mb-2">
                <div className="text-[10px] font-bold text-[#161616]/30 uppercase tracking-widest mb-1">Deal Value</div>
                <div className="text-xl font-bold text-[#161616]">${deals.find(d => d.id === selectedDealId)?.value.toLocaleString()}</div>
              </div>
              
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="text-[10px] font-bold text-[#161616]/40 uppercase tracking-widest block mb-1">Setter</label>
                  <select 
                    required value={commissionData.setterId} 
                    onChange={e => setCommissionData({...commissionData, setterId: e.target.value})}
                    className="w-full px-3 py-2 border border-[#DFDFDF] rounded-[4px] text-sm focus:outline-none focus:border-[#161616]/50 bg-white"
                  >
                    <option value="">Select Setter</option>
                    {users.map(u => (
                      <option key={u.id} value={u.id}>{u.username}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="text-[10px] font-bold text-[#161616]/40 uppercase tracking-widest block mb-1">Closer</label>
                  <select 
                    required value={commissionData.closerId} 
                    onChange={e => setCommissionData({...commissionData, closerId: e.target.value})}
                    className="w-full px-3 py-2 border border-[#DFDFDF] rounded-[4px] text-sm focus:outline-none focus:border-[#161616]/50 bg-white"
                  >
                    <option value="">Select Closer</option>
                    {users.map(u => (
                      <option key={u.id} value={u.id}>{u.username}</option>
                    ))}
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="text-[10px] font-bold text-[#161616]/40 uppercase tracking-widest block mb-1">Setter Commission ($)</label>
                  <input 
                    type="number" required value={commissionData.setterAmount} 
                    onChange={e => setCommissionData({...commissionData, setterAmount: Number(e.target.value)})}
                    className="w-full px-3 py-2 border border-[#DFDFDF] rounded-[4px] text-sm focus:outline-none focus:border-[#161616]/50" 
                  />
                </div>
                <div>
                  <label className="text-[10px] font-bold text-[#161616]/40 uppercase tracking-widest block mb-1">Closer Commission ($)</label>
                  <input 
                    type="number" required value={commissionData.closerAmount} 
                    onChange={e => setCommissionData({...commissionData, closerAmount: Number(e.target.value)})}
                    className="w-full px-3 py-2 border border-[#DFDFDF] rounded-[4px] text-sm focus:outline-none focus:border-[#161616]/50" 
                  />
                </div>
              </div>
              
              <div className="flex justify-end gap-2 mt-2">
                <button type="button" onClick={() => setShowWonModal(false)} className="px-4 py-2 text-xs font-bold text-[#161616]/50 hover:text-[#161616]">CANCEL</button>
                <button type="submit" disabled={isSaving} className="bg-[#161616] text-white px-5 py-2 rounded-[4px] text-xs font-bold hover:opacity-90 disabled:opacity-50">
                  {isSaving ? 'PROCESS...' : 'CONFIRM WIN'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
