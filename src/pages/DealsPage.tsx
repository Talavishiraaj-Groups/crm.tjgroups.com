import React, { useState, useEffect } from 'react';
import { api } from '../api/services';
import { Deal, Lead, User } from '../types';
import { useAuth } from '../context/AuthContext';
import { Plus, User as UserIcon, Percent } from 'lucide-react';
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
  const [selectedDeal, setSelectedDeal] = useState<Deal | null>(null);
  const [commissionData, setCommissionData] = useState({ 
    setterPercentage: 5,
    closerPercentage: 10,
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
      }).catch(err => {
        console.error("Fetch failed", err);
        setIsLoading(false);
      });
    }
  };

  useEffect(() => {
    fetchData();
  }, [role, user]);

  // Recalculate amounts when percentage or deal value changes
  useEffect(() => {
    if (selectedDeal) {
      const value = Number(selectedDeal.value);
      setCommissionData(prev => ({
        ...prev,
        setterAmount: Math.round(value * (prev.setterPercentage / 100)),
        closerAmount: Math.round(value * (prev.closerPercentage / 100))
      }));
    }
  }, [commissionData.setterPercentage, commissionData.closerPercentage, selectedDeal]);

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
  
  const handleUpdateStatus = (dealId: string, status: 'Won' | 'Lost') => {
    if (status === 'Won') {
      // Permission check
      if (role !== 'SUPER_ADMIN') {
        alert("Only Super Administrators can mark a deal as WON and set commissions.");
        return;
      }

      const deal = deals.find(d => String(d.id) === String(dealId));
      if (!deal) {
        alert("Deal not found in current view.");
        return;
      }

      const lead = leads.find(l => String(l.id) === String(deal.leadId));
      setSelectedDeal(deal);
      setCommissionData({ 
        setterPercentage: 5,
        closerPercentage: 10,
        setterAmount: Math.round(deal.value * 0.05), 
        closerAmount: Math.round(deal.value * 0.10),
        setterId: lead?.ownerRepId || '',
        closerId: deal.ownerRepId || ''
      });
      setShowWonModal(true);
      return;
    }

    if (!window.confirm(`Mark this deal as ${status.toUpperCase()}?`)) return;
    api.deals.updateStatus(dealId, status).then(() => fetchData()).catch(err => {
      console.error(err);
      alert('Failed to update status');
    });
  };

  const handleConfirmWon = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedDeal) return;
    if (!commissionData.setterId || !commissionData.closerId) {
      alert('Please select both Setter and Closer');
      return;
    }
    setIsSaving(true);
    try {
      await api.deals.updateStatus(selectedDeal.id, 'Won', {
        setterAmount: commissionData.setterAmount,
        closerAmount: commissionData.closerAmount,
        setterId: commissionData.setterId,
        closerId: commissionData.closerId
      });
      setShowWonModal(false);
      setSelectedDeal(null);
      fetchData();
    } catch (err) {
      console.error(err);
      alert('Failed to update status');
    } finally {
      setIsSaving(false);
    }
  };

  const getLeadName = (leadId: string) => leads.find((l) => l.id === leadId)?.name || leadId;
  const getUsername = (id: string) => users.find(u => u.id === id)?.username || `ID: ${id}`;
  const getSetterName = (deal: Deal) => {
    const lead = leads.find(l => l.id === deal.leadId);
    return lead ? getUsername(lead.ownerRepId) : 'Unknown';
  };

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
          <div className="text-2xl font-bold text-[#161616] tabular-nums">${deals.reduce((s, d) => s + Number(d.value), 0).toLocaleString()}</div>
        </div>
        <div className="bg-white border border-[#DFDFDF] rounded-[6px] p-5">
          <div className="text-[10px] font-bold text-[#161616]/30 uppercase tracking-widest mb-2">Open Deals</div>
          <div className="text-2xl font-bold text-[#161616] tabular-nums">{deals.filter((d) => d.status === 'Open').length}</div>
        </div>
        <div className="bg-[#161616] rounded-[6px] p-5">
          <div className="text-[10px] font-bold text-white/30 uppercase tracking-widest mb-2">Deals Won</div>
          <div className="text-2xl font-bold text-white tabular-nums">{deals.filter((d) => d.status === 'Won').length}</div>
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
                {['Deal ID', 'Client', 'Setter', 'Closer', 'Value', 'Status', 'Actions'].map((h) => (
                  <th key={h} className="text-left px-5 py-3 text-[10px] font-bold text-[#161616]/30 uppercase tracking-widest">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {deals.map((deal) => (
                <tr key={deal.id} className="border-b border-[#DFDFDF] last:border-0 hover:bg-[#F9F9F9] transition-colors">
                  <td className="px-5 py-3.5 text-xs font-mono text-[#161616]/40">#{deal.id.split('-')[0]}</td>
                  <td className="px-5 py-3.5 text-sm font-semibold text-[#161616]">{getLeadName(deal.leadId)}</td>
                  <td className="px-5 py-3.5 text-xs text-[#161616]/60">{getSetterName(deal)}</td>
                  <td className="px-5 py-3.5 text-xs text-[#161616]/60">{getUsername(deal.ownerRepId)}</td>
                  <td className="px-5 py-3.5 text-sm font-bold text-[#161616] tabular-nums">${Number(deal.value).toLocaleString()}</td>
                  <td className="px-5 py-3.5">
                    <span className={`px-2 py-0.5 rounded-[3px] text-[10px] font-bold uppercase tracking-wider ${STATUS_BADGE[deal.status]}`}>
                      {deal.status}
                    </span>
                  </td>
                  <td className="px-5 py-3.5 text-right">
                    {deal.status === 'Open' ? (
                      <div className="flex gap-2 justify-end">
                        <button 
                          onClick={() => handleUpdateStatus(deal.id, 'Won')}
                          className="bg-[#161616] text-white px-3 py-1 rounded-[4px] text-[10px] font-black uppercase tracking-widest hover:opacity-90"
                        >
                          WON
                        </button>
                        <button 
                          onClick={() => handleUpdateStatus(deal.id, 'Lost')}
                          className="border border-[#DFDFDF] text-[#161616]/40 px-3 py-1 rounded-[4px] text-[10px] font-bold uppercase tracking-widest"
                        >
                          LOST
                        </button>
                      </div>
                    ) : (
                      <span className="text-[10px] text-[#161616]/20 font-mono uppercase">{new Date(deal.createdAt).toLocaleDateString()}</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Won Deal Modal — SUPER_ADMIN only */}
      {showWonModal && selectedDeal && (
        <div className="fixed inset-0 bg-[#161616]/20 backdrop-blur-sm flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-[6px] border border-[#DFDFDF] w-full max-w-[450px] shadow-2xl overflow-hidden">
            <div className="px-6 py-4 border-b border-[#DFDFDF] flex justify-between items-center bg-[#F9F9F9]">
              <h3 className="text-sm font-bold text-[#161616] uppercase tracking-widest">Process Won Deal</h3>
              <button onClick={() => setShowWonModal(false)} className="text-[#161616]/30 hover:text-[#161616]">✕</button>
            </div>
            <form onSubmit={handleConfirmWon} className="p-6 flex flex-col gap-5">
              <div className="bg-[#161616] p-4 rounded-[4px] flex justify-between items-center text-white">
                <div>
                  <div className="text-[9px] font-bold opacity-30 uppercase tracking-widest">Deal Value</div>
                  <div className="text-xl font-bold">${Number(selectedDeal.value).toLocaleString()}</div>
                </div>
                <div className="text-right">
                  <div className="text-[9px] font-bold opacity-30 uppercase tracking-widest">Client</div>
                  <div className="text-xs font-semibold">{getLeadName(selectedDeal.leadId)}</div>
                </div>
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

              <div className="space-y-4">
                <div className="p-4 border border-[#DFDFDF] rounded-[6px] bg-[#F9F9F9]">
                  <div className="flex justify-between items-center mb-3">
                    <span className="text-[10px] font-bold text-[#161616]/60 uppercase tracking-widest">Setter Commission</span>
                    <div className="flex items-center gap-1 bg-white border border-[#DFDFDF] rounded-[4px] px-2 py-1">
                      <input 
                        type="number" value={commissionData.setterPercentage} 
                        onChange={e => setCommissionData({...commissionData, setterPercentage: Number(e.target.value)})}
                        className="w-8 text-xs font-bold focus:outline-none"
                      />
                      <Percent className="w-3 h-3 text-[#161616]/30" />
                    </div>
                  </div>
                  <div className="flex justify-between items-end">
                    <span className="text-[9px] text-[#161616]/30 font-medium">calculated amount</span>
                    <span className="text-lg font-bold text-[#161616]">${commissionData.setterAmount.toLocaleString()}</span>
                  </div>
                </div>

                <div className="p-4 border border-[#DFDFDF] rounded-[6px] bg-[#F9F9F9]">
                  <div className="flex justify-between items-center mb-3">
                    <span className="text-[10px] font-bold text-[#161616]/60 uppercase tracking-widest">Closer Commission</span>
                    <div className="flex items-center gap-1 bg-white border border-[#DFDFDF] rounded-[4px] px-2 py-1">
                      <input 
                        type="number" value={commissionData.closerPercentage} 
                        onChange={e => setCommissionData({...commissionData, closerPercentage: Number(e.target.value)})}
                        className="w-8 text-xs font-bold focus:outline-none"
                      />
                      <Percent className="w-3 h-3 text-[#161616]/30" />
                    </div>
                  </div>
                  <div className="flex justify-between items-end">
                    <span className="text-[9px] text-[#161616]/30 font-medium">calculated amount</span>
                    <span className="text-lg font-bold text-[#161616]">${commissionData.closerAmount.toLocaleString()}</span>
                  </div>
                </div>
              </div>
              
              <div className="flex justify-end gap-2 mt-2">
                <button type="button" onClick={() => setShowWonModal(false)} className="px-4 py-2 text-xs font-bold text-[#161616]/50 hover:text-[#161616]">CANCEL</button>
                <button type="submit" disabled={isSaving} className="bg-[#161616] text-white px-6 py-2 rounded-[4px] text-xs font-bold hover:opacity-90 disabled:opacity-50">
                  {isSaving ? 'PROCESSING...' : 'CONFIRM WIN & ALLOCATE'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Create Modal */}
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
