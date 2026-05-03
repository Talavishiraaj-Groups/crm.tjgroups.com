import React, { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { api } from '../api/services';
import { Lead, Log } from '../types';
import { useAuth } from '../context/AuthContext';
import { ArrowLeft, Phone, Mail, MessageSquare, Calendar, DollarSign, FileText, User, Send, CheckCircle } from 'lucide-react';
import { STATUS_BADGE } from '../utils/badges';

export const LeadDetail: React.FC = () => {
  const { id } = useParams();
  const navigate = useNavigate();
  const { role, user } = useAuth();
  const [lead, setLead] = useState<Lead | null>(null);
  const [logs, setLogs] = useState<Log[]>([]);
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
        // Fetch lead
        try {
          const leadData = await api.leads.getById(id);
          if (leadData) setLead(leadData);
        } catch (err) {
          console.error('Failed to fetch lead:', err);
        }

        // Fetch logs separately
        try {
          const logsData = await api.logs.getByEntity(id);
          setLogs(logsData || []);
        } catch (err) {
          console.error('Failed to fetch logs (might be missing in backend):', err);
          setLogs([]);
        }
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
    } catch (err) {
      console.error(err);
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
    if (!id || !user || dealValue <= 0) return;
    setIsConverting(true);
    try {
      await api.leads.convertToDeal(id, user.id, dealValue);
      alert('Lead successfully converted to Deal!');
      navigate('/deals');
    } catch (err) {
      console.error(err);
      alert('Failed to convert lead');
    } finally {
      setIsConverting(false);
    }
  };

  const handleRequest = async (type: 'payment' | 'paperwork') => {
    if (!id || !user) return;
    try {
      await api.adminRequests.create({
        type,
        relatedDealId: id, // In this case it's the lead id as placeholder or related info
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
    }
  };

  const handleAddGuidance = async () => {
    const note = prompt('Enter guidance note for the team:');
    if (!note || !id || !user) return;
    try {
      await api.logs.create({
        entityId: id,
        entityType: 'Lead',
        action: 'GUIDANCE',
        userId: user.id,
        details: note
      });
      fetchData();
    } catch (err) {
      console.error(err);
    }
  };

  if (isLoading) return <div className="bg-white border border-[#DFDFDF] rounded-[6px] p-12 text-center text-[#161616]/30 italic text-sm">Loading...</div>;
  if (!lead) return (
    <div className="bg-white border border-[#DFDFDF] rounded-[6px] p-12 text-center">
      <p className="font-bold text-[#161616]/60">Lead not found.</p>
      <button onClick={() => navigate('/leads')} className="mt-3 text-sm text-[#161616]/40 hover:underline">← Back to Leads</button>
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
          <button onClick={() => handleRequest('payment')} className="flex items-center gap-2 border border-[#DFDFDF] text-[#161616]/60 px-4 py-2 rounded-[6px] text-xs font-bold hover:border-[#161616]/40 transition-all">
            <DollarSign className="w-3.5 h-3.5" /> REQUEST PAYMENT
          </button>
          <button onClick={() => handleRequest('paperwork')} className="flex items-center gap-2 border border-[#DFDFDF] text-[#161616]/60 px-4 py-2 rounded-[6px] text-xs font-bold hover:border-[#161616]/40 transition-all">
            <FileText className="w-3.5 h-3.5" /> REQUEST PAPERWORK
          </button>
          
          {lead.status !== 'Closed' && (
            <div className="flex items-center gap-2 bg-[#161616] rounded-[6px] pl-3 pr-1 py-1">
              <input 
                type="number" 
                placeholder="Value" 
                className="w-16 bg-transparent text-white text-xs border-0 focus:outline-none placeholder:text-white/30" 
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
        {/* Left */}
        <div className="flex flex-col gap-4">
          {/* Profile */}
          <div className="bg-white border border-[#DFDFDF] rounded-[6px] p-6 flex flex-col items-center text-center">
            <div className="w-16 h-16 rounded-full bg-[#DFDFDF] flex items-center justify-center mb-4">
              <User className="w-8 h-8 text-[#161616]/25" />
            </div>
            <h2 className="text-xl font-bold text-[#161616] tracking-tight">{lead.name}</h2>
            <span className={`mt-2 px-2 py-0.5 rounded-[3px] text-[10px] font-bold uppercase tracking-wider ${STATUS_BADGE[lead.status]}`}>
              {lead.status}
            </span>
            <div className="w-full mt-5 pt-4 border-t border-[#DFDFDF] flex flex-col gap-3 text-left">
              <div className="flex items-center gap-3">
                <Mail className="w-4 h-4 text-[#161616]/20 shrink-0" />
                <span className="text-sm text-[#161616]/60 break-all">{lead.email}</span>
              </div>
              <div className="flex items-center gap-3">
                <Phone className="w-4 h-4 text-[#161616]/20 shrink-0" />
                <span className="text-sm text-[#161616]/60">{lead.phone}</span>
              </div>
              <div className="flex items-center gap-3">
                <Calendar className="w-4 h-4 text-[#161616]/20 shrink-0" />
                <span className="text-sm text-[#161616]/60">Created {new Date(lead.createdAt).toLocaleDateString()}</span>
              </div>
              {lead.linkedin && (
                <div className="flex items-center gap-3">
                  <span className="w-4 h-4 text-[#161616]/20 shrink-0 flex items-center justify-center font-bold text-[10px]">in</span>
                  <a href={lead.linkedin} target="_blank" rel="noopener noreferrer" className="text-sm text-[#161616]/60 hover:text-[#161616] hover:underline truncate">
                    LinkedIn Profile
                  </a>
                </div>
              )}
            </div>
          </div>

          {/* Status update */}
          <div className="bg-white border border-[#DFDFDF] rounded-[6px] p-5">
            <h3 className="text-[10px] font-bold text-[#161616]/30 uppercase tracking-widest mb-3">Update Status</h3>
            <div className="flex flex-col gap-1.5">
              {(['New', 'Contacted', 'Qualified', 'Closed'] as const).map((s) => (
                <button 
                  key={s} 
                  onClick={() => handleUpdateStatus(s)}
                  className={`w-full py-2 px-3 rounded-[4px] text-xs font-bold text-left transition-all ${lead.status === s ? 'bg-[#161616] text-white' : 'text-[#161616]/50 hover:bg-[#F9F9F9] hover:text-[#161616]'}`}
                >
                  {lead.status === s && <span className="mr-2 opacity-60">✓</span>}{s}
                </button>
              ))}
            </div>
          </div>

          {/* Notes */}
          <div className="bg-[#161616] rounded-[6px] p-5">
            <h3 className="text-[10px] font-bold text-white/30 uppercase tracking-widest mb-3">Internal Notes</h3>
            <p className="text-sm text-white/60 leading-relaxed">{lead.notes || 'No internal notes.'}</p>
          </div>
        </div>

        {/* Right */}
        <div className="lg:col-span-2 flex flex-col gap-4">
          {/* Timeline */}
          <div className="bg-white border border-[#DFDFDF] rounded-[6px] p-6">
            <h3 className="text-[10px] font-bold text-[#161616]/30 uppercase tracking-widest mb-6">Conversation Timeline</h3>
            <div className="flex flex-col gap-6 relative">
              {logs.length === 0 ? (
                <div className="text-[11px] text-[#161616]/30 italic">No activity logged yet.</div>
              ) : (
                logs.map((item, i) => (
                  <div key={item.id} className="flex gap-4 relative">
                    {i < logs.length - 1 && (
                      <div className="absolute left-[7px] top-5 bottom-0 w-px bg-[#DFDFDF]"></div>
                    )}
                    <div className={`w-3.5 h-3.5 rounded-full shrink-0 mt-0.5 z-10 border-2 ${item.action === 'SYSTEM' || item.action === 'STATUS_CHANGE' ? 'border-[#DFDFDF] bg-white' : 'border-[#161616] bg-[#161616]'}`}></div>
                    <div className="flex-1">
                      <div className="flex justify-between items-center mb-1">
                        <span className="text-sm font-bold text-[#161616]">{item.action}</span>
                        <span className="text-[10px] text-[#161616]/30">{new Date(item.timestamp).toLocaleString()}</span>
                      </div>
                      <div className={`bg-[#F9F9F9] border border-[#DFDFDF] rounded-[6px] p-3 text-sm text-[#161616]/60 ${item.action === 'GUIDANCE' ? 'border-l-4 border-l-[#161616]' : ''}`}>{item.details}</div>
                      <div className="text-[9px] text-[#161616]/20 mt-1 font-mono uppercase tracking-tighter">Logged by: {item.userId}</div>
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>

          {/* Log Interaction */}
          <div className="bg-white border border-[#DFDFDF] rounded-[6px] p-6">
            <h3 className="text-[10px] font-bold text-[#161616]/30 uppercase tracking-widest mb-4">Log Interaction</h3>
            <div className="flex gap-2 mb-4">
              {([{ key: 'call', icon: Phone, label: 'Call' }, { key: 'message', icon: MessageSquare, label: 'WhatsApp' }, { key: 'email', icon: Mail, label: 'Email' }] as const).map(({ key, icon: Icon, label }) => (
                <button key={key} onClick={() => setLogType(key)} className={`flex items-center gap-2 px-3 py-1.5 rounded-[4px] text-xs font-bold transition-all ${logType === key ? 'bg-[#161616] text-white' : 'border border-[#DFDFDF] text-[#161616]/50 hover:border-[#161616]/40'}`}>
                  <Icon className="w-3 h-3" />{label}
                </button>
              ))}
            </div>
            <textarea value={newLog} onChange={(e) => setNewLog(e.target.value)} placeholder="Enter details of your interaction..." className="w-full min-h-[90px] px-4 py-3 border border-[#DFDFDF] rounded-[6px] text-sm focus:outline-none focus:border-[#161616]/50 resize-none text-[#161616]" />
            <div className="flex justify-end mt-3">
              <button onClick={handleLogActivity} disabled={!newLog.trim()} className="flex items-center gap-2 bg-[#161616] text-white px-5 py-2 rounded-[6px] text-xs font-bold hover:opacity-90 transition-all disabled:opacity-20">
                <Send className="w-3 h-3" /> LOG ACTIVITY
              </button>
            </div>
          </div>

          {/* Admin Guidance */}
          {(role === 'ADMIN' || role === 'SUPER_ADMIN') && (
            <div className="bg-[#F9F9F9] border border-[#DFDFDF] border-dashed rounded-[6px] p-6">
              <h3 className="text-[10px] font-bold text-[#161616]/30 uppercase tracking-widest mb-4">Admin Guidance Thread</h3>
              {guidanceLogs.length > 0 ? guidanceLogs.map(l => (
                <div key={l.id} className="bg-white border border-[#DFDFDF] rounded-[6px] p-4 mb-3">
                  <span className="text-[10px] font-bold text-[#161616] block mb-1 uppercase tracking-wider">Admin Note</span>
                  <p className="text-sm text-[#161616]/60">{l.details}</p>
                  <span className="text-[9px] text-[#161616]/30 mt-2 block">{new Date(l.timestamp).toLocaleString()}</span>
                </div>
              )) : (
                <div className="text-[11px] text-[#161616]/30 italic mb-4">No guidance notes yet.</div>
              )}
              <button onClick={handleAddGuidance} className="text-[11px] font-bold text-[#161616]/40 hover:text-[#161616] transition-colors">+ Add Guidance Note</button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
