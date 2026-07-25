import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../api/services';
import { Lead, User } from '../types';
import { useAuth } from '../context/AuthContext';
import { Plus, Search, Upload, X, AlertCircle, CheckCircle2, User as UserIcon, Calendar, ChevronRight, DollarSign, FileText, Bell, Trash2 } from 'lucide-react';
import * as XLSX from 'xlsx';
import { STATUS_BADGE } from '../utils/badges';

export const LeadsPage: React.FC = () => {
  const { role, user } = useAuth();
  const navigate = useNavigate();
  const [leads, setLeads] = useState<Lead[]>([]);
  const [users, setUsers] = useState<User[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [activeFilter, setActiveFilter] = useState<string>('All');
  
  // Filter States
  const [selectedSetter, setSelectedSetter] = useState('all');
  const [selectedCloser, setSelectedCloser] = useState('all');
  const [followUpFilter, setFollowUpFilter] = useState<'all' | 'today' | 'upcoming' | 'overdue' | 'unset'>('all');
  
  // Quick Actions
  const [selectedLeadForConvert, setSelectedLeadForConvert] = useState<Lead | null>(null);
  const [dealValue, setDealValue] = useState(0);

  // New Lead Modal
  const [showModal, setShowModal] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [formData, setFormData] = useState({
    name: '', email: '', phone: '', linkedin: '', notes: '', 
    ownerRepId: user?.id || '',
    setterId: user?.id || '',
    closerId: role === 'SALES_REP' ? user?.id || '' : ''
  });

  // Import Modal
  const [showImport, setShowImport] = useState(false);
  const [importRows, setImportRows] = useState<any[]>([]);
  const [importHeaders, setImportHeaders] = useState<string[]>([]);
  const [importing, setImporting] = useState(false);
  const [importProgress, setImportProgress] = useState(0);
  const [importErrors, setImportErrors] = useState<string[]>([]);
  const [importDone, setImportDone] = useState(false);
  const [dragOver, setDragOver] = useState(false);

  // Column map: lead field -> which column header
  const LEAD_FIELDS = [
    { key: 'name',  label: 'Name *', required: true },
    { key: 'email', label: 'Email *', required: true },
    { key: 'phone', label: 'Phone', required: false },
    { key: 'linkedin', label: 'LinkedIn URL', required: false },
    { key: 'notes',    label: 'Notes', required: false },
  ];
  const [colMap, setColMap] = useState<Record<string, string>>({});

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
    if (user && role) {
      setFormData(prev => ({ 
        ...prev, 
        ownerRepId: prev.ownerRepId || user.id,
        setterId: prev.setterId || user.id,
        closerId: prev.closerId || (role === 'SALES_REP' ? user.id : '')
      }));
    }
  }, [user, role]);

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
        setterId: formData.setterId || user.id,
        closerId: formData.closerId || (role === 'SALES_REP' ? user.id : ''),
        status: 'New'
      });
      setShowModal(false);
      setFormData({ 
        name: '', email: '', phone: '', linkedin: '', notes: '', 
        ownerRepId: user.id, setterId: user.id, closerId: '' 
      });
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

  const handleDeleteLead = async (id: string, name: string) => {
    if (!window.confirm(`Are you sure you want to delete lead "${name}" permanently?`)) return;
    try {
      await api.leads.delete(id);
      setLeads(prev => prev.filter(l => l.id !== id));
    } catch (err) {
      console.error(err);
      alert("Failed to delete lead.");
    }
  };

  const filtered = leads
    .filter((l) => {
      const matchSearch = l.name.toLowerCase().includes(search.toLowerCase()) || 
                         l.email.toLowerCase().includes(search.toLowerCase()) ||
                         getUsername(l.ownerRepId).toLowerCase().includes(search.toLowerCase());
      
      const matchFilter = activeFilter === 'All' || l.status === activeFilter;

      // Setter filter
      const matchSetter = selectedSetter === 'all' || l.setterId === selectedSetter;

      // Closer filter
      const matchCloser = selectedCloser === 'all' || l.closerId === selectedCloser;

      // Next Follow Up filter
      let matchFollowUp = true;
      if (followUpFilter !== 'all') {
        const todayStr = new Date().toISOString().split('T')[0];
        if (followUpFilter === 'unset') {
          matchFollowUp = !l.nextFollowUp;
        } else if (!l.nextFollowUp) {
          matchFollowUp = false;
        } else {
          const followUpDate = l.nextFollowUp;
          if (followUpFilter === 'today') {
            matchFollowUp = followUpDate === todayStr;
          } else if (followUpFilter === 'upcoming') {
            matchFollowUp = followUpDate > todayStr;
          } else if (followUpFilter === 'overdue') {
            matchFollowUp = followUpDate < todayStr;
          }
        }
      }

      return matchSearch && matchFilter && matchSetter && matchCloser && matchFollowUp;
    })
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

  const isManagement = role === 'SUPER_ADMIN' || role === 'ADMIN';

  // ── Import helpers ──────────────────────────────────────────────
  const parseFile = (file: File) => {
    const ext = file.name.split('.').pop()?.toLowerCase();
    const reader = new FileReader();
    reader.onload = (e) => {
      const data = e.target?.result;
      let wb: XLSX.WorkBook;
      if (ext === 'csv' || ext === 'tsv') {
        wb = XLSX.read(data as string, { type: 'string' });
      } else {
        wb = XLSX.read(data as ArrayBuffer, { type: 'array' });
      }
      const ws = wb.Sheets[wb.SheetNames[0]];
      const json: any[] = XLSX.utils.sheet_to_json(ws, { defval: '' });
      if (!json.length) return;
      const headers = Object.keys(json[0]);
      setImportHeaders(headers);
      setImportRows(json);
      // Auto-map columns by fuzzy name
      const autoMap: Record<string, string> = {};
      LEAD_FIELDS.forEach(({ key }) => {
        const match = headers.find(h =>
          h.toLowerCase().replace(/[^a-z]/g, '').includes(key.replace(/[^a-z]/g, ''))
        );
        if (match) autoMap[key] = match;
      });
      setColMap(autoMap);
      setImportDone(false);
      setImportErrors([]);
      setImportProgress(0);
    };
    if (ext === 'csv' || ext === 'tsv') {
      reader.readAsText(file);
    } else {
      reader.readAsArrayBuffer(file);
    }
  };

  const handleFileDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    const file = e.dataTransfer.files[0];
    if (file) parseFile(file);
  };

  const handleFileInput = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) parseFile(file);
  };

  const handleImport = async () => {
    if (!user) return;
    const errs: string[] = [];
    setImporting(true);
    setImportProgress(0);
    setImportErrors([]);
    for (let i = 0; i < importRows.length; i++) {
      const row = importRows[i];
      const name  = String(row[colMap.name]  || '').trim();
      const email = String(row[colMap.email] || '').trim();
      if (!name || !email) {
        errs.push(`Row ${i + 1}: Missing required Name or Email — skipped.`);
        setImportProgress(Math.round(((i + 1) / importRows.length) * 100));
        continue;
      }
      try {
        await api.leads.create({
          name,
          email,
          phone:    String(row[colMap.phone]    || '').trim(),
          linkedin: String(row[colMap.linkedin] || '').trim(),
          notes:    String(row[colMap.notes]    || '').trim(),
          status: 'New',
          ownerRepId: user.id,
          setterId:   user.id,
          closerId:   '',
        });
      } catch {
        errs.push(`Row ${i + 1} (${name}): Failed to create.`);
      }
      setImportProgress(Math.round(((i + 1) / importRows.length) * 100));
    }
    setImportErrors(errs);
    setImporting(false);
    setImportDone(true);
    fetchData();
  };

  const resetImport = () => {
    setImportRows([]);
    setImportHeaders([]);
    setColMap({});
    setImportDone(false);
    setImportErrors([]);
    setImportProgress(0);
  };

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
          <button
            onClick={() => { resetImport(); setShowImport(true); }}
            className="flex items-center gap-2 bg-white border border-[#DFDFDF] text-[#161616] px-5 py-2.5 rounded-[6px] text-xs font-black uppercase tracking-widest hover:bg-[#F9F9F9] transition-all shadow-sm"
          >
            <Upload className="w-4 h-4" />
            IMPORT
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

      {/* Leads Page Filters panel */}
      {!isLoading && (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3 bg-white border border-[#DFDFDF] rounded-[10px] p-4 shadow-sm">
          {/* Setter Filter */}
          <div className="relative">
            <select
              value={selectedSetter}
              onChange={e => setSelectedSetter(e.target.value)}
              className="w-full px-3 py-1.5 bg-[#F9F9F9] border border-[#DFDFDF] rounded-[6px] text-xs font-bold text-[#161616] focus:outline-none focus:border-[#161616]/40 cursor-pointer appearance-none"
            >
              <option value="all">Filter by Setter: All</option>
              {users.filter(u => u.status === 'Active' && (u.role === 'SETTER' || u.role === 'SALES_REP' || u.role === 'ADMIN')).map(u => (
                <option key={u.id} value={u.id}>@{u.username}</option>
              ))}
            </select>
          </div>

          {/* Closer Filter */}
          <div className="relative">
            <select
              value={selectedCloser}
              onChange={e => setSelectedCloser(e.target.value)}
              className="w-full px-3 py-1.5 bg-[#F9F9F9] border border-[#DFDFDF] rounded-[6px] text-xs font-bold text-[#161616] focus:outline-none focus:border-[#161616]/40 cursor-pointer appearance-none"
            >
              <option value="all">Filter by Closer: All</option>
              {users.filter(u => u.status === 'Active' && (u.role === 'SALES_REP' || u.role === 'ADMIN')).map(u => (
                <option key={u.id} value={u.id}>@{u.username}</option>
              ))}
            </select>
          </div>

          {/* Next Follow Up Date Filter */}
          <div className="relative">
            <select
              value={followUpFilter}
              onChange={e => setFollowUpFilter(e.target.value as any)}
              className="w-full px-3 py-1.5 bg-[#F9F9F9] border border-[#DFDFDF] rounded-[6px] text-xs font-bold text-[#161616] focus:outline-none focus:border-[#161616]/40 cursor-pointer appearance-none"
            >
              <option value="all">Filter by Next Follow Up: All</option>
              <option value="today">Due Today</option>
              <option value="upcoming">Upcoming</option>
              <option value="overdue">Overdue</option>
              <option value="unset">No Date Set</option>
            </select>
          </div>
        </div>
      )}
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
                {['Client Details', 'Lead Setter', 'Sales Closer', 'Lifecycle Stage', 'Creation Date', 'Next Follow Up', 'Quick Actions', ''].map((h) => (
                  <th key={h} className="text-left px-6 py-4 text-[9px] font-black text-[#161616]/40 uppercase tracking-[0.2em]">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filtered.length === 0 ? (
                <tr>
                  <td colSpan={8} className="px-6 py-20 text-center text-[#161616]/20 italic text-sm font-medium">
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
                      <div className="flex items-center gap-2 text-[10px] text-[#161616]/60 font-bold uppercase tracking-wider">
                        <UserIcon className="w-3 h-3 text-[#161616]/20" /> {getUsername(lead.setterId || lead.ownerRepId)}
                      </div>
                    </td>
                    <td className="px-6 py-5">
                      {lead.closerId ? (
                        <div className="flex items-center gap-2 text-[10px] text-[#161616]/60 font-bold uppercase tracking-wider">
                          <UserIcon className="w-3 h-3 text-[#161616]/20" /> {getUsername(lead.closerId)}
                        </div>
                      ) : (
                        <span className="text-[9px] font-black text-[#161616]/10 uppercase tracking-widest italic">Unassigned</span>
                      )}
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
                    <td className="px-6 py-5" onClick={(e) => e.stopPropagation()}>
                      <div className="relative flex items-center">
                        <Bell className="w-3 h-3 text-[#161616]/20 absolute left-2 pointer-events-none" />
                        <input
                          type="date"
                          defaultValue={lead.nextFollowUp ? lead.nextFollowUp.split('T')[0] : ''}
                          onChange={async (e) => {
                            const val = e.target.value;
                            await api.leads.update(lead.id, { nextFollowUp: val });
                            setLeads(prev => prev.map(l => l.id === lead.id ? { ...l, nextFollowUp: val } : l));
                          }}
                          className="pl-7 pr-2 py-1.5 text-[10px] font-bold text-[#161616]/60 border border-[#DFDFDF] rounded-[4px] bg-[#F9F9F9] focus:outline-none focus:border-[#161616] w-[130px] cursor-pointer"
                        />
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
                            {isManagement && (
                              <button 
                                onClick={() => handleDeleteLead(lead.id, lead.name)}
                                title="Delete Lead"
                                className="p-1.5 border border-red-100 rounded-[4px] hover:bg-red-50 text-red-400 hover:text-red-600 transition-colors"
                              >
                                <Trash2 className="w-3.5 h-3.5" />
                              </button>
                            )}
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
                  <label className="text-[10px] font-black text-[#161616]/30 uppercase tracking-widest block mb-2">LinkedIn Profile URL</label>
                  <input 
                    type="url" value={formData.linkedin} onChange={e => setFormData({...formData, linkedin: e.target.value})}
                    className="w-full px-4 py-3 bg-[#F9F9F9] border border-[#DFDFDF] rounded-[8px] text-sm focus:outline-none focus:border-[#161616] transition-all" 
                    placeholder="https://linkedin.com/in/..."
                  />
                </div>
              </div>

              <div>
                <label className="text-[10px] font-black text-[#161616]/30 uppercase tracking-widest block mb-2">Contact Phone</label>
                <input 
                  type="text" required value={formData.phone} onChange={e => setFormData({...formData, phone: e.target.value})}
                  className="w-full px-4 py-3 bg-[#F9F9F9] border border-[#DFDFDF] rounded-[8px] text-sm focus:outline-none focus:border-[#161616] transition-all" 
                />
              </div>

              {isManagement && (
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="text-[10px] font-black text-[#161616]/30 uppercase tracking-widest block mb-2">Assign Setter</label>
                    <select 
                      value={formData.setterId} onChange={e => setFormData({...formData, setterId: e.target.value})}
                      className="w-full px-4 py-3 bg-[#F9F9F9] border border-[#DFDFDF] rounded-[8px] text-[11px] focus:outline-none focus:border-[#161616] transition-all appearance-none cursor-pointer font-bold uppercase tracking-wider"
                    >
                      {users.filter(u => u.status === 'Active' && (u.role === 'SETTER' || u.role === 'SALES_REP' || u.role === 'ADMIN')).map(u => (
                        <option key={u.id} value={u.id}>{u.username}</option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="text-[10px] font-black text-[#161616]/30 uppercase tracking-widest block mb-2">Assign Closer</label>
                    <select 
                      value={formData.closerId} onChange={e => setFormData({...formData, closerId: e.target.value})}
                      className="w-full px-4 py-3 bg-[#F9F9F9] border border-[#DFDFDF] rounded-[8px] text-[11px] focus:outline-none focus:border-[#161616] transition-all appearance-none cursor-pointer font-bold uppercase tracking-wider"
                    >
                      <option value="">No Closer</option>
                      {users.filter(u => u.status === 'Active' && (u.role === 'SALES_REP' || u.role === 'ADMIN')).map(u => (
                        <option key={u.id} value={u.id}>{u.username}</option>
                      ))}
                    </select>
                  </div>
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

      {/* ── Import Modal ───────────────────────────────────────────── */}
      {showImport && (
        <div className="fixed inset-0 bg-[#161616]/40 backdrop-blur-sm flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-[14px] border border-[#DFDFDF] w-full max-w-[680px] shadow-2xl overflow-hidden flex flex-col max-h-[90vh]">

            {/* Header */}
            <div className="flex justify-between items-center px-7 py-5 border-b border-[#DFDFDF] bg-[#F9F9F9] shrink-0">
              <div>
                <h3 className="text-[11px] font-black text-[#161616] uppercase tracking-[0.25em]">Bulk Import Leads</h3>
                <p className="text-[10px] text-[#161616]/40 mt-0.5 font-medium">Supports .csv · .xlsx · .xls · .ods · .tsv</p>
              </div>
              <button onClick={() => { setShowImport(false); resetImport(); }} className="w-7 h-7 flex items-center justify-center rounded-full hover:bg-[#DFDFDF] transition-all text-[#161616]/40 hover:text-[#161616]">
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="overflow-y-auto flex-1 p-7 flex flex-col gap-6 min-h-0">

              {/* Drop Zone — shown only when no file loaded */}
              {importRows.length === 0 && (
                <div
                  onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
                  onDragLeave={() => setDragOver(false)}
                  onDrop={handleFileDrop}
                  className={`border-2 border-dashed rounded-[10px] p-12 text-center transition-all cursor-pointer ${dragOver ? 'border-[#161616] bg-[#F9F9F9]' : 'border-[#DFDFDF] hover:border-[#161616]/40 hover:bg-[#F9F9F9]/60'}`}
                  onClick={() => document.getElementById('import-file-input')?.click()}
                >
                  <Upload className="w-9 h-9 mx-auto mb-3 text-[#161616]/20" />
                  <p className="text-sm font-black text-[#161616]/50 uppercase tracking-wider mb-1">Drop your file here</p>
                  <p className="text-[11px] text-[#161616]/30 font-medium">or click to browse</p>
                  <p className="text-[10px] text-[#161616]/20 mt-2 font-bold uppercase tracking-widest">CSV · XLSX · XLS · ODS · TSV</p>
                  <input
                    id="import-file-input"
                    type="file"
                    accept=".csv,.xlsx,.xls,.ods,.tsv"
                    className="hidden"
                    onChange={handleFileInput}
                  />
                </div>
              )}

              {/* File loaded — mapping + preview */}
              {importRows.length > 0 && !importDone && (
                <>
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <CheckCircle2 className="w-4 h-4 text-green-500" />
                      <p className="text-[11px] font-black text-[#161616] uppercase tracking-wider">
                        {importRows.length} rows loaded
                      </p>
                    </div>
                    <button onClick={resetImport} className="text-[10px] font-bold text-[#161616]/40 hover:text-[#161616] uppercase tracking-widest underline underline-offset-2">
                      Change File
                    </button>
                  </div>

                  {/* Column Mapping */}
                  <div className="bg-[#F9F9F9] border border-[#DFDFDF] rounded-[8px] p-5">
                    <p className="text-[9px] font-black text-[#161616]/30 uppercase tracking-widest mb-4">Map Your Columns → CRM Fields</p>
                    <div className="grid grid-cols-2 gap-3">
                      {LEAD_FIELDS.map(({ key, label }) => (
                        <div key={key}>
                          <label className="text-[9px] font-black text-[#161616]/50 uppercase tracking-widest block mb-1.5">{label}</label>
                          <select
                            value={colMap[key] || ''}
                            onChange={(e) => setColMap(prev => ({ ...prev, [key]: e.target.value }))}
                            className="w-full px-3 py-2 bg-white border border-[#DFDFDF] rounded-[6px] text-[11px] font-bold text-[#161616] focus:outline-none focus:border-[#161616] appearance-none cursor-pointer"
                          >
                            <option value="">— not mapped —</option>
                            {importHeaders.map(h => (
                              <option key={h} value={h}>{h}</option>
                            ))}
                          </select>
                        </div>
                      ))}
                    </div>
                  </div>

                  {/* Preview table */}
                  <div className="border border-[#DFDFDF] rounded-[8px] overflow-hidden flex flex-col max-h-[220px]">
                    <div className="px-4 py-2.5 bg-[#F9F9F9] border-b border-[#DFDFDF] shrink-0">
                      <p className="text-[9px] font-black text-[#161616]/30 uppercase tracking-widest">Preview — first 5 rows</p>
                    </div>
                    <div className="overflow-auto flex-1">
                      <table className="w-full text-[11px] border-collapse">
                        <thead>
                          <tr className="border-b border-[#DFDFDF] sticky top-0 bg-[#F9F9F9]">
                            {['Name', 'Email', 'Phone', 'LinkedIn', 'Notes'].map(h => (
                              <th key={h} className="text-left px-4 py-2 text-[9px] font-black text-[#161616]/30 uppercase tracking-widest">{h}</th>
                            ))}
                          </tr>
                        </thead>
                        <tbody>
                          {importRows.slice(0, 5).map((row, i) => (
                            <tr key={i} className="border-b border-[#DFDFDF] last:border-0 hover:bg-[#F9F9F9]">
                              <td className="px-4 py-2.5 font-semibold text-[#161616] truncate max-w-[120px]">{String(row[colMap.name] || '—')}</td>
                              <td className="px-4 py-2.5 text-[#161616]/60 truncate max-w-[140px]">{String(row[colMap.email] || '—')}</td>
                              <td className="px-4 py-2.5 text-[#161616]/40">{String(row[colMap.phone] || '—')}</td>
                              <td className="px-4 py-2.5 text-[#161616]/40 truncate max-w-[100px]">{String(row[colMap.linkedin] || '—')}</td>
                              <td className="px-4 py-2.5 text-[#161616]/40 truncate max-w-[100px]">{String(row[colMap.notes] || '—')}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>

                  {/* Progress */}
                  {importing && (
                    <div>
                      <div className="flex justify-between text-[10px] font-black text-[#161616]/40 uppercase tracking-widest mb-2">
                        <span>Importing…</span><span>{importProgress}%</span>
                      </div>
                      <div className="w-full h-2 bg-[#F9F9F9] rounded-full border border-[#DFDFDF] overflow-hidden">
                        <div className="h-full bg-[#161616] rounded-full transition-all duration-200" style={{ width: `${importProgress}%` }} />
                      </div>
                    </div>
                  )}
                </>
              )}

              {/* Done state */}
              {importDone && (
                <div className="flex flex-col items-center gap-5 py-8 text-center">
                  <CheckCircle2 className="w-12 h-12 text-green-500" />
                  <div>
                    <p className="text-sm font-black text-[#161616] uppercase tracking-wide">Import Complete</p>
                    <p className="text-[11px] text-[#161616]/40 mt-1.5">
                      <span className="text-green-600 font-black">{importRows.length - importErrors.length}</span> of {importRows.length} leads imported successfully.
                    </p>
                  </div>
                  {importErrors.length > 0 && (
                    <div className="w-full bg-red-50 border border-red-200 rounded-[8px] p-4 text-left max-h-[120px] overflow-y-auto">
                      <p className="text-[10px] font-black text-red-600 uppercase tracking-widest mb-2 flex items-center gap-1.5">
                        <AlertCircle className="w-3.5 h-3.5" /> {importErrors.length} rows skipped
                      </p>
                      {importErrors.map((e, i) => (
                        <p key={i} className="text-[10px] text-red-500 font-medium leading-relaxed">{e}</p>
                      ))}
                    </div>
                  )}
                  <button
                    onClick={() => { setShowImport(false); resetImport(); }}
                    className="bg-[#161616] text-white px-8 py-3 rounded-[6px] text-[11px] font-black uppercase tracking-[0.2em] hover:opacity-90 transition-all shadow-lg"
                  >
                    Done
                  </button>
                </div>
              )}
            </div>

            {/* Footer */}
            {importRows.length > 0 && !importDone && (
              <div className="flex justify-between items-center px-7 py-4 border-t border-[#DFDFDF] bg-[#F9F9F9] shrink-0">
                <p className="text-[10px] text-[#161616]/40 font-medium">
                  {importRows.length} rows · Name &amp; Email are required
                </p>
                <div className="flex gap-3">
                  <button
                    onClick={() => { setShowImport(false); resetImport(); }}
                    className="px-5 py-2.5 text-[11px] font-black text-[#161616]/40 hover:text-[#161616] uppercase tracking-widest"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={handleImport}
                    disabled={importing || !colMap.name || !colMap.email}
                    className="flex items-center gap-2 bg-[#161616] text-white px-6 py-2.5 rounded-[6px] text-[11px] font-black uppercase tracking-[0.15em] hover:opacity-90 disabled:opacity-30 transition-all shadow-lg"
                  >
                    <Upload className="w-3.5 h-3.5" />
                    {importing ? `Importing… ${importProgress}%` : `Import ${importRows.length} Leads`}
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
};
