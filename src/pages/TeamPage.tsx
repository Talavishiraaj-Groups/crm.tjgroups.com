import React, { useState, useEffect } from 'react';
import { api } from '../api/services';
import { User, UserRole } from '../types';
import { Search, MoreVertical, X } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { ROLE_BADGE, ROLE_LABEL, AVAIL_DOT, AVAIL_BADGE } from '../utils/badges';

export const TeamPage: React.FC = () => {
  const { role } = useAuth();
  const [users, setUsers] = useState<User[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [search, setSearch] = useState('');
  
  // Edit state
  const [editingUser, setEditingUser] = useState<User | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const fetchUsers = () => {
    setIsLoading(true);
    api.users.getAll().then((data) => {
      setUsers(data);
      setIsLoading(false);
    }).catch(err => {
      console.error(err);
      setIsLoading(false);
    });
  };

  useEffect(() => {
    fetchUsers();
  }, []);

  const handleEditUser = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingUser) return;
    setIsSubmitting(true);
    try {
      await api.users.update(editingUser.id, {
        username: editingUser.username,
        role: editingUser.role,
        team: editingUser.team || undefined,
        password: editingUser.password // Allows setting a new password
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

      {/* Availability summary — monochromatic 3-block */}
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

      {/* Search */}
      <div className="flex items-center gap-3 bg-white border border-[#DFDFDF] rounded-[6px] px-4 py-2.5">
        <Search className="w-4 h-4 text-[#161616]/20 shrink-0" />
        <input
          type="text"
          placeholder="Search team members..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="flex-1 text-sm focus:outline-none text-[#161616] placeholder:text-[#161616]/30"
        />
      </div>

      {/* Member cards */}
      {isLoading ? (
        <div className="bg-white border border-[#DFDFDF] rounded-[6px] p-12 text-center text-[#161616]/30 italic text-sm">Loading team...</div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {filtered.map((member) => (
            <div
              key={member.id}
              className="bg-white border border-[#DFDFDF] rounded-[6px] p-5 hover:border-[#161616]/20 hover:shadow-sm transition-all"
            >
              <div className="flex items-start justify-between mb-4">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-full bg-[#DFDFDF] flex items-center justify-center text-sm font-bold text-[#161616]">
                    {member.username[0].toUpperCase()}
                  </div>
                  <div>
                    <p className="text-sm font-bold text-[#161616]">{member.username}</p>
                    <p className="text-[10px] text-[#161616]/40 mt-0.5">{member.team || 'No Team'}</p>
                  </div>
                </div>
                {(role === 'SUPER_ADMIN' || role === 'ADMIN') && (
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

              {/* Metrics — if available */}
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
          ))}
        </div>
      )}

      {/* Edit User Modal */}
      {editingUser && (
        <div className="fixed inset-0 bg-[#161616]/20 backdrop-blur-sm flex items-center justify-center z-50">
          <div className="bg-white rounded-[6px] shadow-xl border border-[#DFDFDF] w-[400px] overflow-hidden">
            <div className="flex justify-between items-center px-6 py-4 border-b border-[#DFDFDF]">
              <h3 className="text-[14px] font-bold text-[#161616] tracking-tight">Edit User</h3>
              <button onClick={() => setEditingUser(null)} className="text-[#161616]/30 hover:text-[#161616]">
                <X className="w-4 h-4" />
              </button>
            </div>
            <form onSubmit={handleEditUser} className="p-6 flex flex-col gap-4">
              <div>
                <label className="text-[10px] font-bold text-[#161616]/40 uppercase tracking-widest block mb-1">Username / Name</label>
                <input 
                  type="text" required 
                  value={editingUser.username} onChange={e => setEditingUser({...editingUser, username: e.target.value})}
                  className="w-full px-3 py-2 border border-[#DFDFDF] rounded-[4px] text-sm focus:outline-none focus:border-[#161616]/50" 
                />
              </div>
              <div>
                <label className="text-[10px] font-bold text-[#161616]/40 uppercase tracking-widest block mb-1">Reset Password (Optional)</label>
                <input 
                  type="text" 
                  value={editingUser.password || ''} onChange={e => setEditingUser({...editingUser, password: e.target.value})}
                  className="w-full px-3 py-2 border border-[#DFDFDF] rounded-[4px] text-sm focus:outline-none focus:border-[#161616]/50" 
                  placeholder="Enter to change password"
                />
              </div>
              <div>
                <label className="text-[10px] font-bold text-[#161616]/40 uppercase tracking-widest block mb-1">Role</label>
                <select 
                  value={editingUser.role} onChange={e => setEditingUser({...editingUser, role: e.target.value as UserRole})}
                  className="w-full px-3 py-2 border border-[#DFDFDF] rounded-[4px] text-sm focus:outline-none focus:border-[#161616]/50 bg-white"
                >
                  <option value="SALES_REP">Sales Rep</option>
                  <option value="ADMIN">Admin (Team Lead)</option>
                  <option value="SUPER_ADMIN">Super Administrator</option>
                </select>
              </div>
              <div>
                <label className="text-[10px] font-bold text-[#161616]/40 uppercase tracking-widest block mb-1">Team Assignment (Optional)</label>
                <input 
                  type="text" 
                  value={editingUser.team || ''} onChange={e => setEditingUser({...editingUser, team: e.target.value})}
                  className="w-full px-3 py-2 border border-[#DFDFDF] rounded-[4px] text-sm focus:outline-none focus:border-[#161616]/50" 
                />
              </div>
              <div className="flex justify-end gap-2 mt-4">
                <button type="button" onClick={() => setEditingUser(null)} className="px-4 py-2 text-xs font-bold text-[#161616]/50 hover:text-[#161616]">CANCEL</button>
                <button type="submit" disabled={isSubmitting} className="bg-[#161616] text-white px-4 py-2 rounded-[4px] text-xs font-bold hover:opacity-90 disabled:opacity-50">
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
