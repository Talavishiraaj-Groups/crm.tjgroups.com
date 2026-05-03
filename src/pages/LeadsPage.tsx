import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../api/services';
import { Lead, User } from '../types';
import { useAuth } from '../context/AuthContext';
import { Plus, Filter, Download, User as UserIcon } from 'lucide-react';
import { STATUS_BADGE } from '../utils/badges';

export const LeadsPage: React.FC = () => {
  const { role, user } = useAuth();
  const navigate = useNavigate();
  const [leads, setLeads] = useState<Lead[]>([]);
  const [users, setUsers] = useState<User[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [activeFilter, setActiveFilter] = useState<string>('All');
  
  // New Lead Modal
  const [showModal, setShowModal] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [formData, setFormData] = useState({
    name: '', email: '', phone: '', linkedin: '', notes: ''
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

  const handleCreateLead = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user) return;
    setIsSaving(true);
    try {
      await api.leads.create({
        ...formData,
        status: 'New',
        ownerRepId: user.id
      });
      setShowModal(false);
      setFormData({ name: '', email: '', phone: '', linkedin: '', notes: '' });
      fetchData();
    } catch (err) {
      console.error(err);
      alert('Failed to create lead');
    } finally {
      setIsSaving(false);
    }
  };

  const getUsername = (id: string) => users.find(u => u.id === id)?.username || `ID: ${id}`;
  const statuses = ['All', 'New', 'Contacted', 'Qualified', 'Closed'];

  const filtered = leads.filter((l) => {
    const matchSearch = l.name.toLowerCase().includes(search.toLowerCase()) || l.email.toLowerCase().includes(search.toLowerCase());
    const matchFilter = activeFilter === 'All' || l.status === activeFilter;
    return matchSearch && matchFilter;
  });

  return (
    <div className="flex flex-col gap-6 relative">
      {/* Toolbar */}
      <div className="flex justify-between items-center">
        <div className="flex gap-2">
          <button 
            onClick={() => setShowModal(true)}
            className="flex items-center gap-2 bg-[#161616] text-white px-4 py-2 rounded-[6px] text-xs font-bold hover:opacity-90 transition-all"
          >
            <Plus className="w-4 h-4" />
            NEW LEAD
          </button>
        </div>
        <div className="flex items-center gap-3">
          <input
            type="text"
            placeholder="Search leads..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="px-3 py-2 border border-[#DFDFDF] rounded-[6px] text-sm focus:outline-none focus:border-[#161616]/50 bg-white w-[200px] text-[#161616]"
          />
        </div>
      </div>

      {/* Status filter tabs */}
      <div className="flex gap-1 bg-[#F9F9F9] p-1 rounded-[6px] border border-[#DFDFDF] w-fit">
        {statuses.map((s) => (
          <button
            key={s}
            onClick={() => setActiveFilter(s)}
            className={`px-4 py-1.5 rounded-[4px] text-[11px] font-bold uppercase tracking-wider transition-all ${
              activeFilter === s
                ? 'bg-[#161616] text-white shadow-sm'
                : 'text-[#161616]/40 hover:text-[#161616]/70'
            }`}
          >
            {s} {s !== 'All' && <span className="ml-1 opacity-60">({leads.filter((l) => l.status === s).length})</span>}
          </button>
        ))}
      </div>

      {/* Table */}
      {isLoading ? (
        <div className="bg-white border border-[#DFDFDF] rounded-[6px] p-12 text-center text-[#161616]/30 italic text-sm">
          Loading leads...
        </div>
      ) : (
        <div className="bg-white border border-[#DFDFDF] rounded-[6px] overflow-hidden">
          <table className="w-full border-collapse">
            <thead>
              <tr className="border-b border-[#DFDFDF]">
                {['Name', 'Setter', 'Contact Info', 'Status', 'Created', ''].map((h) => (
                  <th key={h} className="text-left px-5 py-3 text-[10px] font-bold text-[#161616]/30 uppercase tracking-widest">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filtered.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-5 py-16 text-center text-[#161616]/30 italic text-sm">
                    No leads match your filters.
                  </td>
                </tr>
              ) : (
                filtered.map((lead) => (
                  <tr
                    key={lead.id}
                    onClick={() => navigate(`/leads/${lead.id}`)}
                    className="border-b border-[#DFDFDF] last:border-0 hover:bg-[#F9F9F9] cursor-pointer transition-colors group"
                  >
                    <td className="px-5 py-3.5">
                      <div className="flex items-center gap-3">
                        <div className="w-7 h-7 rounded-full bg-[#DFDFDF] flex items-center justify-center text-[11px] font-bold text-[#161616] shrink-0">
                          {lead.name[0]}
                        </div>
                        <span className="text-sm font-semibold text-[#161616]">{lead.name}</span>
                      </div>
                    </td>
                    <td className="px-5 py-3.5">
                      <div className="flex items-center gap-2 text-sm text-[#161616]/60 font-medium">
                        <UserIcon className="w-3.5 h-3.5 opacity-30" />
                        {getUsername(lead.ownerRepId)}
                      </div>
                    </td>
                    <td className="px-5 py-3.5">
                      <div className="text-sm text-[#161616]/60">{lead.email}</div>
                      <div className="text-[10px] text-[#161616]/30">{lead.phone}</div>
                    </td>
                    <td className="px-5 py-3.5">
                      <span className={`px-2 py-0.5 rounded-[3px] text-[10px] font-bold uppercase tracking-wider ${STATUS_BADGE[lead.status]}`}>
                        {lead.status}
                      </span>
                    </td>
                    <td className="px-5 py-3.5 text-[11px] text-[#161616]/40 tabular-nums">
                      {new Date(lead.createdAt).toLocaleDateString()}
                    </td>
                    <td className="px-5 py-3.5 text-right">
                      <span className="text-[10px] font-bold text-[#161616]/30 group-hover:text-[#161616] transition-colors uppercase tracking-wider">
                        View →
                      </span>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      )}

      {/* New Lead Modal */}
      {showModal && (
        <div className="fixed inset-0 bg-[#161616]/20 backdrop-blur-sm flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-[6px] border border-[#DFDFDF] w-full max-w-[450px] shadow-2xl overflow-hidden">
            <div className="px-6 py-4 border-b border-[#DFDFDF] flex justify-between items-center">
              <h3 className="text-sm font-bold text-[#161616] uppercase tracking-widest">Create New Lead</h3>
              <button onClick={() => setShowModal(false)} className="text-[#161616]/30 hover:text-[#161616]">✕</button>
            </div>
            <form onSubmit={handleCreateLead} className="p-6 flex flex-col gap-4">
              <div>
                <label className="text-[10px] font-bold text-[#161616]/40 uppercase tracking-widest block mb-1">Lead Name</label>
                <input 
                  type="text" required value={formData.name} onChange={e => setFormData({...formData, name: e.target.value})}
                  className="w-full px-3 py-2 border border-[#DFDFDF] rounded-[4px] text-sm focus:outline-none focus:border-[#161616]/50" 
                  placeholder="e.g. John Doe / Tech Solutions"
                />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="text-[10px] font-bold text-[#161616]/40 uppercase tracking-widest block mb-1">Email</label>
                  <input 
                    type="email" required value={formData.email} onChange={e => setFormData({...formData, email: e.target.value})}
                    className="w-full px-3 py-2 border border-[#DFDFDF] rounded-[4px] text-sm focus:outline-none focus:border-[#161616]/50" 
                  />
                </div>
                <div>
                  <label className="text-[10px] font-bold text-[#161616]/40 uppercase tracking-widest block mb-1">Phone</label>
                  <input 
                    type="text" required value={formData.phone} onChange={e => setFormData({...formData, phone: e.target.value})}
                    className="w-full px-3 py-2 border border-[#DFDFDF] rounded-[4px] text-sm focus:outline-none focus:border-[#161616]/50" 
                  />
                </div>
              </div>
              <div>
                <label className="text-[10px] font-bold text-[#161616]/40 uppercase tracking-widest block mb-1">LinkedIn Profile (Optional)</label>
                <input 
                  type="url" value={formData.linkedin} onChange={e => setFormData({...formData, linkedin: e.target.value})}
                  className="w-full px-3 py-2 border border-[#DFDFDF] rounded-[4px] text-sm focus:outline-none focus:border-[#161616]/50" 
                  placeholder="https://linkedin.com/in/..."
                />
              </div>
              <div>
                <label className="text-[10px] font-bold text-[#161616]/40 uppercase tracking-widest block mb-1">Initial Notes</label>
                <textarea 
                  value={formData.notes} onChange={e => setFormData({...formData, notes: e.target.value})}
                  className="w-full px-3 py-2 border border-[#DFDFDF] rounded-[4px] text-sm focus:outline-none focus:border-[#161616]/50 min-h-[80px] resize-none" 
                />
              </div>
              <div className="flex justify-end gap-2 mt-2">
                <button type="button" onClick={() => setShowModal(false)} className="px-4 py-2 text-xs font-bold text-[#161616]/50 hover:text-[#161616]">CANCEL</button>
                <button type="submit" disabled={isSaving} className="bg-[#161616] text-white px-5 py-2 rounded-[4px] text-xs font-bold hover:opacity-90 disabled:opacity-50">
                  {isSaving ? 'SAVING...' : 'CREATE LEAD'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
