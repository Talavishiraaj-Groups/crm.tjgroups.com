import React, { useState, useEffect } from 'react';
import { AdminRequest } from '../types';
import { api } from '../api/services';
import { FileText, DollarSign, Plus, Link as LinkIcon, ExternalLink } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { STATUS_BADGE } from '../utils/badges';

const TYPE_CONFIG: Record<string, { icon: React.ReactNode; label: string }> = {
  payment:   { icon: <DollarSign className="w-3.5 h-3.5" />, label: 'Payment' },
  paperwork: { icon: <FileText className="w-3.5 h-3.5" />, label: 'Paperwork' },
};

export const PaymentsPage: React.FC = () => {
  const { role, user } = useAuth();
  const [requests, setRequests] = useState<AdminRequest[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [tab, setTab] = useState<'all' | 'payment' | 'paperwork'>('all');
  
  // New Request Modal
  const [showModal, setShowModal] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [viewRequest, setViewRequest] = useState<AdminRequest | null>(null);
  
  // Approval state
  const [approvalLink, setApprovalLink] = useState('');
  const [formData, setFormData] = useState({
    type: 'payment' as 'payment' | 'paperwork', relatedDealId: '', notes: ''
  });
  const [leads, setLeads] = useState<any[]>([]);
  const [deals, setDeals] = useState<any[]>([]);
  const [users, setUsers] = useState<any[]>([]);

  const fetchRequests = () => {
    setIsLoading(true);
    api.adminRequests.getAll().then((data) => {
      setRequests(data);
      setIsLoading(false);
    });
  };

  useEffect(() => {
    fetchRequests();
    api.leads.getAll(role!, user?.id || '').then(setLeads);
    api.deals.getAll(role!, user?.id || '').then(setDeals);
    api.users.getAll().then(setUsers);
  }, [role, user]);

  const handleCreateRequest = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user) return;
    setIsSaving(true);
    try {
      await api.adminRequests.create({
        type: formData.type,
        relatedDealId: formData.relatedDealId,
        requestedBy: user.id,
        status: 'Pending',
        notes: formData.notes
      });
      setShowModal(false);
      setFormData({ type: 'payment', relatedDealId: '', notes: '' });
      fetchRequests();
    } catch (err) {
      console.error(err);
      alert('Failed to create request');
    } finally {
      setIsSaving(false);
    }
  };

  const handleApprove = async (id: string, type: string) => {
    if (!approvalLink && type === 'payment') {
      alert('Please provide a payment link');
      return;
    }
    
    setIsSaving(true);
    try {
      const updateData: any = { status: 'Approved' };
      if (type === 'payment') updateData.paymentLink = approvalLink;
      else updateData.documentUrl = approvalLink;

      await api.adminRequests.update(id, updateData);
      setApprovalLink('');
      setViewRequest(null);
      fetchRequests();
    } catch (err) {
      console.error(err);
      alert('Failed to approve request');
    } finally {
      setIsSaving(false);
    }
  };

  const userRequests = role === 'SUPER_ADMIN' || role === 'ADMIN' 
    ? requests 
    : requests.filter(r => {
        const relatedDeal = deals.find(d => d.id === r.relatedDealId);
        return r.requestedBy === user?.id || (relatedDeal && (relatedDeal.ownerRepId === user?.id || relatedDeal.closerId === user?.id));
      });

  const filtered = tab === 'all' ? userRequests : userRequests.filter((r) => r.type === tab);
  const pendingCount = userRequests.filter((r) => r.status === 'Pending').length;
  const transitVolume = userRequests
    .filter(r => r.type === 'payment' && r.status === 'Pending')
    .length * 1500;
  const approvedDocs = userRequests.filter(r => r.type === 'paperwork' && r.status === 'Approved').length;

  return (
    <div className="flex flex-col gap-6 relative">
      <div className="flex justify-between items-center">
        <div>
          <h2 className="text-xl font-bold text-[#161616] tracking-tight">Payments & Paperwork</h2>
          <p className="text-sm text-[#161616]/40 font-medium mt-0.5">Manage admin requests, transactions and documents.</p>
        </div>
        <button 
          onClick={() => setShowModal(true)}
          className="flex items-center gap-2 bg-[#161616] text-white px-4 py-2 rounded-[6px] text-xs font-bold hover:opacity-90 transition-all"
        >
          <Plus className="w-4 h-4" /> NEW REQUEST
        </button>
      </div>

      <div className="grid grid-cols-3 gap-4">
        <div className="bg-white border border-[#DFDFDF] rounded-[6px] p-5">
          <div className="text-[10px] font-bold text-[#161616]/30 uppercase tracking-widest mb-2">Pending Approvals</div>
          <div className="text-2xl font-bold text-[#161616] tabular-nums">{pendingCount}</div>
        </div>
        <div className="bg-white border border-[#DFDFDF] rounded-[6px] p-5">
          <div className="text-[10px] font-bold text-[#161616]/30 uppercase tracking-widest mb-2">Volume in Transit</div>
          <div className="text-2xl font-bold text-[#161616] tabular-nums">${transitVolume.toLocaleString()}</div>
        </div>
        <div className="bg-[#161616] rounded-[6px] p-5">
          <div className="text-[10px] font-bold text-white/30 uppercase tracking-widest mb-2">Documents Approved</div>
          <div className="text-2xl font-bold text-white tabular-nums">{approvedDocs}</div>
        </div>
      </div>

      <div className="flex gap-1 bg-[#F9F9F9] border border-[#DFDFDF] p-1 rounded-[6px] w-fit">
        {(['all', 'payment', 'paperwork'] as const).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`px-4 py-1.5 rounded-[4px] text-[11px] font-bold uppercase tracking-wider transition-all ${
              tab === t ? 'bg-[#161616] text-white shadow-sm' : 'text-[#161616]/40 hover:text-[#161616]/70'
            }`}
          >
            {t === 'all' ? 'All' : t === 'payment' ? 'Payments' : 'Paperwork'}
          </button>
        ))}
      </div>

      {isLoading ? (
        <div className="bg-white border border-[#DFDFDF] rounded-[6px] p-12 text-center text-[#161616]/30 italic text-sm">Loading requests...</div>
      ) : (
        <div className="bg-white border border-[#DFDFDF] rounded-[6px] overflow-hidden">
          <table className="w-full border-collapse">
            <thead>
              <tr className="border-b border-[#DFDFDF]">
                {['Type', 'Related ID', 'Requested By', 'Status', 'Link', 'Actions'].map((h) => (
                  <th key={h} className="text-left px-5 py-3 text-[10px] font-bold text-[#161616]/30 uppercase tracking-widest">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filtered.length === 0 ? (
                <tr><td colSpan={6} className="px-5 py-16 text-center text-[#161616]/30 italic text-sm">No requests found.</td></tr>
              ) : (
                filtered.map((req) => {
                  const conf = TYPE_CONFIG[req.type] || TYPE_CONFIG['payment'];
                  const link = req.paymentLink || req.documentUrl;
                  return (
                    <tr key={req.id} className="border-b border-[#DFDFDF] last:border-0 hover:bg-[#F9F9F9] transition-colors">
                      <td className="px-5 py-3.5">
                        <div className="flex items-center gap-2 text-[#161616]/50">
                          {conf.icon}
                          <span className="text-[11px] font-bold uppercase tracking-wider">{conf.label}</span>
                        </div>
                      </td>
                      <td className="px-5 py-3.5 text-xs font-mono text-[#161616]/40">
                        {(() => {
                          const deal = deals.find(d => d.id === req.relatedDealId);
                          const leadId = deal ? deal.leadId : req.relatedDealId;
                          const lead = leads.find(l => l.id === leadId);
                          return lead?.name || req.relatedDealId;
                        })()}
                      </td>
                      <td className="px-5 py-3.5 text-sm text-[#161616]/60">
                        {users.find(u => u.id === req.requestedBy)?.username || req.requestedBy}
                      </td>
                      <td className="px-5 py-3.5">
                        <span className={`px-2 py-0.5 rounded-[3px] text-[10px] font-bold uppercase tracking-wider ${STATUS_BADGE[req.status as keyof typeof STATUS_BADGE] || 'border border-[#161616]/20 text-[#161616]/50'}`}>
                          {req.status}
                        </span>
                      </td>
                      <td className="px-5 py-3.5">
                        {link ? (
                          <a href={link} target="_blank" rel="noreferrer" className="flex items-center gap-1 text-[#161616] hover:underline text-[10px] font-bold uppercase">
                            <ExternalLink className="w-3 h-3" /> OPEN LINK
                          </a>
                        ) : (
                          <span className="text-[10px] text-[#161616]/20 font-mono italic">—</span>
                        )}
                      </td>
                      <td className="px-5 py-3.5">
                        <button 
                          onClick={() => setViewRequest(req)}
                          className="text-[10px] font-bold text-[#161616]/50 border border-[#DFDFDF] px-2 py-1 rounded-[4px] hover:border-[#161616]/30 hover:text-[#161616] transition-all"
                        >
                          {req.status === 'Pending' && (role === 'SUPER_ADMIN' || role === 'ADMIN') ? 'APPROVE' : 'VIEW'}
                        </button>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      )}

      {/* New Request Modal */}
      {showModal && (
        <div className="fixed inset-0 bg-[#161616]/20 backdrop-blur-sm flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-[6px] border border-[#DFDFDF] w-full max-w-[400px] shadow-2xl overflow-hidden">
            <div className="px-6 py-4 border-b border-[#DFDFDF] flex justify-between items-center">
              <h3 className="text-sm font-bold text-[#161616] uppercase tracking-widest">New Admin Request</h3>
              <button onClick={() => setShowModal(false)} className="text-[#161616]/30 hover:text-[#161616]">✕</button>
            </div>
            <form onSubmit={handleCreateRequest} className="p-6 flex flex-col gap-4">
              <div>
                <label className="text-[10px] font-bold text-[#161616]/40 uppercase tracking-widest block mb-1">Request Type</label>
                <div className="flex gap-2">
                  {(['payment', 'paperwork'] as const).map(t => (
                    <button 
                      key={t} type="button" onClick={() => setFormData({...formData, type: t})}
                      className={`flex-1 py-2 rounded-[4px] text-xs font-bold border transition-all ${formData.type === t ? 'bg-[#161616] text-white border-[#161616]' : 'border-[#DFDFDF] text-[#161616]/50'}`}
                    >
                      {t.toUpperCase()}
                    </button>
                  ))}
                </div>
              </div>
              <div>
                <label className="text-[10px] font-bold text-[#161616]/40 uppercase tracking-widest block mb-1">Related Client / Lead</label>
                <select 
                  required value={formData.relatedDealId} onChange={e => setFormData({...formData, relatedDealId: e.target.value})}
                  className="w-full px-3 py-2 border border-[#DFDFDF] rounded-[4px] text-sm focus:outline-none focus:border-[#161616]/50 bg-white"
                >
                  <option value="">— Select Client/Lead —</option>
                  <optgroup label="Active Leads">
                    {leads.filter(l => l.status !== 'Converted').map(l => (
                      <option key={l.id} value={l.id}>{l.name} (Lead)</option>
                    ))}
                  </optgroup>
                  <optgroup label="Won Deals">
                    {deals.filter(d => d.status === 'Won').map(d => (
                      <option key={d.id} value={d.id}>{d.clientName || d.id} (Deal)</option>
                    ))}
                  </optgroup>
                </select>
              </div>
              <div>
                <label className="text-[10px] font-bold text-[#161616]/40 uppercase tracking-widest block mb-1">Additional Notes</label>
                <textarea 
                  value={formData.notes} onChange={e => setFormData({...formData, notes: e.target.value})}
                  className="w-full px-3 py-2 border border-[#DFDFDF] rounded-[4px] text-sm focus:outline-none focus:border-[#161616]/50 min-h-[80px] resize-none" 
                />
              </div>
              <div className="flex justify-end gap-2 mt-2">
                <button type="button" onClick={() => setShowModal(false)} className="px-4 py-2 text-xs font-bold text-[#161616]/50 hover:text-[#161616]">CANCEL</button>
                <button type="submit" disabled={isSaving} className="bg-[#161616] text-white px-5 py-2 rounded-[4px] text-xs font-bold hover:opacity-90 disabled:opacity-50">
                  {isSaving ? 'SENDING...' : 'SUBMIT REQUEST'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* View/Approve Request Modal */}
      {viewRequest && (
        <div className="fixed inset-0 bg-[#161616]/20 backdrop-blur-sm flex items-center justify-center z-50">
          <div className="bg-white rounded-[6px] shadow-xl border border-[#DFDFDF] w-[450px] overflow-hidden">
            <div className="flex justify-between items-center px-6 py-4 border-b border-[#DFDFDF]">
              <div className="flex items-center gap-2">
                <div className={`p-1.5 rounded-[4px] ${viewRequest.type === 'payment' ? 'bg-[#161616] text-white' : 'bg-[#DFDFDF] text-[#161616]'}`}>
                  {TYPE_CONFIG[viewRequest.type]?.icon}
                </div>
                <h3 className="text-[14px] font-bold text-[#161616] tracking-tight capitalize">{viewRequest.type} Request</h3>
              </div>
              <button onClick={() => { setViewRequest(null); setApprovalLink(''); }} className="text-[#161616]/30 hover:text-[#161616]">✕</button>
            </div>
            
            <div className="p-6 flex flex-col gap-5">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <div className="text-[10px] font-bold text-[#161616]/40 uppercase tracking-widest mb-1">Status</div>
                  <span className={`px-2 py-0.5 rounded-[3px] text-[10px] font-bold uppercase tracking-wider ${STATUS_BADGE[viewRequest.status as keyof typeof STATUS_BADGE] || 'border border-[#161616]/20 text-[#161616]/50'}`}>
                    {viewRequest.status}
                  </span>
                </div>
                <div>
                  <div className="text-[10px] font-bold text-[#161616]/40 uppercase tracking-widest mb-1">Requested By</div>
                  <div className="text-sm font-medium text-[#161616]">
                    {users.find(u => u.id === viewRequest.requestedBy)?.username || viewRequest.requestedBy}
                  </div>
                </div>
              </div>

              <div>
                <div className="text-[10px] font-bold text-[#161616]/40 uppercase tracking-widest mb-1">Additional Notes</div>
                <div className="bg-[#F9F9F9] border border-[#DFDFDF] rounded-[6px] p-4 text-sm text-[#161616]/80 whitespace-pre-wrap min-h-[60px]">
                  {viewRequest.notes || <span className="text-[#161616]/30 italic">No notes provided.</span>}
                </div>
              </div>

              {viewRequest.status === 'Pending' && (role === 'SUPER_ADMIN' || role === 'ADMIN') ? (
                <div className="bg-[#F9F9F9] border border-[#DFDFDF] p-4 rounded-[6px]">
                  <label className="text-[10px] font-bold text-[#161616]/40 uppercase tracking-widest block mb-2">
                    {viewRequest.type === 'payment' ? 'Enter Payment Link' : 'Enter Document/Paperwork URL'}
                  </label>
                  <div className="flex gap-2">
                    <div className="relative flex-1">
                      <LinkIcon className="absolute left-3 top-2.5 w-3.5 h-3.5 text-[#161616]/20" />
                      <input 
                        type="url" value={approvalLink} onChange={e => setApprovalLink(e.target.value)}
                        placeholder="https://..."
                        className="w-full pl-9 pr-3 py-2 border border-[#DFDFDF] rounded-[4px] text-sm focus:outline-none focus:border-[#161616]/50 bg-white"
                      />
                    </div>
                  </div>
                  <p className="text-[9px] text-[#161616]/40 mt-2 italic">* This link will be shared with the requester upon approval.</p>
                </div>
              ) : (viewRequest.paymentLink || viewRequest.documentUrl) && (
                <div>
                  <div className="text-[10px] font-bold text-[#161616]/40 uppercase tracking-widest mb-1">Resource Link</div>
                  <a href={viewRequest.paymentLink || viewRequest.documentUrl} target="_blank" rel="noreferrer" className="flex items-center gap-2 p-3 border border-[#DFDFDF] rounded-[6px] text-sm font-bold text-[#161616] hover:bg-[#F9F9F9]">
                    <LinkIcon className="w-4 h-4" /> OPEN RESOURCE <ExternalLink className="w-3 h-3 ml-auto" />
                  </a>
                </div>
              )}
            </div>

            <div className="px-6 py-4 border-t border-[#DFDFDF] flex justify-end gap-3 bg-[#F9F9F9]">
              <button 
                onClick={() => { setViewRequest(null); setApprovalLink(''); }}
                className="px-4 py-2 text-xs font-bold text-[#161616]/60 border border-[#DFDFDF] bg-white rounded-[4px]"
              >
                CLOSE
              </button>
              {viewRequest.status === 'Pending' && (role === 'SUPER_ADMIN' || role === 'ADMIN') && (
                <button 
                  onClick={() => handleApprove(viewRequest.id, viewRequest.type)}
                  disabled={isSaving || !approvalLink}
                  className="bg-[#161616] text-white px-5 py-2 rounded-[4px] text-xs font-bold hover:opacity-90 disabled:opacity-50"
                >
                  {isSaving ? 'PROCESSING...' : 'APPROVE & SEND'}
                </button>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
