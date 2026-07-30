import React, { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { api } from '../api/services';
import { Lead, Log, AdminRequest, User } from '../types';
import { useAuth } from '../context/AuthContext';
import { 
  ArrowLeft, Phone, Mail, MessageSquare, Calendar, 
  DollarSign, FileText, User as UserIcon, Send, CheckCircle, Clock,
  ExternalLink, ShieldAlert
} from 'lucide-react';
import { STATUS_BADGE } from '../utils/badges';
import { ZohoEmailViewer } from '../components/zoho/ZohoEmailViewer';

export const LeadDetail: React.FC = () => {
  const { id } = useParams();
  const navigate = useNavigate();
  const { role, user } = useAuth();
  const [lead, setLead] = useState<Lead | null>(null);
  const [logs, setLogs] = useState<Log[]>([]);
  const [requests, setRequests] = useState<AdminRequest[]>([]);
  const [users, setUsers] = useState<User[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [newLog, setNewLog] = useState('');
  // Conversion state
  const [isConverting, setIsConverting] = useState(false);
  const [dealValue, setDealValue] = useState(0);

  // Tab state
  const [activeRightTab, setActiveRightTab] = useState<'activity' | 'zoho'>('activity');

  // Zoho Mail States
  const [zohoEmails, setZohoEmails] = useState<any[]>([]);
  const [emailSubject, setEmailSubject] = useState('');
  const [isSendingEmail, setIsSendingEmail] = useState(false);
  const [isZohoLinked, setIsZohoLinked] = useState(false);
  const [isFetchingZoho, setIsFetchingZoho] = useState(false);
  const [logType, setLogType] = useState<'call' | 'message' | 'email'>('call');

  const fetchLeadEmailsForAdminOrUser = async (leadEmail: string, currentUser: User, targetLead: Lead | null, userList: User[]) => {
    const candidateIds: string[] = [];

    // 1. Current user
    if (currentUser?.id) candidateIds.push(currentUser.id);
    if (currentUser?.username && !candidateIds.includes(currentUser.username)) candidateIds.push(currentUser.username);

    // 2. Assigned reps on the lead
    if (targetLead?.setterId && !candidateIds.includes(targetLead.setterId)) candidateIds.push(targetLead.setterId);
    if (targetLead?.closerId && !candidateIds.includes(targetLead.closerId)) candidateIds.push(targetLead.closerId);
    if (targetLead?.ownerRepId && !candidateIds.includes(targetLead.ownerRepId)) candidateIds.push(targetLead.ownerRepId);

    // 3. All other team members
    userList.forEach(u => {
      if (u.id && !candidateIds.includes(u.id)) candidateIds.push(u.id);
      if (u.username && !candidateIds.includes(u.username)) candidateIds.push(u.username);
    });

    // Try each candidate ID until emails are found
    for (const candidateId of candidateIds) {
      try {
        const fetched = await api.zoho.getEmails(leadEmail, candidateId);
        if (Array.isArray(fetched) && fetched.length > 0) {
          return { emails: fetched, activeUserId: candidateId };
        }
      } catch (err) {
        // Try next candidate
      }
    }

    return { emails: [], activeUserId: currentUser?.id || '' };
  };

  const refreshZohoEmails = async () => {
    if (!lead?.email || !user) return;
    try {
      setIsFetchingZoho(true);
      const { emails: fetched } = await fetchLeadEmailsForAdminOrUser(lead.email, user, lead, users);
      setZohoEmails(fetched);
    } catch (err) {
      console.error('Failed to refresh Zoho emails:', err);
    } finally {
      setIsFetchingZoho(false);
    }
  };

  const fetchData = async () => {
    if (id) {
      try {
        setIsLoading(true);
        // Fetch lead, logs, and requests in parallel
        const [leadData, logsData, requestsData, usersData] = await Promise.all([
          api.leads.getById(id),
          api.logs.getByEntity(id),
          api.adminRequests.getAll(),
          api.users.getAll()
        ]);
        setUsers(usersData);

        if (leadData) setLead(leadData);
        setLogs(logsData || []);
        
        // Filter requests related to this lead (by relatedDealId)
        setRequests((requestsData || []).filter(r => r.relatedDealId === id));

        if (leadData?.email && user) {
          setIsFetchingZoho(true);

          fetchLeadEmailsForAdminOrUser(leadData.email, user, leadData, usersData).then(({ emails: fetched }) => {
            setZohoEmails(fetched);
            setIsZohoLinked(Boolean(fetched.length > 0 || usersData.some(u => Boolean(u.zohoRefreshToken)) || (logsData && logsData.some(l => l.action === 'EMAIL' || l.details?.includes('Zoho')))));

            // Requirement 4: Auto-shift lead status to Contacted if email activity exists & status is New
            if (leadData.status === 'New' && fetched.length > 0 && id && user) {
              api.leads.update(id, { status: 'Contacted' }).catch(() => {});
              api.logs.create({
                entityId: id,
                entityType: 'Lead',
                action: 'STATUS_CHANGE',
                userId: user.id,
                details: 'Lead status automatically shifted to Contacted due to Zoho Email communication.'
              }).catch(() => {});
              setLead(prev => prev ? { ...prev, status: 'Contacted' } : null);
            }
          }).finally(() => {
            setIsFetchingZoho(false);
          });
        } else {
          setIsZohoLinked(false);
        }
      } catch (err) {
        console.error('Failed to fetch data:', err);
      } finally {
        setIsLoading(false);
      }
    }
  };

  const todayStr = new Date().toISOString().split('T')[0];
  const maxFollowUpDateStr = (() => {
    const d = new Date();
    d.setDate(d.getDate() + 3);
    return d.toISOString().split('T')[0];
  })();

  const handleSetFollowUpDays = async (days: number) => {
    if (!id || !user || !lead) return;
    const target = new Date();
    target.setDate(target.getDate() + days);
    const dateStr = target.toISOString().split('T')[0];
    
    try {
      await api.leads.update(id, { nextFollowUp: dateStr });
      await api.logs.create({
        entityId: id,
        entityType: 'Lead',
        action: 'STATUS_CHANGE',
        userId: user.id,
        details: `Updated Next Follow-Up date to ${dateStr}`
      });
      setLead(prev => prev ? { ...prev, nextFollowUp: dateStr } : null);
    } catch (err) {
      console.error('Failed to update follow up date:', err);
    }
  };

  const handleCustomFollowUpDate = async (selectedDateStr: string) => {
    if (!id || !user || !lead) return;
    if (!selectedDateStr) return;
    let finalDateStr = selectedDateStr;
    if (selectedDateStr > maxFollowUpDateStr) {
      alert(`Follow-up date cannot be more than 3 days into the future. Auto-adjusting to max allowed (${maxFollowUpDateStr}).`);
      finalDateStr = maxFollowUpDateStr;
    }
    
    try {
      await api.leads.update(id, { nextFollowUp: finalDateStr });
      await api.logs.create({
        entityId: id,
        entityType: 'Lead',
        action: 'STATUS_CHANGE',
        userId: user.id,
        details: `Updated Next Follow-Up date to ${finalDateStr}`
      });
      setLead(prev => prev ? { ...prev, nextFollowUp: finalDateStr } : null);
    } catch (err) {
      console.error('Failed to update follow up date:', err);
    }
  };

  useEffect(() => {
    fetchData();
  }, [id]);

  const handleLogActivity = async (forceLogType?: 'zoho') => {
    if (!newLog.trim() || !id || !user) return;
    setIsSendingEmail(true);
    try {
      if (forceLogType === 'zoho') {
        if (!emailSubject.trim()) {
          alert('Please enter an email subject.');
          setIsSendingEmail(false);
          return;
        }
        const sendAsUserId = lead?.setterId || lead?.closerId || lead?.ownerRepId || user.id;
        // Send Zoho API mail
        await api.zoho.sendEmail(sendAsUserId, lead?.email || '', emailSubject, newLog);
        
        // Log it as standard CRM activity
        await api.logs.create({
          entityId: id,
          entityType: 'Lead',
          action: 'EMAIL',
          userId: user.id,
          details: `Sent email via Zoho: [Subject: ${emailSubject}] ${newLog}`
        });

        setEmailSubject('');
      } else {
        await api.logs.create({
          entityId: id,
          entityType: 'Lead',
          action: logType.toUpperCase(),
          userId: user.id,
          details: newLog
        });
      }
      setNewLog('');
      fetchData();
    } catch (err: any) {
      console.error(err);
      alert('Failed to submit: ' + (err.message || 'Check your connection'));
    } finally {
      setIsSendingEmail(false);
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

  const getUsername = (id: string) => users.find(u => u.id === id || u.username === id)?.username || id;

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
                  <Phone className="w-3.5 h-3.5" /> 
                  {lead.phone === '#ERROR!' ? (
                    <span className="text-red-500 font-bold text-xs bg-red-50 px-2 py-0.5 rounded border border-red-100 flex items-center gap-1">
                      #ERROR! (Prepend single quote ' to number in sheet)
                    </span>
                  ) : (
                    lead.phone
                  )}
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

              <div className="pt-4 mt-4 border-t border-[#DFDFDF] space-y-3">
                <div>
                  <p className="text-[9px] font-bold text-[#161616]/30 uppercase tracking-widest mb-1">Assigned Setter</p>
                  <div className="flex items-center gap-2 text-sm text-[#161616]/70 font-semibold uppercase tracking-tight">
                    <UserIcon className="w-3.5 h-3.5 text-[#161616]/20" /> {getUsername(lead.setterId || lead.ownerRepId)}
                  </div>
                </div>
                <div>
                  <p className="text-[9px] font-bold text-[#161616]/30 uppercase tracking-widest mb-1">Assigned Closer</p>
                  <div className="flex items-center gap-2 text-sm text-[#161616]/70 font-semibold uppercase tracking-tight">
                    <UserIcon className="w-3.5 h-3.5 text-[#161616]/20" /> {lead.closerId ? getUsername(lead.closerId) : 'Not Assigned'}
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* Next Follow-Up Schedule Card (Max 3 Days Rule) */}
          <div className="bg-white border border-[#DFDFDF] rounded-[6px] p-5 shadow-sm space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="text-[10px] font-black text-[#161616] uppercase tracking-widest flex items-center gap-2">
                <Calendar className="w-3.5 h-3.5 text-[#161616]/40" /> Next Follow-Up
              </h3>
              {lead.nextFollowUp ? (
                (() => {
                  const dateVal = lead.nextFollowUp.split('T')[0];
                  return (
                    <span className={`px-2 py-0.5 rounded text-[9px] font-black uppercase tracking-wider ${
                      dateVal < todayStr 
                        ? 'bg-red-100 text-red-700 border border-red-200 animate-pulse' 
                        : dateVal === todayStr 
                        ? 'bg-amber-100 text-amber-700 border border-amber-200' 
                        : 'bg-green-100 text-green-700 border border-green-200'
                    }`}>
                      {dateVal < todayStr ? 'OVERDUE' : dateVal === todayStr ? 'DUE TODAY' : 'SCHEDULED'}
                    </span>
                  );
                })()
              ) : (

                <span className="px-2 py-0.5 rounded text-[9px] font-bold uppercase tracking-wider bg-gray-100 text-gray-500">
                  UNSET
                </span>
              )}
            </div>

            <div className="p-3 bg-[#F9F9F9] border border-[#DFDFDF] rounded-[6px] flex items-center justify-between">
              <span className="text-xs font-bold text-[#161616]">
                {lead.nextFollowUp ? lead.nextFollowUp.split('T')[0] : 'No follow-up date set'}
              </span>
              <input 
                type="date"
                min={todayStr}
                max={maxFollowUpDateStr}
                value={lead.nextFollowUp ? lead.nextFollowUp.split('T')[0] : ''}
                onChange={e => handleCustomFollowUpDate(e.target.value)}
                className="text-xs border border-[#DFDFDF] rounded px-2 py-1 bg-white font-medium focus:outline-none cursor-pointer"
              />
            </div>


            {/* Quick Presets (+1d, +2d, +3d max) */}
            <div>
              <p className="text-[9px] font-bold text-[#161616]/30 uppercase tracking-widest mb-2">Quick Presets (Max 3 Days)</p>
              <div className="grid grid-cols-3 gap-2">
                <button
                  onClick={() => handleSetFollowUpDays(1)}
                  className="py-1.5 px-2 bg-white border border-[#DFDFDF] hover:border-[#161616] text-[#161616] rounded text-[10px] font-black uppercase transition-all cursor-pointer text-center"
                >
                  +1 Day
                </button>
                <button
                  onClick={() => handleSetFollowUpDays(2)}
                  className="py-1.5 px-2 bg-white border border-[#DFDFDF] hover:border-[#161616] text-[#161616] rounded text-[10px] font-black uppercase transition-all cursor-pointer text-center"
                >
                  +2 Days
                </button>
                <button
                  onClick={() => handleSetFollowUpDays(3)}
                  className="py-1.5 px-2 bg-white border border-[#DFDFDF] hover:border-[#161616] text-[#161616] rounded text-[10px] font-black uppercase transition-all cursor-pointer text-center"
                >
                  +3 Days
                </button>
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

          {/* Management Controls */}
          {(role === 'ADMIN' || role === 'SUPER_ADMIN') && (
            <div className="bg-white border border-[#DFDFDF] rounded-[6px] p-5 shadow-sm">
              <h3 className="text-[10px] font-black text-[#161616]/30 uppercase tracking-widest mb-4">Management Controls</h3>
              <div className="space-y-4">
                <div>
                  <label className="text-[9px] font-bold text-[#161616]/30 uppercase tracking-widest block mb-1.5">Re-assign Setter</label>
                  <select 
                    value={lead.setterId || lead.ownerRepId || ''}
                    onChange={async (e) => {
                      await api.leads.update(lead.id, { setterId: e.target.value });
                      fetchData();
                    }}
                    className="w-full bg-[#F9F9F9] border border-[#DFDFDF] rounded-[4px] px-3 py-2 text-xs font-bold uppercase tracking-tight focus:outline-none focus:border-[#161616]/30 transition-all"
                  >
                    <option value="">No Setter</option>
                    {users.filter(u => u.status === 'Active' && (u.role === 'SETTER' || u.role === 'SALES_REP' || u.role === 'ADMIN' || u.role === 'SUPER_ADMIN')).map(u => (
                      <option key={u.id} value={u.id}>{u.username}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="text-[9px] font-bold text-[#161616]/30 uppercase tracking-widest block mb-1.5">Assign Closer</label>
                  <select 
                    value={lead.closerId || ''}
                    onChange={async (e) => {
                      await api.leads.update(lead.id, { closerId: e.target.value });
                      fetchData();
                    }}
                    className="w-full bg-[#F9F9F9] border border-[#DFDFDF] rounded-[4px] px-3 py-2 text-xs font-bold uppercase tracking-tight focus:outline-none focus:border-[#161616]/30 transition-all"
                  >
                    <option value="">No Closer Assigned</option>
                    {users.filter(u => u.status === 'Active' && (u.role === 'SALES_REP' || u.role === 'ADMIN' || u.role === 'SUPER_ADMIN')).map(u => (
                      <option key={u.id} value={u.id}>{u.username}</option>
                    ))}
                  </select>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Right Col */}
        <div className="lg:col-span-2 flex flex-col gap-4">
          {/* Interaction Timeline */}
          {/* Interaction Timeline */}
          <div className="bg-white border border-[#DFDFDF] rounded-[6px] p-6 shadow-sm min-h-[400px]">
            {/* Tabs Header */}
            <div className="flex border-b border-[#DFDFDF] mb-6">
              <button
                type="button"
                onClick={() => setActiveRightTab('activity')}
                className={`px-5 py-3 text-[10px] font-black uppercase tracking-widest border-b-2 transition-all cursor-pointer ${
                  activeRightTab === 'activity' 
                    ? 'border-[#161616] text-[#161616]' 
                    : 'border-transparent text-[#161616]/40 hover:text-[#161616]/80'
                }`}
              >
                Activity Log
              </button>
              <button
                type="button"
                onClick={() => setActiveRightTab('zoho')}
                className={`px-5 py-3 text-[10px] font-black uppercase tracking-widest border-b-2 transition-all flex items-center gap-2 cursor-pointer ${
                  activeRightTab === 'zoho' 
                    ? 'border-blue-500 text-blue-600' 
                    : 'border-transparent text-[#161616]/40 hover:text-[#161616]/80'
                }`}
              >
                <Mail className="w-3.5 h-3.5" /> Zoho Emails
              </button>
            </div>

            {activeRightTab === 'activity' ? (
              <div className="flex flex-col gap-8 relative ml-2">
                <div className="absolute left-[7px] top-2 bottom-2 w-px bg-[#DFDFDF]"></div>
                {logs.length === 0 ? (
                  <div className="text-[11px] text-[#161616]/30 italic ml-6">No operational logs recorded.</div>
                ) : (
                  logs.slice().reverse().map((item) => (
                    <div key={item.id} className="flex gap-6 relative group">
                      <div className={`w-3.5 h-3.5 rounded-full shrink-0 mt-1 z-10 border-2 transition-all group-hover:scale-125 ${
                        item.action.includes('SYSTEM') || item.action.includes('STATUS_CHANGE') 
                          ? 'border-[#DFDFDF] bg-white' 
                          : 'border-[#161616] bg-[#161616]'
                      }`}></div>
                      <div className="flex-1">
                        <div className="flex justify-between items-baseline mb-2">
                          <div className="flex items-center gap-2">
                            <span className="text-xs font-black uppercase tracking-wider text-[#161616]">{item.action}</span>
                            <span className="text-[10px] font-bold text-[#161616]/40 uppercase">
                              by {item.userId === user?.id ? 'You' : getUsername(item.userId)}
                            </span>
                          </div>
                          <span className="text-[10px] font-mono text-[#161616]/30">{new Date(item.timestamp).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })}</span>
                        </div>
                        <div className={`bg-[#F9F9F9] border border-[#DFDFDF] rounded-[8px] p-4 text-sm text-[#161616]/70 leading-relaxed whitespace-pre-wrap ${item.action === 'GUIDANCE' ? 'border-l-4 border-l-[#161616]' : ''}`}>
                          {item.details}
                        </div>
                      </div>
                    </div>
                  ))
                )}
              </div>
            ) : (
              // Zoho Emails Tab Content
              <div className="flex flex-col gap-6">
                {!isZohoLinked ? (
                  <div className="flex flex-col items-center justify-center py-20 text-center gap-4 bg-[#F9F9F9] border border-dashed border-[#DFDFDF] rounded-[8px] px-6">
                    <Mail className="w-10 h-10 text-[#161616]/20" />
                    <div>
                      <h4 className="text-xs font-bold text-[#161616] uppercase tracking-widest mb-1.5">Zoho Mail Not Linked</h4>
                      <p className="text-[11px] text-[#161616]/40 max-w-[280px] leading-relaxed mx-auto">Link your Zoho Business Mail account under settings on the Dashboard to sync email conversations.</p>
                    </div>
                  </div>
                ) : (
                  <ZohoEmailViewer
                    emails={zohoEmails}
                    leadEmail={lead.email}
                    leadName={lead.name}
                    crmLogs={logs}
                    onRefresh={refreshZohoEmails}
                    isRefreshing={isFetchingZoho}
                  />
                )}
              </div>
            )}
          </div>

          {/* Log Action Box */}
          {lead.status !== 'Converted' && (
            <>
              {activeRightTab === 'activity' ? (
                // CRM Logs Composer
                <div className="bg-[#161616] rounded-[6px] p-6 shadow-xl">
                  <h3 className="text-[10px] font-black text-white/30 uppercase tracking-widest mb-5">Log New Interaction</h3>
                  <div className="flex gap-3 mb-5">
                    {([
                      { key: 'call', icon: Phone, label: 'Call' }, 
                      { key: 'message', icon: MessageSquare, label: 'WhatsApp' }, 
                      { key: 'email', icon: Mail, label: 'Email Note' }
                    ] as const).map(({ key, icon: Icon, label }) => (
                      <button 
                        key={key} 
                        type="button"
                        onClick={() => setLogType(key)} 
                        className={`flex items-center gap-2 px-4 py-2 rounded-[6px] text-[11px] font-black transition-all uppercase tracking-widest cursor-pointer ${logType === key ? 'bg-white text-[#161616]' : 'border border-white/10 text-white/40 hover:border-white/30 hover:text-white'}`}
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
                      onClick={() => handleLogActivity()} 
                      disabled={!newLog.trim()} 
                      className="flex items-center gap-2 bg-white text-[#161616] px-6 py-3 rounded-[6px] text-[11px] font-black hover:opacity-90 transition-all disabled:opacity-20 uppercase tracking-widest cursor-pointer"
                    >
                      <Send className="w-4 h-4" /> COMMIT LOG
                    </button>
                  </div>
                </div>
              ) : (
                // Zoho Email Composer Tab
                isZohoLinked && (
                  <div className="bg-[#161616] rounded-[6px] p-6 shadow-xl">
                    <h3 className="text-[10px] font-black text-white/30 uppercase tracking-widest mb-5">Compose & Send Zoho Email</h3>
                    <div className="mb-4">
                      <input
                        type="text"
                        placeholder="Email Subject..."
                        value={emailSubject}
                        onChange={e => setEmailSubject(e.target.value)}
                        className="w-full px-5 py-3 bg-white/5 border border-white/10 rounded-[8px] text-sm focus:outline-none focus:border-white/30 text-white placeholder:text-white/20 font-bold"
                      />
                    </div>
                    <textarea 
                      value={newLog} 
                      onChange={(e) => setNewLog(e.target.value)} 
                      placeholder="Write your email body..." 
                      className="w-full min-h-[160px] px-5 py-4 bg-white/5 border border-white/10 rounded-[8px] text-sm focus:outline-none focus:border-white/30 resize-none text-white placeholder:text-white/10 mb-4" 
                    />
                    <div className="flex justify-end">
                      <button 
                        onClick={async () => {
                          await handleLogActivity('zoho');
                        }}
                        disabled={!newLog.trim() || isSendingEmail} 
                        className="flex items-center gap-2 bg-white text-[#161616] px-6 py-3 rounded-[6px] text-[11px] font-black hover:opacity-90 transition-all disabled:opacity-20 uppercase tracking-widest cursor-pointer"
                      >
                        <Send className="w-4 h-4" /> 
                        {isSendingEmail ? 'SENDING...' : 'SEND ZOHO EMAIL'}
                      </button>
                    </div>
                  </div>
                )
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
};
