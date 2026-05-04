import React, { useState, useEffect } from 'react';
import { api } from '../api/services';
import { User, UserRole } from '../types';
import { Search, MoreVertical, X } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { ROLE_BADGE, ROLE_LABEL, AVAIL_DOT, AVAIL_BADGE } from '../utils/badges';

export const TeamPage: React.FC = () => {
  const { role: currentUserRole } = useAuth();
  const [users, setUsers] = useState<User[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [search, setSearch] = useState('');
  
  // Edit state
  const [editingUser, setEditingUser] = useState<User | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const fetchUsers = () => {
    setIsLoading(true);
    api.users.getAll().then((data) => {
      // Security Filter: Only SuperAdmins can see SuperAdmin details in the team list
      let filteredData = data;
      if (currentUserRole !== 'SUPER_ADMIN') {
        filteredData = data.filter(u => u.role !== 'SUPER_ADMIN');
      }
      setUsers(filteredData);
      setIsLoading(false);
    }).catch(err => {
      console.error(err);
      setIsLoading(false);
    });
  };

  useEffect(() => {
    fetchUsers();
  }, [currentUserRole]);

  const handleEditUser = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingUser) return;

    // Additional check: Non-SuperAdmins cannot promote users to SuperAdmin
    if (currentUserRole !== 'SUPER_ADMIN' && editingUser.role === 'SUPER_ADMIN') {
      alert("Permission Denied: You cannot grant Super Administrator privileges.");
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
      fetchUsers();
    } catch (err) {
      console.error("Failed to update user", err);
      alert("Failed to update user.");
    } finally {
      setIsSubmitting(false);
    }
  };

  const filtered = users.filter((u) => u.username.toLowerCase().includes(search.toLowerCase()));
  const available = users.filter((u) => u.availability === 'Available').length;
  const busy = users.filter((u) => u.availability === 'Busy').length;
  const offline = users.filter((u) => u.availability === 'Offline').length;

  return (
    <div className="flex flex-col gap-6">
      <div className="flex justify-between items-center">
        <div>
          <h2 className="text-xl font-bold text-[#161616] tracking-tight">Team & Availability</h2>
          <p className="text-sm text-[#161616]/40 font-medium mt-0.5">Monitor team capacity and workload in real-time.</p>
        </div>
      </div>

      <div className="grid grid-cols-3 gap-4">
        <div className="bg-white border border-[#DFDFDF] rounded-[6px] p-5">
          <div className="flex items-center gap-3 mb-2">
            <div className="w-2.5 h-2.5 rounded-full bg-[#161616]"></div>
            <span className="text-[10px] font-bold text-[#161616]/40 uppercase tracking-widest">Available</span>
          </div>
          <div className="text-2xl font-bold text-[#161616] tabular-nums">{available}</div>
        </div>
        <div className="bg-white border border-[#DFDFDF] rounded-[6px] p-5">
          <div className="flex items-center gap-3 mb-2">
            <div className="w-2.5 h-2.5 rounded-full bg-[#161616]/40"></div>
            <span className="text-[10px] font-bold text-[#161616]/40 uppercase tracking-widest">Busy</span>
          </div>
          <div className="text-2xl font-bold text-[#161616] tabular-nums">{busy}</div>
        </div>
        <div className="bg-white border border-[#DFDFDF] rounded-[6px] p-5">
          <div className="flex items-center gap-3 mb-2">
            <div className="w-2.5 h-2.5 rounded-full bg-[#DFDFDF] border border-[#161616]/10"></div>
            <span className="text-[10px] font-bold text-[#161616]/40 uppercase tracking-widest">Offline</span>
          </div>
          <div className="text-2xl font-bold text-[#161616]/30 tabular-nums">{offline}</div>
        </div>
      </div>

      <div className="flex items-center gap-3 bg-white border border-[#DFDFDF] rounded-[6px] px-4 py-2.5 shadow-sm">
        <Search className="w-4 h-4 text-[#161616]/20 shrink-0" />
        <input
          type="text"
          placeholder="Search team members..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="flex-1 text-sm focus:outline-none text-[#161616] placeholder:text-[#161616]/30"
        />
      </div>

      {isLoading ? (
        <div className="bg-white border border-[#DFDFDF] rounded-[6px] p-12 text-center text-[#161616]/30 italic text-sm">Loading team intelligence...</div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {filtered.length === 0 ? (
            <div className="col-span-full py-20 text-center text-[#161616]/30 italic bg-white border border-[#DFDFDF] border-dashed rounded-[6px]">No team members found matching your search.</div>
          ) : (
            filtered.map((member) => (
              <div
                key={member.id}
                className="bg-white border border-[#DFDFDF] rounded-[6px] p-5 hover:border-[#161616]/20 hover:shadow-sm transition-all animate-in fade-in duration-300"
              >
                <div className="flex items-start justify-between mb-4">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-full bg-[#161616]/5 border border-[#161616]/5 flex items-center justify-center text-sm font-bold text-[#161616]">
                      {member.username[0].toUpperCase()}
                    </div>
                    <div>
                      <p className="text-sm font-bold text-[#161616]">{member.username}</p>
                      <p className="text-[10px] text-[#161616]/40 mt-0.5 uppercase font-bold tracking-tighter">{member.team || 'General Team'}</p>
                    </div>
                  </div>
                  {(currentUserRole === 'SUPER_ADMIN' || (currentUserRole === 'ADMIN' && member.role === 'SALES_REP')) && (
                    <button 
                      onClick={() => setEditingUser(member)}
                      className="p-1 hover:bg-[#F9F9F9] rounded-[4px] transition-all"
                    >
                      <MoreVertical className="w-4 h-4 text-[#161616]/20" />
                    </button>
                  )}
                </div>

                <div className="flex items-center justify-between">
                  <span className={`px-2 py-0.5 rounded-[3px] text-[10px] font-bold uppercase tracking-wider ${ROLE_BADGE[member.role]}`}>
                    {ROLE_LABEL[member.role]}
                  </span>
                  <div className="flex items-center gap-1.5">
                    <div className={`w-2 h-2 rounded-full ${AVAIL_DOT[member.availability]}`}></div>
                    <span className={`text-[11px] font-semibold ${AVAIL_BADGE[member.availability]}`}>
                      {member.availability}
                    </span>
                  </div>
                </div>

                {member.metrics && (
                  <div className="mt-4 pt-4 border-t border-[#DFDFDF] grid grid-cols-3 gap-2 text-center">
                    <div>
                      <div className="text-lg font-bold text-[#161616] tabular-nums">{member.metrics.openLeads}</div>
                      <div className="text-[9px] font-bold text-[#161616]/30 uppercase tracking-wider mt-0.5">Leads</div>
                    </div>
                    <div>
                      <div className="text-lg font-bold text-[#161616] tabular-nums">{member.metrics.openDeals}</div>
                      <div className="text-[9px] font-bold text-[#161616]/30 uppercase tracking-wider mt-0.5">Deals</div>
                    </div>
                    <div>
                      <div className="text-lg font-bold text-[#161616] tabular-nums">{member.metrics.todayInteractions}</div>
                      <div className="text-[9px] font-bold text-[#161616]/30 uppercase tracking-wider mt-0.5">Today</div>
                    </div>
                  </div>
                )}
              </div>
            ))
          )}
        </div>
      )}

      {editingUser && (
        <div className="fixed inset-0 bg-[#161616]/40 backdrop-blur-[2px] flex items-center justify-center z-[9999] p-4">
          <div className="bg-white rounded-[6px] shadow-2xl border border-[#DFDFDF] w-full max-w-[400px] overflow-hidden animate-in zoom-in duration-200">
            <div className="flex justify-between items-center px-6 py-4 border-b border-[#DFDFDF] bg-[#F9F9F9]">
              <h3 className="text-sm font-bold text-[#161616] uppercase tracking-widest">Update User Profile</h3>
              <button onClick={() => setEditingUser(null)} className="text-[#161616]/30 hover:text-[#161616]">
                <X className="w-4 h-4" />
              </button>
            </div>
            <form onSubmit={handleEditUser} className="p-6 flex flex-col gap-5">
              <div>
                <label className="text-[10px] font-bold text-[#161616]/40 uppercase tracking-widest block mb-1">Display Name</label>
                <input 
                  type="text" required 
                  value={editingUser.username} onChange={e => setEditingUser({...editingUser, username: e.target.value})}
                  className="w-full px-3 py-2 border border-[#DFDFDF] rounded-[4px] text-sm focus:outline-none focus:border-[#161616]/50" 
                />
              </div>
              <div>
                <label className="text-[10px] font-bold text-[#161616]/40 uppercase tracking-widest block mb-1">Team Role</label>
                <select 
                  value={editingUser.role} onChange={e => setEditingUser({...editingUser, role: e.target.value as UserRole})}
                  className="w-full px-3 py-2 border border-[#DFDFDF] rounded-[4px] text-sm focus:outline-none focus:border-[#161616]/50 bg-white"
                >
                  <option value="SALES_REP">Sales Rep</option>
                  <option value="ADMIN">Admin (Team Lead)</option>
                  {currentUserRole === 'SUPER_ADMIN' && <option value="SUPER_ADMIN">Super Administrator</option>}
                </select>
              </div>
              <div>
                <label className="text-[10px] font-bold text-[#161616]/40 uppercase tracking-widest block mb-1">Assigned Team</label>
                <input 
                  type="text" 
                  value={editingUser.team || ''} onChange={e => setEditingUser({...editingUser, team: e.target.value})}
                  className="w-full px-3 py-2 border border-[#DFDFDF] rounded-[4px] text-sm focus:outline-none focus:border-[#161616]/50" 
                />
              </div>
              <div className="flex justify-end gap-2 mt-4">
                <button type="button" onClick={() => setEditingUser(null)} className="px-4 py-2 text-xs font-bold text-[#161616]/50 hover:text-[#161616]">CANCEL</button>
                <button type="submit" disabled={isSubmitting} className="bg-[#161616] text-white px-6 py-2 rounded-[4px] text-xs font-bold hover:opacity-90 disabled:opacity-50">
                  {isSubmitting ? 'SAVING...' : 'SAVE CHANGES'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
