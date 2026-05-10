import React, { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { api } from '../api/services';
import { Lead, Log, AdminRequest } from '../types';
import { useAuth } from '../context/AuthContext';
import { 
  ArrowLeft, Phone, Mail, MessageSquare, Calendar, 
  DollarSign, FileText, User, Send, CheckCircle, Clock,
  ExternalLink, ShieldAlert
} from 'lucide-react';
import { STATUS_BADGE } from '../utils/badges';

export const LeadDetail: React.FC = () => {
  const { id } = useParams();
  const navigate = useNavigate();
  const { role, user } = useAuth();
  const [lead, setLead] = useState<Lead | null>(null);
  const [logs, setLogs] = useState<Log[]>([]);
  const [requests, setRequests] = useState<AdminRequest[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [newLog, setNewLog] = useState('');
  const [logType, setLogType] = useState<'call' | 'message' | 'email'>('call');
  
  // Conversion state
  const [isConverting, setIsConverting] = useState(false);
  const [dealValue, setDealValue] = useState(0);

  const fetchData = async () => {
    if (id) {
      try {
        setIsLoading(true);
        // Fetch lead, logs, and requests in parallel
        const [leadData, logsData, requestsData] = await Promise.all([
          api.leads.getById(id),
          api.logs.getByEntity(id),
          api.adminRequests.getAll()
        ]);

        if (leadData) setLead(leadData);
        setLogs(logsData || []);
        
        // Filter requests related to this lead (by relatedDealId)
        setRequests((requestsData || []).filter(r => r.relatedDealId === id));
      } catch (err) {
        console.error('Failed to fetch data:', err);
      } finally {
        setIsLoading(false);
      }
    }
  };

  useEffect(() => {
    fetchData();
  }, [id]);

  const handleLogActivity = async () => {
    if (!newLog.trim() || !id || !user) return;
    try {
      await api.logs.create({
        entityId: id,
        entityType: 'Lead',
        action: logType.toUpperCase(),
        userId: user.id,
        details: newLog
      });
      setNewLog('');
      fetchData();
    } catch (err: any) {
      console.error(err);
      alert('Failed to log activity: ' + (err.message || 'Check your connection'));
    }
  };

  const handleUpdateStatus = async (status: Lead['status']) => {
    if (!id || !user) return;
    try {
      await api.leads.update(id, { status });
      await api.logs.create({
        entityId: id,
        entityType: 'Lead',
        action: 'STATUS_CHANGE',
        userId: user.id,
        details: `Status updated to ${status}`
      });
      fetchData();
    } catch (err) {
      console.error(err);
    }
  };

  const handleConvertToDeal = async () => {
    if (!id || !user || dealValue <= 0) {
      alert('Please enter a valid deal value.');
      return;
    }
    if (!window.confirm(`Convert ${lead?.name} to a Deal with value $${dealValue}?`)) return;

    setIsConverting(true);
    try {
      await api.leads.convertToDeal(id, user.id, dealValue);
      alert('Lead successfully converted to Deal!');
      navigate('/deals');
    } catch (err: any) {
      console.error(err);
      alert('Failed to convert lead: ' + (err.message || 'Ensure the backend is responding.'));
    } finally {
      setIsConverting(false);
    }
  };

  const handleRequest = async (type: 'payment' | 'paperwork') => {
    if (!id || !user) return;
    
    // Check if a pending request of this type already exists
    const existing = requests.find(r => r.type === type && r.status === 'Pending');
    if (existing) {
      alert(`A pending ${type} request already exists for this lead.`);
      return;
    }

    try {
      await api.adminRequests.create({
        type,
        relatedDealId: id,
        requestedBy: user.id,
        status: 'Pending',
        notes: `Requested from Lead Detail for ${lead?.name}`
      });
      await api.logs.create({
        entityId: id,
        entityType: 'Lead',
        action: 'REQUEST',
        userId: user.id,
        details: `Requested ${type}`
      });
      alert(`${type.charAt(0).toUpperCase() + type.slice(1)} request sent to Admin.`);
      fetchData();
    } catch (err) {
      console.error(err);
      alert('Request failed. Please try again.');
    }
  };

  if (isLoading) return (
    <div className="flex flex-col items-center justify-center py-20 gap-4">
      <div className="w-8 h-8 border-2 border-[#161616] border-t-transparent rounded-full animate-spin"></div>
      <p className="text-[10px] font-bold text-[#161616]/40 uppercase tracking-widest">Syncing Lead Data...</p>
    </div>
  );
  
  if (!lead) return (
    <div className="bg-white border border-[#DFDFDF] rounded-[6px] p-12 text-center shadow-sm">
      <p className="font-bold text-[#161616]/60">Lead not found or has been deleted.</p>
      <button onClick={() => navigate('/leads')} className="mt-3 text-[11px] font-bold text-[#161616]/40 hover:text-[#161616] transition-all uppercase tracking-widest">← Back to Leads</button>
    </div>
  );

  const guidanceLogs = logs.filter(l => l.action === 'GUIDANCE');

  return (
    <div className="flex flex-col gap-6">
      {/* Header */}
      <div className="flex justify-between items-center">
        <button onClick={() => navigate('/leads')} className="flex items-center gap-2 text-[11px] font-bold text-[#161616]/40 hover:text-[#161616] transition-colors uppercase tracking-widest">
          <ArrowLeft className="w-4 h-4" /> Back to Leads
        </button>
        <div className="flex gap-2">
          <button 
            disabled={lead.status === 'Converted'}
            onClick={() => handleRequest('payment')} 
            className="flex items-center gap-2 border border-[#DFDFDF] text-[#161616]/60 px-4 py-2 rounded-[6px] text-xs font-bold hover:border-[#161616]/40 transition-all disabled:opacity-30 disabled:cursor-not-allowed"
          >
            <DollarSign className="w-3.5 h-3.5" /> REQUEST PAYMENT
          </button>
          <button 
            disabled={lead.status === 'Converted'}
            onClick={() => handleRequest('paperwork')} 
            className="flex items-center gap-2 border border-[#DFDFDF] text-[#161616]/60 px-4 py-2 rounded-[6px] text-xs font-bold hover:border-[#161616]/40 transition-all disabled:opacity-30 disabled:cursor-not-allowed"
          >
            <FileText className="w-3.5 h-3.5" /> REQUEST PAPERWORK
          </button>
          
          {lead.status !== 'Converted' && lead.status !== 'Closed' && (
            <div className="flex items-center gap-2 bg-[#161616] rounded-[6px] pl-3 pr-1 py-1 shadow-lg border border-[#161616]">
              <div className="flex items-center text-white/40 text-[10px] font-bold">$</div>
              <input 
                type="number" 
                placeholder="Value" 
                className="w-16 bg-transparent text-white text-xs border-0 focus:outline-none placeholder:text-white/20 font-bold" 
                value={dealValue || ''} 
                onChange={e => setDealValue(Number(e.target.value))}
              />
              <button 
                onClick={handleConvertToDeal}
                disabled={isConverting || !dealValue}
                className="bg-white text-[#161616] px-3 py-1 rounded-[4px] text-[10px] font-black uppercase tracking-widest hover:opacity-90 transition-all disabled:opacity-20"
              >
                {isConverting ? '...' : 'CONVERT'}
              </button>
            </div>
          )}
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Left Col */}
        <div className="flex flex-col gap-4">
          {/* Profile Card */}
          <div className="bg-white border border-[#DFDFDF] rounded-[6px] p-6 flex flex-col items-center text-center shadow-sm">
            <div className="w-20 h-20 rounded-full bg-[#F9F9F9] border border-[#DFDFDF] flex items-center justify-center mb-4 text-[#161616]/20 font-black text-2xl">
              {lead.name[0]}
            </div>
            <h2 className="text-xl font-bold text-[#161616] tracking-tight">{lead.name}</h2>
            <span className={`mt-2 px-2.5 py-1 rounded-[4px] text-[10px] font-black uppercase tracking-widest ${STATUS_BADGE[lead.status]}`}>
              {lead.status}
            </span>
            <div className="w-full mt-6 pt-5 border-t border-[#DFDFDF] flex flex-col gap-4 text-left">
              <div className="group cursor-pointer">
                <p className="text-[9px] font-bold text-[#161616]/30 uppercase tracking-widest mb-1">Email Address</p>
                <div className="flex items-center gap-2 text-sm text-[#161616]/70 font-medium group-hover:text-[#161616] transition-all">
                  <Mail className="w-3.5 h-3.5" /> {lead.email}
                </div>
              </div>
              <div className="group cursor-pointer">
                <p className="text-[9px] font-bold text-[#161616]/30 uppercase tracking-widest mb-1">Phone Number</p>
                <div className="flex items-center gap-2 text-sm text-[#161616]/70 font-medium group-hover:text-[#161616] transition-all">
                  <Phone className="w-3.5 h-3.5" /> {lead.phone}
                </div>
              </div>
              {lead.linkedin && (
                <div className="group cursor-pointer">
                  <p className="text-[9px] font-bold text-[#161616]/30 uppercase tracking-widest mb-1">LinkedIn Profile</p>
                  <a 
                    href={lead.linkedin} target="_blank" rel="noopener noreferrer"
                    className="flex items-center gap-2 text-sm text-blue-600 font-medium hover:underline transition-all"
                  >
                    <ExternalLink className="w-3.5 h-3.5" /> Profile Link
                  </a>
                </div>
              )}
              <div>
                <p className="text-[9px] font-bold text-[#161616]/30 uppercase tracking-widest mb-1">Acquisition Date</p>
                <div className="flex items-center gap-2 text-sm text-[#161616]/40 font-medium">
                  <Calendar className="w-3.5 h-3.5" /> {new Date(lead.createdAt).toLocaleDateString(undefined, { dateStyle: 'long' })}
                </div>
              </div>
            </div>
          </div>

          {/* Admin Requests Status */}
          {requests.length > 0 && (
            <div className="bg-white border border-[#DFDFDF] rounded-[6px] p-5 shadow-sm">
              <h3 className="text-[10px] font-black text-[#161616] uppercase tracking-widest mb-4 flex items-center gap-2">
                <ShieldAlert className="w-3.5 h-3.5" /> Admin Fulfillment
              </h3>
              <div className="flex flex-col gap-3">
                {requests.map(r => (
                  <div key={r.id} className="p-3 rounded-[6px] bg-[#F9F9F9] border border-[#DFDFDF]">
                    <div className="flex justify-between items-center mb-2">
                      <span className="text-[10px] font-bold uppercase text-[#161616]/60">{r.type} Request</span>
                      <span className={`px-1.5 py-0.5 rounded-[3px] text-[8px] font-black uppercase tracking-tighter ${r.status === 'Approved' || r.status === 'Paid' || r.status === 'Sent' ? 'bg-[#161616] text-white' : 'bg-[#DFDFDF] text-[#161616]'}`}>
                        {r.status}
                      </span>
                    </div>
                    {(r as any).paymentLink || (r as any).documentUrl ? (
                      <a 
                        href={(r as any).paymentLink || (r as any).documentUrl} 
                        target="_blank" rel="noopener noreferrer"
                        className="flex items-center justify-center gap-2 w-full bg-[#161616] text-white py-2 rounded-[4px] text-[10px] font-bold hover:opacity-90 transition-all uppercase tracking-widest"
                      >
                        <ExternalLink className="w-3 h-3" /> OPEN {r.type.toUpperCase()}
                      </a>
                    ) : (
                      <div className="flex items-center gap-2 text-[10px] text-[#161616]/30 italic py-1">
                        <Clock className="w-3 h-3" /> Awaiting Admin...
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Status Update (Vertical Stack) */}
          {lead.status !== 'Converted' && (
            <div className="bg-white border border-[#DFDFDF] rounded-[6px] p-5 shadow-sm">
              <h3 className="text-[10px] font-black text-[#161616]/30 uppercase tracking-widest mb-4">Lifecycle Stage</h3>
              <div className="flex flex-col gap-1.5">
                {(['New', 'Contacted', 'Qualified', 'Closed'] as const).map((s) => (
                  <button 
                    key={s} 
                    onClick={() => handleUpdateStatus(s)}
                    className={`w-full py-2.5 px-4 rounded-[6px] text-xs font-bold text-left transition-all ${lead.status === s ? 'bg-[#161616] text-white shadow-md' : 'text-[#161616]/40 hover:bg-[#F9F9F9] hover:text-[#161616]'}`}
                  >
                    <div className="flex items-center justify-between">
                      <span>{s}</span>
                      {lead.status === s && <CheckCircle className="w-3.5 h-3.5" />}
                    </div>
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Right Col */}
        <div className="lg:col-span-2 flex flex-col gap-4">
          {/* Interaction Timeline */}
          <div className="bg-white border border-[#DFDFDF] rounded-[6px] p-6 shadow-sm min-h-[400px]">
            <h3 className="text-[10px] font-black text-[#161616]/30 uppercase tracking-widest mb-8">Activity Feed</h3>
            <div className="flex flex-col gap-8 relative ml-2">
              <div className="absolute left-[7px] top-2 bottom-2 w-px bg-[#DFDFDF]"></div>
              {logs.length === 0 ? (
                <div className="text-[11px] text-[#161616]/30 italic ml-6">No interactions recorded for this lead.</div>
              ) : (
                logs.slice().reverse().map((item) => (
                  <div key={item.id} className="flex gap-6 relative group">
                    <div className={`w-3.5 h-3.5 rounded-full shrink-0 mt-1 z-10 border-2 transition-all group-hover:scale-125 ${item.action === 'SYSTEM' || item.action === 'STATUS_CHANGE' ? 'border-[#DFDFDF] bg-white' : 'border-[#161616] bg-[#161616]'}`}></div>
                    <div className="flex-1">
                      <div className="flex justify-between items-baseline mb-2">
                        <div className="flex items-center gap-2">
                          <span className="text-xs font-black text-[#161616] uppercase tracking-wider">{item.action}</span>
                          <span className="text-[10px] font-bold text-[#161616]/20 uppercase">by {item.userId === user?.id ? 'You' : item.userId}</span>
                        </div>
                        <span className="text-[10px] font-mono text-[#161616]/30">{new Date(item.timestamp).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })}</span>
                      </div>
                      <div className={`bg-[#F9F9F9] border border-[#DFDFDF] rounded-[8px] p-4 text-sm text-[#161616]/70 leading-relaxed ${item.action === 'GUIDANCE' ? 'border-l-4 border-l-[#161616]' : ''}`}>
                        {item.details}
                      </div>
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>

          {/* Log Action Box */}
          {lead.status !== 'Converted' && (
            <div className="bg-[#161616] rounded-[6px] p-6 shadow-xl">
              <h3 className="text-[10px] font-black text-white/30 uppercase tracking-widest mb-5">Log New Interaction</h3>
              <div className="flex gap-3 mb-5">
                {([{ key: 'call', icon: Phone, label: 'Call' }, { key: 'message', icon: MessageSquare, label: 'WhatsApp' }, { key: 'email', icon: Mail, label: 'Email' }] as const).map(({ key, icon: Icon, label }) => (
                  <button 
                    key={key} 
                    onClick={() => setLogType(key)} 
                    className={`flex items-center gap-2 px-4 py-2 rounded-[6px] text-[11px] font-black transition-all uppercase tracking-widest ${logType === key ? 'bg-white text-[#161616]' : 'border border-white/10 text-white/40 hover:border-white/30 hover:text-white'}`}
                  >
                    <Icon className="w-3.5 h-3.5" />{label}
                  </button>
                ))}
              </div>
              <textarea 
                value={newLog} 
                onChange={(e) => setNewLog(e.target.value)} 
                placeholder={`Describe the details of your ${logType}...`} 
                className="w-full min-h-[120px] px-5 py-4 bg-white/5 border border-white/10 rounded-[8px] text-sm focus:outline-none focus:border-white/30 resize-none text-white placeholder:text-white/10 mb-4" 
              />
              <div className="flex justify-end">
                <button 
                  onClick={handleLogActivity} 
                  disabled={!newLog.trim()} 
                  className="flex items-center gap-2 bg-white text-[#161616] px-6 py-3 rounded-[6px] text-[11px] font-black hover:opacity-90 transition-all disabled:opacity-20 uppercase tracking-widest"
                >
                  <Send className="w-4 h-4" /> COMMIT LOG
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
