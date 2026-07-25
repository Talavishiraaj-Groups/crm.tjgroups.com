import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { User, UserRole, Lead, Deal, AdminRequest } from '../types';
import { api } from '../api/services';
import { useAuth } from '../context/AuthContext';
import { 
  UserPlus, Search, MoreVertical, CheckCircle, XCircle, X, 
  LayoutGrid, Users as UsersIcon, Briefcase, ShieldAlert, 
  Trash2, Bell, ExternalLink, FileText, DollarSign, Clock,
  ClipboardCheck, MessageSquare, History, ShieldOff
} from 'lucide-react';
import { ROLE_BADGE, ROLE_LABEL, AVAIL_DOT } from '../utils/badges';
import { Log } from '../types';
import { DailyLogsTab } from '../components/DailyLogsTab';

export const AdminPage: React.FC = () => {
  const { role: currentUserRole, user } = useAuth();
  const navigate = useNavigate();
  const [allUsers, setAllUsers] = useState<User[]>([]); 
  const [displayUsers, setDisplayUsers] = useState<User[]>([]); 
  const [leads, setLeads] = useState<Lead[]>([]);
  const [deals, setDeals] = useState<Deal[]>([]);
  const [requests, setRequests] = useState<AdminRequest[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [tab, setTab] = useState<'users' | 'assignments' | 'requests' | 'summaries'>('users');
  const [logs, setLogs] = useState<Log[]>([]);
  const [dailyNote, setDailyNote] = useState('');
  const [isLoggingDaily, setIsLoggingDaily] = useState(false);
  const [hasLoggedToday, setHasLoggedToday] = useState(false);
  
  // Modal state
  const [showInviteModal, setShowInviteModal] = useState(false);
  const [editingUser, setEditingUser] = useState<User | null>(null);
  const [editingRequest, setEditingRequest] = useState<AdminRequest | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [newUser, setNewUser] = useState({ username: '', password: '', role: 'SALES_REP' as UserRole, team: '' });
  const [requestUpdate, setRequestUpdate] = useState({ status: '', link: '' });

  const fetchData = () => {
    setIsLoading(true);
    Promise.all([
      api.users.getAll(),
      api.leads.getAll('SUPER_ADMIN', ''),
      api.deals.getAll('SUPER_ADMIN', ''),
      api.adminRequests.getAll()
    ]).then(([usersData, leadsData, dealsData, requestsData]) => {
      setAllUsers(usersData);
      
      const filteredUsers = currentUserRole === 'SUPER_ADMIN' 
        ? usersData 
        : usersData.filter(u => u.role !== 'SUPER_ADMIN');
      setDisplayUsers(filteredUsers); 
      setLeads(leadsData);
      setDeals(dealsData);
      setRequests(requestsData);
      
      api.logs.getByEntity('GLOBAL').then(logsData => {
        setLogs(logsData);
        const today = new Date().toDateString();
        // Use the actual logged-in user's id — not hardcoded role strings
        if (user) {
          const loggedToday = logsData.some(l =>
            (l.userId === user.id || l.userId === user.username) &&
            l.action === 'DAILY_LOG' &&
            new Date(l.timestamp).toDateString() === today
          );
          setHasLoggedToday(loggedToday);
        }
      });
      
      setIsLoading(false);
    }).catch(err => {
      console.error(err);
      setIsLoading(false);
    });
  };

  useEffect(() => {
    fetchData();
  }, [currentUserRole]);

  const handleInvite = async (e: React.FormEvent) => {
    e.preventDefault();
    if (currentUserRole === 'ADMIN' && newUser.role === 'SUPER_ADMIN') {
      alert("Security Error: You do not have permission to create a Super Admin account.");
      return;
    }

    setIsSubmitting(true);
    try {
      await api.users.create({
        username: newUser.username,
        password: newUser.password,
        role: newUser.role,
        team: newUser.team || undefined,
        status: 'Active',
        availability: 'Available'
      });
      setShowInviteModal(false);
      setNewUser({ username: '', password: '', role: 'SALES_REP', team: '' });
      fetchData();
    } catch (err) {
      console.error(err);
      alert("Failed to create user.");
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleEditUser = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingUser) return;
    if (currentUserRole === 'ADMIN' && editingUser.role === 'SUPER_ADMIN') {
      alert("Security Error: Admins cannot promote to Super Admin.");
      return;
    }

    setIsSubmitting(true);
    try {
      await api.users.update(editingUser.id, {
        username: editingUser.username,
        role: editingUser.role,
        team: editingUser.team || undefined,
        password: editingUser.password
      });
      setEditingUser(null);
      fetchData();
    } catch (err) {
      console.error(err);
      alert("Failed to update user.");
    } finally {
      setIsSubmitting(false);
    }
  };

  const toggleStatus = async (targetUser: User) => {
    if (currentUserRole === 'ADMIN' && targetUser.role === 'SUPER_ADMIN') return;
    const newStatus = targetUser.status === 'Active' ? 'Inactive' : 'Active';
    // Optimistic update
    setAllUsers(prev => prev.map(u => u.id === targetUser.id ? { ...u, status: newStatus } : u));
    try {
      await api.users.update(targetUser.id, { status: newStatus });
    } catch (err) {
      console.error(err);
      // Revert on failure
      setAllUsers(prev => prev.map(u => u.id === targetUser.id ? { ...u, status: targetUser.status } : u));
    }
  };

  const handleRevokeAccess = async (targetUser: User) => {
    if (targetUser.role === 'SUPER_ADMIN') {
      alert('Security Error: Super Admin access cannot be revoked.');
      return;
    }
    const isActive = targetUser.status === 'Active';
    const action = isActive ? 'REVOKE' : 'RESTORE';
    const msg = isActive
      ? `Revoke access for ${targetUser.username}? They will be blocked from logging in. Data is preserved.`
      : `Restore access for ${targetUser.username}? They will be able to log in again.`;
    if (!window.confirm(msg)) return;
    const newStatus = isActive ? 'Inactive' : 'Active';
    // Optimistic update
    setAllUsers(prev => prev.map(u => u.id === targetUser.id ? { ...u, status: newStatus } : u));
    try {
      await api.users.update(targetUser.id, { status: newStatus });
    } catch (err) {
      console.error(err);
      // Revert on failure
      setAllUsers(prev => prev.map(u => u.id === targetUser.id ? { ...u, status: targetUser.status } : u));
      alert(`Failed to ${action.toLowerCase()} access.`);
    }
  };

  const handleUpdateRequest = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingRequest) return;
    setIsSubmitting(true);
    try {
      await api.adminRequests.update(editingRequest.id, {
        status: requestUpdate.status as any,
        paymentLink: editingRequest.type === 'payment' ? requestUpdate.link : undefined,
        documentUrl: editingRequest.type === 'paperwork' ? requestUpdate.link : undefined
      });
      setEditingRequest(null);
      fetchData();
    } catch (err) {
      console.error(err);
      alert("Failed to update request.");
    } finally {
      setIsSubmitting(false);
    }
  };

  const getUsername = (id: string) => {
    const u = allUsers.find(user => user.id === id);
    if (!u) return 'Unknown';
    if (currentUserRole !== 'SUPER_ADMIN' && u.role === 'SUPER_ADMIN') return 'System Admin';
    return u.username;
  };

  const availableRoles = currentUserRole === 'SUPER_ADMIN' 
    ? ['SALES_REP', 'ADMIN', 'SETTER', 'SUPER_ADMIN'] as UserRole[]
    : ['SALES_REP', 'ADMIN', 'SETTER'] as UserRole[];

  return (
    <div className="flex flex-col gap-6 relative">
      <div className="flex justify-between items-center">
        <div>
          <h2 className="text-xl font-bold text-[#161616] tracking-tight">Administrative Controls</h2>
          <p className="text-sm text-[#161616]/40 font-medium mt-0.5">
            {currentUserRole === 'ADMIN' ? 'Manage team access and requests.' : 'Global system-wide management and configurations.'}
          </p>
        </div>
        <div className="flex gap-2">
          <div className="flex bg-[#F9F9F9] border border-[#DFDFDF] p-0.5 rounded-[6px]">
            <button 
              onClick={() => setTab('users')}
              className={`flex items-center gap-2 px-3 py-1.5 rounded-[4px] text-[10px] font-bold uppercase tracking-wider transition-all ${tab === 'users' ? 'bg-white shadow-sm text-[#161616]' : 'text-[#161616]/40 hover:text-[#161616]/60'}`}
            >
              <UsersIcon className="w-3.5 h-3.5" /> USERS
            </button>
            <button 
              onClick={() => setTab('requests')}
              className={`flex items-center gap-2 px-3 py-1.5 rounded-[4px] text-[10px] font-bold uppercase tracking-wider transition-all ${tab === 'requests' ? 'bg-white shadow-sm text-[#161616]' : 'text-[#161616]/40 hover:text-[#161616]/60'}`}
            >
              <Bell className="w-3.5 h-3.5" /> REQUESTS {requests.filter(r => r.status === 'Pending').length > 0 && <span className="w-1.5 h-1.5 rounded-full bg-red-500"></span>}
            </button>
            <button 
              onClick={() => setTab('assignments')}
              className={`flex items-center gap-2 px-3 py-1.5 rounded-[4px] text-[10px] font-bold uppercase tracking-wider transition-all ${tab === 'assignments' ? 'bg-white shadow-sm text-[#161616]' : 'text-[#161616]/40 hover:text-[#161616]/60'}`}
            >
              <LayoutGrid className="w-3.5 h-3.5" /> ASSIGNMENTS
            </button>
            <button 
              onClick={() => setTab('summaries')}
              className={`flex items-center gap-2 px-3 py-1.5 rounded-[4px] text-[10px] font-bold uppercase tracking-wider transition-all ${tab === 'summaries' ? 'bg-white shadow-sm text-[#161616]' : 'text-[#161616]/40 hover:text-[#161616]/60'}`}
            >
              <ClipboardCheck className="w-3.5 h-3.5" /> DAILY LOGS
            </button>
          </div>
          {tab === 'users' && (
            <button 
              onClick={() => setShowInviteModal(true)}
              className="flex items-center gap-2 bg-[#161616] text-white px-4 py-2 rounded-[6px] text-xs font-bold hover:opacity-90 transition-all shadow-sm"
            >
              <UserPlus className="w-4 h-4" /> INVITE USER
            </button>
          )}
        </div>
      </div>

      {isLoading ? (
        <div className="bg-white border border-[#DFDFDF] rounded-[6px] p-12 text-center text-[#161616]/30 italic text-sm">Loading control panel...</div>
      ) : tab === 'users' ? (
        <>
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
            {(['SUPER_ADMIN', 'ADMIN', 'SALES_REP', 'SETTER'] as const).map((r) => {
              if (currentUserRole === 'ADMIN' && r === 'SUPER_ADMIN') return null;
              return (
                <div key={r} className={`rounded-[6px] p-5 border ${r === 'SUPER_ADMIN' ? 'bg-[#161616] border-[#161616]' : 'bg-white border-[#DFDFDF]'}`}>
                  <div className={`text-[10px] font-bold uppercase tracking-widest mb-2 ${r === 'SUPER_ADMIN' ? 'text-white/30' : 'text-[#161616]/30'}`}>
                    {ROLE_LABEL[r]}
                  </div>
                  <div className={`text-2xl font-bold tabular-nums ${r === 'SUPER_ADMIN' ? 'text-white' : 'text-[#161616]'}`}>
                    {allUsers.filter((u) => u.role === r).length}
                  </div>
                </div>
              );
            })}
          </div>

          <div className="bg-white border border-[#DFDFDF] rounded-[6px] overflow-hidden">
            <table className="w-full border-collapse">
              <thead>
                <tr className="border-b border-[#DFDFDF]">
                  {['User', 'Role', 'Status', 'Actions'].map((h) => (
                    <th key={h} className="text-left px-5 py-3 text-[10px] font-bold text-[#161616]/30 uppercase tracking-widest">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {displayUsers.map((u) => (
                  <tr key={u.id} className="border-b border-[#DFDFDF] last:border-0 hover:bg-[#F9F9F9] transition-colors">
                    <td className="px-5 py-3.5">
                      <div className="flex items-center gap-3">
                        <div className="w-8 h-8 rounded-full bg-[#DFDFDF] flex items-center justify-center text-xs font-bold text-[#161616]">
                          {u.username[0].toUpperCase()}
                        </div>
                        <p className="text-sm font-semibold text-[#161616]">{u.username}</p>
                      </div>
                    </td>
                    <td className="px-5 py-3.5">
                      <span className={`px-2 py-0.5 rounded-[3px] text-[10px] font-bold uppercase tracking-wider ${ROLE_BADGE[u.role]}`}>
                        {ROLE_LABEL[u.role]}
                      </span>
                    </td>
                    <td className="px-5 py-3.5">
                      {u.status === 'Active' ? (
                        <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-green-50 border border-green-200 text-[10px] font-black text-green-700 uppercase tracking-wider">
                          <span className="w-1.5 h-1.5 rounded-full bg-green-500 animate-pulse"></span>
                          Active
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-red-50 border border-red-200 text-[10px] font-black text-red-600 uppercase tracking-wider">
                          <span className="w-1.5 h-1.5 rounded-full bg-red-500"></span>
                          Revoked
                        </span>
                      )}
                    </td>
                    <td className="px-5 py-3.5 text-right">
                      <div className="flex items-center gap-2 justify-end">
                        {u.role !== 'SUPER_ADMIN' ? (
                          u.status === 'Active' ? (
                            <button
                              onClick={() => handleRevokeAccess(u)}
                              className="flex items-center gap-1.5 px-3 py-1.5 rounded-[5px] text-[10px] font-black uppercase tracking-wider bg-red-50 border border-red-200 text-red-600 hover:bg-red-100 hover:border-red-400 transition-all"
                            >
                              <ShieldOff className="w-3.5 h-3.5" />
                              Revoke Access
                            </button>
                          ) : (
                            <button
                              onClick={() => handleRevokeAccess(u)}
                              className="flex items-center gap-1.5 px-3 py-1.5 rounded-[5px] text-[10px] font-black uppercase tracking-wider bg-green-50 border border-green-200 text-green-700 hover:bg-green-100 hover:border-green-400 transition-all"
                            >
                              <CheckCircle className="w-3.5 h-3.5" />
                              Restore Access
                            </button>
                          )
                        ) : (
                          <span className="text-[9px] font-black text-[#161616]/20 uppercase tracking-widest italic px-3 py-1.5">Protected</span>
                        )}
                        <button onClick={() => setEditingUser(u)} className="p-1 hover:bg-[#F9F9F9] rounded-[4px]">
                          <MoreVertical className="w-4 h-4 text-[#161616]/20" />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      ) : tab === 'requests' ? (
        <div className="bg-white border border-[#DFDFDF] rounded-[6px] overflow-hidden">
          <table className="w-full border-collapse">
            <thead>
              <tr className="border-b border-[#DFDFDF]">
                {['Type', 'From Lead/Deal', 'Requested By', 'Status', 'Date', ''].map((h) => (
                  <th key={h} className="text-left px-5 py-3 text-[10px] font-bold text-[#161616]/30 uppercase tracking-widest">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {requests.length === 0 ? (
                <tr><td colSpan={6} className="px-5 py-16 text-center text-[#161616]/30 italic text-sm">No active requests.</td></tr>
              ) : (
                requests.map((r) => {
                  return (
                    <tr key={r.id} className="border-b border-[#DFDFDF] last:border-0 hover:bg-[#F9F9F9] transition-colors">
                      <td className="px-5 py-3.5">
                        <span className="text-[10px] font-black text-[#161616] uppercase tracking-widest bg-[#F9F9F9] px-2 py-1 rounded-[3px] border border-[#DFDFDF]">
                          {r.type}
                        </span>
                      </td>
                      <td className="px-5 py-3.5 text-sm font-medium text-[#161616]">
                        {(() => {
                          const deal = deals.find(d => d.id === r.relatedDealId);
                          const leadId = deal ? deal.leadId : r.relatedDealId;
                          const lead = leads.find(l => l.id === leadId);
                          return lead?.name || r.relatedDealId;
                        })()}
                      </td>
                      <td className="px-5 py-3.5 text-sm text-[#161616]/60 font-semibold">{getUsername(r.requestedBy)}</td>
                      <td className="px-5 py-3.5">
                        <span className={`px-2 py-0.5 rounded-[3px] text-[10px] font-bold uppercase tracking-wider ${r.status === 'Pending' ? 'bg-orange-100 text-orange-700' : 'bg-green-100 text-green-700'}`}>
                          {r.status}
                        </span>
                      </td>
                      <td className="px-5 py-3.5 text-[11px] text-[#161616]/40">{new Date(r.createdAt).toLocaleDateString()}</td>
                      <td className="px-5 py-3.5 text-right">
                        <button 
                          onClick={() => {
                            setEditingRequest(r);
                            setRequestUpdate({ status: r.status, link: (r as any).paymentLink || (r as any).documentUrl || '' });
                          }}
                          className="text-[10px] font-bold text-[#161616]/50 border border-[#DFDFDF] px-3 py-1 rounded-[4px] hover:text-[#161616] hover:border-[#161616]/30 transition-all"
                        >
                          FULFILL
                        </button>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      ) : tab === 'summaries' ? (
        <DailyLogsTab
          logs={logs}
          allUsers={allUsers}
          currentUser={user}
          currentUserRole={currentUserRole}
          hasLoggedToday={hasLoggedToday}
          dailyNote={dailyNote}
          setDailyNote={setDailyNote}
          isLoggingDaily={isLoggingDaily}
          onSubmitLog={async () => {
            if (!dailyNote.trim() || !user) return;
            setIsLoggingDaily(true);
            try {
              await api.logs.create({
                entityId: 'USER_' + user.id,
                entityType: 'User',
                action: 'DAILY_LOG',
                userId: user.id,
                details: `DAILY SUMMARY: ${dailyNote.trim()}`
              });
              setDailyNote('');
              setHasLoggedToday(true);
              fetchData();
            } catch {
              alert('Failed to submit daily log. Please try again.');
            } finally {
              setIsLoggingDaily(false);
            }
          }}
        />
      ) : (
        <div className="flex flex-col gap-6">
          <div className="bg-white border border-[#DFDFDF] rounded-[6px] overflow-hidden">
            <div className="px-5 py-4 border-b border-[#DFDFDF] flex justify-between items-center bg-[#F9F9F9]">
              <h3 className="text-[10px] font-bold text-[#161616]/30 uppercase tracking-widest flex items-center gap-2"><LayoutGrid className="w-3.5 h-3.5" /> Lead & Setter Assignments</h3>
              <p className="text-[9px] font-bold text-[#161616]/20 uppercase">Transition leads between Setters and Closers</p>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full border-collapse">
                <thead>
                  <tr className="border-b border-[#DFDFDF] bg-[#F9F9F9]">
                    {['Lead Name', 'Original Setter', 'Assigned Closer', 'Actions'].map(h => (
                      <th key={h} className="text-left px-5 py-3 text-[9px] font-black text-[#161616]/40 uppercase tracking-widest">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {leads.filter(l => l.status !== 'Converted').map(l => (
                    <tr key={l.id} className="border-b border-[#DFDFDF] last:border-0 hover:bg-[#F9F9F9] transition-all">
                      <td className="px-5 py-4 text-sm font-bold text-[#161616]">{l.name}</td>
                      <td className="px-5 py-4">
                        <select 
                          value={l.setterId || l.ownerRepId} 
                          onChange={async (e) => {
                            await api.leads.update(l.id, { setterId: e.target.value });
                            fetchData();
                          }}
                          className="text-xs bg-transparent border-0 font-semibold focus:ring-0 cursor-pointer"
                        >
                          {allUsers.filter(u => u.status === 'Active' && (u.role === 'SETTER' || u.role === 'SALES_REP')).map(u => (
                            <option key={u.id} value={u.id}>{u.username}</option>
                          ))}
                        </select>
                      </td>
                      <td className="px-5 py-4">
                        <select 
                          value={l.closerId || ''} 
                          onChange={async (e) => {
                            await api.leads.update(l.id, { closerId: e.target.value });
                            fetchData();
                          }}
                          className="text-xs bg-transparent border-0 font-semibold focus:ring-0 cursor-pointer"
                        >
                          <option value="">No Closer Assigned</option>
                          {allUsers.filter(u => u.status === 'Active' && u.role === 'SALES_REP').map(u => (
                            <option key={u.id} value={u.id}>{u.username}</option>
                          ))}
                        </select>
                      </td>
                      <td className="px-5 py-4 text-right">
                        <button onClick={() => navigate(`/leads/${l.id}`)} className="text-[9px] font-black text-[#161616]/40 hover:text-[#161616] uppercase tracking-widest transition-all">VIEW DETAIL</button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* Fulfillment Modal */}
      {editingRequest && (
        <div className="fixed inset-0 bg-[#161616]/20 backdrop-blur-sm flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-[6px] shadow-xl border border-[#DFDFDF] w-full max-w-[400px] overflow-hidden">
            <div className="flex justify-between items-center px-6 py-4 border-b border-[#DFDFDF]">
              <h3 className="text-[12px] font-black text-[#161616] uppercase tracking-widest">Fulfill {editingRequest.type}</h3>
              <button onClick={() => setEditingRequest(null)} className="text-[#161616]/30 hover:text-[#161616]"><X className="w-4 h-4" /></button>
            </div>
            <form onSubmit={handleUpdateRequest} className="p-6 flex flex-col gap-4">
              <div>
                <label className="text-[10px] font-bold text-[#161616]/40 uppercase tracking-widest block mb-1">Status</label>
                <select value={requestUpdate.status} onChange={e => setRequestUpdate({...requestUpdate, status: e.target.value})} className="w-full px-3 py-2 border border-[#DFDFDF] rounded-[4px] text-sm focus:outline-none focus:border-[#161616]/50 bg-white">
                  <option value="Pending">Pending</option>
                  <option value="Sent">Sent (Awaiting Client)</option>
                  <option value="Approved">Approved / Filled</option>
                  <option value="Paid">Paid (Financial only)</option>
                </select>
              </div>
              <div>
                <label className="text-[10px] font-bold text-[#161616]/40 uppercase tracking-widest block mb-1">{editingRequest.type === 'payment' ? 'Payment Link' : 'Document URL'}</label>
                <input 
                  type="url" required value={requestUpdate.link} onChange={e => setRequestUpdate({...requestUpdate, link: e.target.value})} 
                  placeholder="https://..."
                  className="w-full px-3 py-2 border border-[#DFDFDF] rounded-[4px] text-sm focus:outline-none focus:border-[#161616]/50" 
                />
              </div>
              <div className="flex justify-end gap-2 mt-4">
                <button type="button" onClick={() => setEditingRequest(null)} className="px-4 py-2 text-xs font-bold text-[#161616]/50 hover:text-[#161616]">CANCEL</button>
                <button type="submit" disabled={isSubmitting} className="bg-[#161616] text-white px-6 py-2 rounded-[4px] text-xs font-bold hover:opacity-90 disabled:opacity-50 uppercase tracking-widest">UPDATE REQUEST</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* User Edit Modal */}
      {editingUser && (
        <div className="fixed inset-0 bg-[#161616]/20 backdrop-blur-sm flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-[6px] shadow-xl border border-[#DFDFDF] w-full max-w-[400px] overflow-hidden">
            <div className="flex justify-between items-center px-6 py-4 border-b border-[#DFDFDF]">
              <h3 className="text-[12px] font-black text-[#161616] uppercase tracking-widest">Edit User: {editingUser.username}</h3>
              <button onClick={() => setEditingUser(null)} className="text-[#161616]/30 hover:text-[#161616]"><X className="w-4 h-4" /></button>
            </div>
            <form onSubmit={handleEditUser} className="p-6 flex flex-col gap-4">
              <div>
                <label className="text-[10px] font-bold text-[#161616]/40 uppercase tracking-widest block mb-1">Username</label>
                <input type="text" required value={editingUser.username} onChange={e => setEditingUser({...editingUser, username: e.target.value})} className="w-full px-3 py-2 border border-[#DFDFDF] rounded-[4px] text-sm focus:outline-none focus:border-[#161616]/50" />
              </div>
              <div>
                <label className="text-[10px] font-bold text-[#161616]/40 uppercase tracking-widest block mb-1">Role</label>
                <select value={editingUser.role} onChange={e => setEditingUser({...editingUser, role: e.target.value as UserRole})} className="w-full px-3 py-2 border border-[#DFDFDF] rounded-[4px] text-sm focus:outline-none focus:border-[#161616]/50 bg-white">
                  {availableRoles.map(r => (
                    <option key={r} value={r}>{ROLE_LABEL[r]}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="text-[10px] font-bold text-[#161616]/40 uppercase tracking-widest block mb-1">Team / Team Lead</label>
                <input type="text" value={editingUser.team || ''} onChange={e => setEditingUser({...editingUser, team: e.target.value})} className="w-full px-3 py-2 border border-[#DFDFDF] rounded-[4px] text-sm focus:outline-none focus:border-[#161616]/50" />
              </div>
              <div>
                <label className="text-[10px] font-bold text-[#161616]/40 uppercase tracking-widest block mb-1">Update Password</label>
                <input type="text" value={editingUser.password || ''} onChange={e => setEditingUser({...editingUser, password: e.target.value})} placeholder="Leave blank to keep current" className="w-full px-3 py-2 border border-[#DFDFDF] rounded-[4px] text-sm focus:outline-none focus:border-[#161616]/50" />
              </div>
              <div className="flex justify-end gap-2 mt-4">
                <button type="button" onClick={() => setEditingUser(null)} className="px-4 py-2 text-xs font-bold text-[#161616]/50 hover:text-[#161616]">CANCEL</button>
                <button type="submit" disabled={isSubmitting} className="bg-[#161616] text-white px-6 py-2 rounded-[4px] text-xs font-bold hover:opacity-90 disabled:opacity-50 uppercase tracking-widest">SAVE CHANGES</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* User Invite Modal */}
      {showInviteModal && (
        <div className="fixed inset-0 bg-[#161616]/20 backdrop-blur-sm flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-[6px] shadow-xl border border-[#DFDFDF] w-full max-w-[400px] overflow-hidden">
            <div className="flex justify-between items-center px-6 py-4 border-b border-[#DFDFDF]">
              <h3 className="text-[12px] font-black text-[#161616] uppercase tracking-widest">Invite New Member</h3>
              <button onClick={() => setShowInviteModal(false)} className="text-[#161616]/30 hover:text-[#161616]"><X className="w-4 h-4" /></button>
            </div>
            <form onSubmit={handleInvite} className="p-6 flex flex-col gap-4">
              <div>
                <label className="text-[10px] font-bold text-[#161616]/40 uppercase tracking-widest block mb-1">Username</label>
                <input type="text" required value={newUser.username} onChange={e => setNewUser({...newUser, username: e.target.value})} className="w-full px-3 py-2 border border-[#DFDFDF] rounded-[4px] text-sm focus:outline-none focus:border-[#161616]/50" />
              </div>
              <div>
                <label className="text-[10px] font-bold text-[#161616]/40 uppercase tracking-widest block mb-1">Password</label>
                <input type="text" required value={newUser.password} onChange={e => setNewUser({...newUser, password: e.target.value})} className="w-full px-3 py-2 border border-[#DFDFDF] rounded-[4px] text-sm focus:outline-none focus:border-[#161616]/50" />
              </div>
              <div>
                <label className="text-[10px] font-bold text-[#161616]/40 uppercase tracking-widest block mb-1">Role</label>
                <select value={newUser.role} onChange={e => setNewUser({...newUser, role: e.target.value as UserRole})} className="w-full px-3 py-2 border border-[#DFDFDF] rounded-[4px] text-sm focus:outline-none focus:border-[#161616]/50 bg-white">
                  {availableRoles.map(r => (
                    <option key={r} value={r}>{ROLE_LABEL[r]}</option>
                  ))}
                </select>
              </div>
              <div className="flex justify-end gap-2 mt-4">
                <button type="button" onClick={() => setShowInviteModal(false)} className="px-4 py-2 text-xs font-bold text-[#161616]/50 hover:text-[#161616]">CANCEL</button>
                <button type="submit" disabled={isSubmitting} className="bg-[#161616] text-white px-6 py-2 rounded-[4px] text-xs font-bold hover:opacity-90 disabled:opacity-50 uppercase tracking-widest shadow-lg">SEND INVITE</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
