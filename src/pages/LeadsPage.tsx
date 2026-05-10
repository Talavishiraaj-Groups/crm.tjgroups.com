import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../api/services';
import { Lead, User } from '../types';
import { useAuth } from '../context/AuthContext';
import { Plus, Search, Filter, User as UserIcon, Calendar, Mail, Phone, ChevronRight, DollarSign, FileText } from 'lucide-react';
import { STATUS_BADGE } from '../utils/badges';

export const LeadsPage: React.FC = () => {
  const { role, user } = useAuth();
  const navigate = useNavigate();
  const [leads, setLeads] = useState<Lead[]>([]);
  const [users, setUsers] = useState<User[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [activeFilter, setActiveFilter] = useState<string>('All');
  
  // Quick Actions
  const [selectedLeadForConvert, setSelectedLeadForConvert] = useState<Lead | null>(null);
  const [dealValue, setDealValue] = useState(0);

  // New Lead Modal
  const [showModal, setShowModal] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [formData, setFormData] = useState({
    name: '', email: '', phone: '', linkedin: '', notes: '', 
    ownerRepId: user?.id || '' 
  });

  const fetchData = () => {
    if (user) {
      setIsLoading(true);
      Promise.all([
        api.leads.getAll(role!, user.id),
        api.users.getAll()
      ]).then(([leadsData, usersData]) => {
        setLeads(leadsData);
        setUsers(usersData);
        setIsLoading(false);
      });
    }
  };

  useEffect(() => {
    fetchData();
  }, [role, user]);

  useEffect(() => {
    if (user && !formData.ownerRepId) {
      setFormData(prev => ({ ...prev, ownerRepId: user.id }));
    }
  }, [user]);

  const handleQuickConvert = async () => {
    if (!selectedLeadForConvert || !user || !dealValue) return;
    setIsSaving(true);
    try {
      await api.leads.convertToDeal(selectedLeadForConvert.id, user.id, dealValue);
      setSelectedLeadForConvert(null);
      fetchData();
      alert('Converted successfully!');
    } catch (err) {
      console.error(err);
      alert('Conversion failed.');
    } finally {
      setIsSaving(false);
    }
  };

  const handleQuickRequest = async (leadId: string, type: 'payment' | 'paperwork') => {
    if (!user) return;
    try {
      await api.adminRequests.create({
        type,
        relatedDealId: leadId,
        requestedBy: user.id,
        status: 'Pending',
        notes: `Quick Request from Leads Page`
      });
      alert(`Request sent successfully!`);
      fetchData();
    } catch (err) {
      console.error(err);
      alert('Request failed.');
    }
  };

  const handleCreateLead = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user) return;
    setIsSaving(true);
    try {
      await api.leads.create({
        ...formData,
        status: 'New'
      });
      setShowModal(false);
      setFormData({ name: '', email: '', phone: '', linkedin: '', notes: '', ownerRepId: user.id });
      fetchData();
    } catch (err) {
      console.error(err);
      alert('Failed to create lead. Please check your inputs.');
    } finally {
      setIsSaving(false);
    }
  };

  const getUsername = (id: string) => users.find(u => u.id === id)?.username || `User ${id}`;
  const statuses = ['All', 'New', 'Contacted', 'Qualified', 'Converted', 'Closed'];

  const filtered = leads.filter((l) => {
    const matchSearch = l.name.toLowerCase().includes(search.toLowerCase()) || 
                       l.email.toLowerCase().includes(search.toLowerCase()) ||
                       getUsername(l.ownerRepId).toLowerCase().includes(search.toLowerCase());
    const matchFilter = activeFilter === 'All' || l.status === activeFilter;
    return matchSearch && matchFilter;
  });

  const isManagement = role === 'SUPER_ADMIN' || role === 'ADMIN';

  return (
    <div className="flex flex-col gap-6 relative">
      {/* Toolbar */}
      <div className="flex justify-between items-center">
        <div className="flex gap-2">
          <button 
            onClick={() => setShowModal(true)}
            className="flex items-center gap-2 bg-[#161616] text-white px-5 py-2.5 rounded-[6px] text-xs font-black uppercase tracking-widest hover:opacity-90 transition-all shadow-lg"
          >
            <Plus className="w-4 h-4" />
            CREATE NEW LEAD
          </button>
        </div>
        <div className="flex items-center gap-3">
          <div className="relative group">
            <Search className="absolute left-3 top-2.5 w-4 h-4 text-[#161616]/20 group-focus-within:text-[#161616]/50 transition-colors" />
            <input
              type="text"
              placeholder="Search leads, emails, or reps..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pl-10 pr-4 py-2.5 border border-[#DFDFDF] rounded-[8px] text-sm focus:outline-none focus:border-[#161616] bg-white w-[280px] text-[#161616] shadow-sm transition-all"
            />
          </div>
        </div>
      </div>

      {/* Filter Tabs */}
      <div className="flex gap-1 bg-[#F9F9F9] p-1.5 rounded-[8px] border border-[#DFDFDF] w-fit shadow-inner">
        {statuses.map((s) => (
          <button
            key={s}
            onClick={() => setActiveFilter(s)}
            className={`px-5 py-2 rounded-[6px] text-[10px] font-black uppercase tracking-[0.15em] transition-all ${
              activeFilter === s
                ? 'bg-[#161616] text-white shadow-md'
                : 'text-[#161616]/30 hover:text-[#161616]/60'
            }`}
          >
            {s} {s !== 'All' && <span className="ml-1 opacity-40 font-mono">[{leads.filter((l) => l.status === s).length}]</span>}
          </button>
        ))}
      </div>

      {/* Table */}
      {isLoading ? (
        <div className="flex flex-col items-center justify-center py-32 gap-4">
          <div className="w-8 h-8 border-2 border-[#161616] border-t-transparent rounded-full animate-spin"></div>
          <p className="text-[10px] font-black text-[#161616]/30 uppercase tracking-[0.2em]">Retrieving Lead Pipeline</p>
        </div>
      ) : (
        <div className="bg-white border border-[#DFDFDF] rounded-[8px] overflow-hidden shadow-sm">
          <table className="w-full border-collapse">
            <thead>
              <tr className="border-b border-[#DFDFDF] bg-[#F9F9F9]">
                {['Client Details', 'Assigned Rep', 'Lifecycle Stage', 'Creation Date', 'Quick Actions', ''].map((h) => (
                  <th key={h} className="text-left px-6 py-4 text-[9px] font-black text-[#161616]/40 uppercase tracking-[0.2em]">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filtered.length === 0 ? (
                <tr>
                  <td colSpan={5} className="px-6 py-20 text-center text-[#161616]/20 italic text-sm font-medium">
                    No records found matching the current criteria.
                  </td>
                </tr>
              ) : (
                filtered.map((lead) => (
                  <tr
                    key={lead.id}
                    onClick={() => navigate(`/leads/${lead.id}`)}
                    className="border-b border-[#DFDFDF] last:border-0 hover:bg-[#F9F9F9] cursor-pointer transition-colors group"
                  >
                    <td className="px-6 py-5">
                      <div className="flex items-center gap-4">
                        <div className="w-10 h-10 rounded-full bg-[#161616]/5 border border-[#161616]/10 flex items-center justify-center text-[13px] font-black text-[#161616]/30 group-hover:bg-[#161616] group-hover:text-white transition-all">
                          {lead.name[0]}
                        </div>
                        <div>
                          <p className="text-sm font-bold text-[#161616] leading-none mb-1">{lead.name}</p>
                          <p className="text-[10px] text-[#161616]/40 font-medium">{lead.email}</p>
                        </div>
                      </div>
                    </td>
                    <td className="px-6 py-5">
                      <div className="flex items-center gap-2.5 text-[11px] text-[#161616]/60 font-bold uppercase tracking-wider">
                        <div className="w-1.5 h-1.5 rounded-full bg-[#161616]/20"></div>
                        {getUsername(lead.ownerRepId)}
                      </div>
                    </td>
                    <td className="px-6 py-5">
                      <span className={`px-2.5 py-1 rounded-[4px] text-[9px] font-black uppercase tracking-[0.1em] ${STATUS_BADGE[lead.status]}`}>
                        {lead.status}
                      </span>
                    </td>
                    <td className="px-6 py-5">
                      <div className="flex items-center gap-2 text-[11px] text-[#161616]/40 font-mono">
                        <Calendar className="w-3.5 h-3.5 opacity-40" />
                        {new Date(lead.createdAt).toLocaleDateString(undefined, { dateStyle: 'medium' })}
                      </div>
                    </td>
                    <td className="px-6 py-5">
                      <div className="flex items-center gap-2" onClick={(e) => e.stopPropagation()}>
                        {lead.status !== 'Converted' && lead.status !== 'Closed' && (
                          <button 
                            onClick={() => {
                              setSelectedLeadForConvert(lead);
                              setDealValue(0);
                            }}
                            className="bg-[#161616] text-white px-2.5 py-1 rounded-[4px] text-[9px] font-black uppercase tracking-widest hover:opacity-90"
                          >
                            CONVERT
                          </button>
                        )}
                        {lead.status !== 'Converted' && (
                          <div className="flex gap-1">
                            <button 
                              onClick={() => handleQuickRequest(lead.id, 'payment')}
                              title="Request Payment"
                              className="p-1.5 border border-[#DFDFDF] rounded-[4px] hover:bg-[#F9F9F9] text-[#161616]/40 hover:text-[#161616]"
                            >
                              <DollarSign className="w-3.5 h-3.5" />
                            </button>
                            <button 
                              onClick={() => handleQuickRequest(lead.id, 'paperwork')}
                              title="Request Paperwork"
                              className="p-1.5 border border-[#DFDFDF] rounded-[4px] hover:bg-[#F9F9F9] text-[#161616]/40 hover:text-[#161616]"
                            >
                              <FileText className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        )}
                      </div>
                    </td>
                    <td className="px-6 py-5 text-right">
                      <ChevronRight className="w-4 h-4 text-[#161616]/10 group-hover:text-[#161616] transition-all ml-auto" />
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      )}

      {/* Quick Conversion Modal */}
      {selectedLeadForConvert && (
        <div className="fixed inset-0 bg-[#161616]/30 backdrop-blur-sm flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-[12px] border border-[#DFDFDF] w-full max-w-[400px] shadow-2xl overflow-hidden">
            <div className="px-8 py-5 border-b border-[#DFDFDF] flex justify-between items-center bg-[#F9F9F9]">
              <h3 className="text-[10px] font-black text-[#161616] uppercase tracking-[0.25em]">Convert Lead: {selectedLeadForConvert.name}</h3>
              <button onClick={() => setSelectedLeadForConvert(null)} className="text-[#161616]/20 hover:text-[#161616]">✕</button>
            </div>
            <div className="p-8 flex flex-col gap-6">
              <div>
                <label className="text-[10px] font-black text-[#161616]/30 uppercase tracking-widest block mb-2">Deal Value ($)</label>
                <input 
                  type="number" required value={dealValue || ''} onChange={e => setDealValue(Number(e.target.value))}
                  className="w-full px-4 py-3 bg-[#F9F9F9] border border-[#DFDFDF] rounded-[8px] text-sm focus:outline-none focus:border-[#161616] font-bold" 
                  placeholder="Enter value..."
                />
              </div>
              <div className="flex justify-end gap-3 mt-2">
                <button onClick={() => setSelectedLeadForConvert(null)} className="px-6 py-3 text-[11px] font-black text-[#161616]/40 hover:text-[#161616] uppercase tracking-widest">CANCEL</button>
                <button 
                  onClick={handleQuickConvert}
                  disabled={isSaving || !dealValue}
                  className="bg-[#161616] text-white px-8 py-3 rounded-[6px] text-[11px] font-black hover:opacity-90 disabled:opacity-20 uppercase tracking-[0.2em] shadow-xl"
                >
                  {isSaving ? 'CONVERTING...' : 'CONFIRM CONVERSION'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* New Lead Modal */}
      {showModal && (
        <div className="fixed inset-0 bg-[#161616]/30 backdrop-blur-sm flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-[12px] border border-[#DFDFDF] w-full max-w-[480px] shadow-2xl overflow-hidden">
            <div className="px-8 py-5 border-b border-[#DFDFDF] flex justify-between items-center bg-[#F9F9F9]">
              <h3 className="text-[12px] font-black text-[#161616] uppercase tracking-[0.25em]">Initialize New Lead</h3>
              <button onClick={() => setShowModal(false)} className="text-[#161616]/20 hover:text-[#161616] transition-all p-1">✕</button>
            </div>
            <form onSubmit={handleCreateLead} className="p-8 flex flex-col gap-6">
              <div>
                <label className="text-[10px] font-black text-[#161616]/30 uppercase tracking-widest block mb-2">Lead / Client Identity</label>
                <input 
                  type="text" required value={formData.name} onChange={e => setFormData({...formData, name: e.target.value})}
                  className="w-full px-4 py-3 bg-[#F9F9F9] border border-[#DFDFDF] rounded-[8px] text-sm focus:outline-none focus:border-[#161616] transition-all" 
                  placeholder="e.g. John Doe / Global Tech Solutions"
                />
              </div>
              
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="text-[10px] font-black text-[#161616]/30 uppercase tracking-widest block mb-2">Primary Email</label>
                  <input 
                    type="email" required value={formData.email} onChange={e => setFormData({...formData, email: e.target.value})}
                    className="w-full px-4 py-3 bg-[#F9F9F9] border border-[#DFDFDF] rounded-[8px] text-sm focus:outline-none focus:border-[#161616] transition-all" 
                  />
                </div>
                <div>
                  <label className="text-[10px] font-black text-[#161616]/30 uppercase tracking-widest block mb-2">Contact Phone</label>
                  <input 
                    type="text" required value={formData.phone} onChange={e => setFormData({...formData, phone: e.target.value})}
                    className="w-full px-4 py-3 bg-[#F9F9F9] border border-[#DFDFDF] rounded-[8px] text-sm focus:outline-none focus:border-[#161616] transition-all" 
                  />
                </div>
              </div>

              {isManagement && (
                <div>
                  <label className="text-[10px] font-black text-[#161616]/30 uppercase tracking-widest block mb-2">Owner Assignment (Setter/Admin)</label>
                  <select 
                    value={formData.ownerRepId} onChange={e => setFormData({...formData, ownerRepId: e.target.value})}
                    className="w-full px-4 py-3 bg-[#F9F9F9] border border-[#DFDFDF] rounded-[8px] text-sm focus:outline-none focus:border-[#161616] transition-all appearance-none cursor-pointer font-bold uppercase tracking-wider"
                  >
                    {users.filter(u => u.role !== 'SUPER_ADMIN').map(u => (
                      <option key={u.id} value={u.id}>{u.username} ({u.role})</option>
                    ))}
                  </select>
                </div>
              )}

              <div>
                <label className="text-[10px] font-black text-[#161616]/30 uppercase tracking-widest block mb-2">Initial Intelligence / Notes</label>
                <textarea 
                  value={formData.notes} onChange={e => setFormData({...formData, notes: e.target.value})}
                  className="w-full px-4 py-3 bg-[#F9F9F9] border border-[#DFDFDF] rounded-[8px] text-sm focus:outline-none focus:border-[#161616] min-h-[100px] resize-none transition-all" 
                  placeholder="Describe the lead source or initial context..."
                />
              </div>

              <div className="flex justify-end gap-3 mt-4">
                <button type="button" onClick={() => setShowModal(false)} className="px-6 py-3 text-[11px] font-black text-[#161616]/40 hover:text-[#161616] transition-all uppercase tracking-widest">CANCEL</button>
                <button type="submit" disabled={isSaving} className="bg-[#161616] text-white px-8 py-3 rounded-[6px] text-[11px] font-black hover:opacity-90 disabled:opacity-50 transition-all uppercase tracking-[0.2em] shadow-xl">
                  {isSaving ? 'PROCESSING...' : 'INITIALIZE LEAD'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
