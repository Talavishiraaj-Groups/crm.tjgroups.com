import React, { useState, useEffect } from 'react';
import { User, UserRole, Lead, Deal } from '../types';
import { api } from '../api/services';
import { UserPlus, Search, MoreVertical, CheckCircle, XCircle, X, LayoutGrid, Users as UsersIcon, Briefcase } from 'lucide-react';
import { ROLE_BADGE, ROLE_LABEL, AVAIL_DOT } from '../utils/badges';

export const AdminPage: React.FC = () => {
  const [users, setUsers] = useState<User[]>([]);
  const [leads, setLeads] = useState<Lead[]>([]);
  const [deals, setDeals] = useState<Deal[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [tab, setTab] = useState<'users' | 'assignments'>('users');
  
  // Modal state
  const [showInviteModal, setShowInviteModal] = useState(false);
  const [editingUser, setEditingUser] = useState<User | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [newUser, setNewUser] = useState({ username: '', password: '', role: 'SALES_REP' as UserRole, team: '' });

  const fetchData = () => {
    setIsLoading(true);
    Promise.all([
      api.users.getAll(),
      api.leads.getAll('SUPER_ADMIN', ''), // Fetch all
      api.deals.getAll('SUPER_ADMIN', '')  // Fetch all
    ]).then(([usersData, leadsData, dealsData]) => {
      setUsers(usersData);
      setLeads(leadsData);
      setDeals(dealsData);
      setIsLoading(false);
    }).catch(err => {
      console.error(err);
      setIsLoading(false);
    });
  };

  useEffect(() => {
    fetchData();
  }, []);

  const handleInvite = async (e: React.FormEvent) => {
    e.preventDefault();
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

  const toggleStatus = async (user: User) => {
    try {
      const newStatus = user.status === 'Active' ? 'Inactive' : 'Active';
      await api.users.update(user.id, { status: newStatus });
      fetchData();
    } catch (err) {
      console.error(err);
    }
  };

  const getUsername = (id: string) => users.find(u => u.id === id)?.username || `ID: ${id}`;

  const filteredUsers = users.filter((u) =>
    u.username.toLowerCase().includes(search.toLowerCase()) ||
    u.role.toLowerCase().includes(search.toLowerCase())
  );

  return (
    <div className="flex flex-col gap-6 relative">
      <div className="flex justify-between items-center">
        <div>
          <h2 className="text-xl font-bold text-[#161616] tracking-tight">Administrative Controls</h2>
          <p className="text-sm text-[#161616]/40 font-medium mt-0.5">Manage team access and view global ownership assignments.</p>
        </div>
        <div className="flex gap-2">
          <button 
            onClick={() => setTab(tab === 'users' ? 'assignments' : 'users')}
            className="flex items-center gap-2 border border-[#DFDFDF] text-[#161616]/60 px-4 py-2 rounded-[6px] text-xs font-bold hover:border-[#161616]/30 transition-all"
          >
            {tab === 'users' ? <LayoutGrid className="w-4 h-4" /> : <UsersIcon className="w-4 h-4" />}
            {tab === 'users' ? 'VIEW ASSIGNMENTS' : 'MANAGE USERS'}
          </button>
          {tab === 'users' && (
            <button 
              onClick={() => setShowInviteModal(true)}
              className="flex items-center gap-2 bg-[#161616] text-white px-4 py-2 rounded-[6px] text-xs font-bold hover:opacity-90 transition-all"
            >
              <UserPlus className="w-4 h-4" /> INVITE USER
            </button>
          )}
        </div>
      </div>

      {tab === 'users' ? (
        <>
          <div className="grid grid-cols-3 gap-4">
            {(['SUPER_ADMIN', 'ADMIN', 'SALES_REP'] as const).map((r, i) => (
              <div key={r} className={`rounded-[6px] p-5 border ${i === 0 ? 'bg-[#161616] border-[#161616]' : 'bg-white border-[#DFDFDF]'}`}>
                <div className={`text-[10px] font-bold uppercase tracking-widest mb-2 ${i === 0 ? 'text-white/30' : 'text-[#161616]/30'}`}>
                  {ROLE_LABEL[r]}
                </div>
                <div className={`text-2xl font-bold tabular-nums ${i === 0 ? 'text-white' : 'text-[#161616]'}`}>
                  {users.filter((u) => u.role === r).length}
                </div>
              </div>
            ))}
          </div>

          <div className="flex items-center gap-3 bg-white border border-[#DFDFDF] rounded-[6px] px-4 py-2.5">
            <Search className="w-4 h-4 text-[#161616]/20 shrink-0" />
            <input
              type="text" placeholder="Search by name or role..." value={search} onChange={(e) => setSearch(e.target.value)}
              className="flex-1 text-sm focus:outline-none text-[#161616] placeholder:text-[#161616]/30"
            />
          </div>

          {isLoading ? (
            <div className="bg-white border border-[#DFDFDF] rounded-[6px] p-12 text-center text-[#161616]/30 italic text-sm">Loading users...</div>
          ) : (
            <div className="bg-white border border-[#DFDFDF] rounded-[6px] overflow-hidden">
              <table className="w-full border-collapse">
                <thead>
                  <tr className="border-b border-[#DFDFDF]">
                    {['User', 'Role', 'Team', 'Status', 'Actions'].map((h) => (
                      <th key={h} className="text-left px-5 py-3 text-[10px] font-bold text-[#161616]/30 uppercase tracking-widest">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {filteredUsers.map((u) => (
                    <tr key={u.id} className="border-b border-[#DFDFDF] last:border-0 hover:bg-[#F9F9F9] transition-colors">
                      <td className="px-5 py-3.5">
                        <div className="flex items-center gap-3">
                          <div className="w-8 h-8 rounded-full bg-[#DFDFDF] flex items-center justify-center text-xs font-bold text-[#161616]">
                            {u.username[0].toUpperCase()}
                          </div>
                          <div>
                            <p className="text-sm font-semibold text-[#161616]">{u.username}</p>
                            <p className="text-[10px] text-[#161616]/30 font-mono">{u.id}</p>
                          </div>
                        </div>
                      </td>
                      <td className="px-5 py-3.5">
                        <span className={`px-2 py-0.5 rounded-[3px] text-[10px] font-bold uppercase tracking-wider ${ROLE_BADGE[u.role]}`}>
                          {ROLE_LABEL[u.role]}
                        </span>
                      </td>
                      <td className="px-5 py-3.5 text-sm text-[#161616]/40">{u.team || '—'}</td>
                      <td className="px-5 py-3.5">
                        <div className="flex items-center gap-1.5">
                          <div className={`w-2 h-2 rounded-full ${u.status === 'Active' ? 'bg-[#161616]' : 'bg-[#DFDFDF]'}`}></div>
                          <span className="text-sm text-[#161616]/60">{u.status}</span>
                        </div>
                      </td>
                      <td className="px-5 py-3.5 text-right">
                        <div className="flex items-center gap-2 justify-end">
                          <button onClick={() => toggleStatus(u)} className="text-[10px] font-bold text-[#161616]/50 border border-[#DFDFDF] px-2 py-1 rounded-[4px] hover:text-[#161616] transition-all">
                            {u.status === 'Active' ? 'DEACTIVATE' : 'ACTIVATE'}
                          </button>
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
          )}
        </>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Leads Assignment */}
          <div className="bg-white border border-[#DFDFDF] rounded-[6px] overflow-hidden">
            <div className="px-5 py-4 border-b border-[#DFDFDF] flex justify-between items-center bg-[#F9F9F9]">
              <h3 className="text-[10px] font-bold text-[#161616]/30 uppercase tracking-widest flex items-center gap-2">
                <UsersIcon className="w-3.5 h-3.5" /> Global Leads Assignment
              </h3>
              <span className="text-[10px] font-mono text-[#161616]/40">{leads.length} TOTAL</span>
            </div>
            <div className="max-h-[500px] overflow-y-auto">
              <table className="w-full border-collapse">
                <thead className="sticky top-0 bg-white shadow-sm">
                  <tr className="border-b border-[#DFDFDF]">
                    <th className="text-left px-5 py-2 text-[9px] font-bold text-[#161616]/30 uppercase">Client</th>
                    <th className="text-left px-5 py-2 text-[9px] font-bold text-[#161616]/30 uppercase">Setter (Owner)</th>
                  </tr>
                </thead>
                <tbody>
                  {leads.map(l => (
                    <tr key={l.id} className="border-b border-[#DFDFDF] last:border-0 hover:bg-[#F9F9F9]">
                      <td className="px-5 py-3 text-sm font-medium text-[#161616]">{l.name}</td>
                      <td className="px-5 py-3 text-xs text-[#161616]/60 font-semibold">{getUsername(l.ownerRepId)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {/* Deals Assignment */}
          <div className="bg-white border border-[#DFDFDF] rounded-[6px] overflow-hidden">
            <div className="px-5 py-4 border-b border-[#DFDFDF] flex justify-between items-center bg-[#F9F9F9]">
              <h3 className="text-[10px] font-bold text-[#161616]/30 uppercase tracking-widest flex items-center gap-2">
                <Briefcase className="w-3.5 h-3.5" /> Global Deals Ownership
              </h3>
              <span className="text-[10px] font-mono text-[#161616]/40">{deals.length} TOTAL</span>
            </div>
            <div className="max-h-[500px] overflow-y-auto">
              <table className="w-full border-collapse">
                <thead className="sticky top-0 bg-white shadow-sm">
                  <tr className="border-b border-[#DFDFDF]">
                    <th className="text-left px-5 py-2 text-[9px] font-bold text-[#161616]/30 uppercase">Deal</th>
                    <th className="text-left px-5 py-2 text-[9px] font-bold text-[#161616]/30 uppercase">Setter</th>
                    <th className="text-left px-5 py-2 text-[9px] font-bold text-[#161616]/30 uppercase">Closer</th>
                  </tr>
                </thead>
                <tbody>
                  {deals.map(d => {
                    const lead = leads.find(l => l.id === d.leadId);
                    const setter = lead ? getUsername(lead.ownerRepId) : 'Unknown';
                    const closer = getUsername(d.ownerRepId);
                    return (
                      <tr key={d.id} className="border-b border-[#DFDFDF] last:border-0 hover:bg-[#F9F9F9]">
                        <td className="px-5 py-3 text-sm font-medium text-[#161616] truncate max-w-[120px]">
                          {lead?.name || `Deal ${d.id.split('-')[0]}`}
                        </td>
                        <td className="px-5 py-3 text-xs text-[#161616]/60">{setter}</td>
                        <td className="px-5 py-3 text-xs text-[#161616]/60">{closer}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* Invite Modal */}
      {showInviteModal && (
        <div className="fixed inset-0 bg-[#161616]/20 backdrop-blur-sm flex items-center justify-center z-50">
          <div className="bg-white rounded-[6px] shadow-xl border border-[#DFDFDF] w-[400px] overflow-hidden">
            <div className="flex justify-between items-center px-6 py-4 border-b border-[#DFDFDF]">
              <h3 className="text-[14px] font-bold text-[#161616] tracking-tight">Invite New User</h3>
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
                  <option value="SALES_REP">Sales Rep</option>
                  <option value="ADMIN">Admin (Team Lead)</option>
                  <option value="SUPER_ADMIN">Super Administrator</option>
                </select>
              </div>
              <div className="flex justify-end gap-2 mt-4">
                <button type="button" onClick={() => setShowInviteModal(false)} className="px-4 py-2 text-xs font-bold text-[#161616]/50 hover:text-[#161616]">CANCEL</button>
                <button type="submit" disabled={isSubmitting} className="bg-[#161616] text-white px-4 py-2 rounded-[4px] text-xs font-bold hover:opacity-90 disabled:opacity-50">SEND INVITE</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Edit User Modal */}
      {editingUser && (
        <div className="fixed inset-0 bg-[#161616]/20 backdrop-blur-sm flex items-center justify-center z-50">
          <div className="bg-white rounded-[6px] shadow-xl border border-[#DFDFDF] w-[400px] overflow-hidden">
            <div className="flex justify-between items-center px-6 py-4 border-b border-[#DFDFDF]">
              <h3 className="text-[14px] font-bold text-[#161616] tracking-tight">Edit User</h3>
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
                  <option value="SALES_REP">Sales Rep</option>
                  <option value="ADMIN">Admin (Team Lead)</option>
                  <option value="SUPER_ADMIN">Super Administrator</option>
                </select>
              </div>
              <div className="flex justify-end gap-2 mt-4">
                <button type="button" onClick={() => setEditingUser(null)} className="px-4 py-2 text-xs font-bold text-[#161616]/50 hover:text-[#161616]">CANCEL</button>
                <button type="submit" disabled={isSubmitting} className="bg-[#161616] text-white px-4 py-2 rounded-[4px] text-xs font-bold hover:opacity-90 disabled:opacity-50">SAVE CHANGES</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
