import React, { useState, useEffect } from 'react';
import { api } from '../api/services';
import { Project, Deal, ProjectStatus, User as UserType } from '../types';
import { useAuth } from '../context/AuthContext';
import { LayoutGrid, List, Plus, Calendar, User } from 'lucide-center'; // Note: Lucide icons can sometimes be tricky with names, I'll use Lucide-react
import { LayoutGrid as GridIcon, List as ListIcon, Plus as PlusIcon, Calendar as CalendarIcon, User as UserIcon } from 'lucide-react';
import { STATUS_BADGE } from '../utils/badges';

const STAGES: { key: ProjectStatus; label: string; pct: number }[] = [
  { key: 'Onboarding', label: 'Onboarding', pct: 15 },
  { key: 'InProgress', label: 'In Progress', pct: 55 },
  { key: 'Completed', label: 'Completed', pct: 100 },
];

const STAGE_FILL: Record<ProjectStatus, string> = {
  Onboarding: 'bg-[#161616]/20',
  InProgress:  'bg-[#161616]/60',
  Completed:   'bg-[#161616]',
};

export const ProjectsPage: React.FC = () => {
  const { role, user } = useAuth();
  const [projects, setProjects] = useState<Project[]>([]);
  const [deals, setDeals] = useState<Deal[]>([]);
  const [usersList, setUsers] = useState<UserType[]>([]);
  const [view, setView] = useState<'kanban' | 'table'>('kanban');
  const [isLoading, setIsLoading] = useState(true);

  // New Project Modal
  const [showModal, setShowModal] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [formData, setFormData] = useState({
    clientName: '', 
    dueDate: '', 
    startDate: new Date().toISOString().split('T')[0],
    accountManagerId: '',
    liaisonId: ''
  });

  const fetchData = () => {
    if (user && role) {
      setIsLoading(true);
      Promise.all([
        api.projects.getAll(role, user.id),
        api.deals.getAll(role, user.id),
        api.users.getAll()
      ]).then(([pData, dData, uData]) => {
        setProjects(pData);
        setDeals(dData.filter(d => d.status === 'Won'));
        setUsers(uData);
        setIsLoading(false);
      });
    }
  };

  useEffect(() => {
    fetchData();
  }, [role, user]);

  const handleCreateProject = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user) return;
    setIsSaving(true);
    try {
      await api.projects.create({
        clientName: formData.clientName,
        status: 'Onboarding',
        ownerRepId: user.id,
        startDate: formData.startDate,
        dueDate: formData.dueDate,
        accountManagerId: formData.accountManagerId,
        liaisonId: formData.liaisonId
      });
      setShowModal(false);
      setFormData({ 
        clientName: '', 
        dueDate: '', 
        startDate: new Date().toISOString().split('T')[0],
        accountManagerId: '',
        liaisonId: ''
      });
      fetchData();
    } catch (err) {
      console.error(err);
      alert('Failed to create project');
    } finally {
      setIsSaving(false);
    }
  };

  const isManagement = role === 'SUPER_ADMIN' || role === 'ADMIN';

  return (
    <div className="flex flex-col gap-6 relative">
      <div className="flex justify-between items-center">
        <div>
          <h2 className="text-xl font-bold text-[#161616] tracking-tight">Delivery & Projects</h2>
          <p className="text-sm text-[#161616]/40 font-medium mt-0.5">Track active client implementations and onboarding.</p>
        </div>
        <div className="flex items-center gap-3">
          <div className="flex bg-[#F9F9F9] border border-[#DFDFDF] p-0.5 rounded-[6px]">
            <button
              onClick={() => setView('kanban')}
              className={`p-2 rounded-[4px] transition-all ${view === 'kanban' ? 'bg-white shadow-sm text-[#161616]' : 'text-[#161616]/30 hover:text-[#161616]/60'}`}
            >
              <GridIcon className="w-4 h-4" />
            </button>
            <button
              onClick={() => setView('table')}
              className={`p-2 rounded-[4px] transition-all ${view === 'table' ? 'bg-white shadow-sm text-[#161616]' : 'text-[#161616]/30 hover:text-[#161616]/60'}`}
            >
              <ListIcon className="w-4 h-4" />
            </button>
          </div>
          <button 
            onClick={() => setShowModal(true)}
            className="flex items-center gap-2 bg-[#161616] text-white px-4 py-2 rounded-[6px] text-xs font-bold hover:opacity-90 transition-all"
          >
            <PlusIcon className="w-4 h-4" /> NEW PROJECT
          </button>
        </div>
      </div>

      {showModal && (
        <div className="fixed inset-0 bg-[#161616]/20 backdrop-blur-sm flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-[6px] border border-[#DFDFDF] w-full max-w-[400px] shadow-2xl overflow-hidden">
            <div className="px-6 py-4 border-b border-[#DFDFDF] flex justify-between items-center">
              <h3 className="text-sm font-bold text-[#161616] uppercase tracking-widest">Start New Project</h3>
              <button onClick={() => setShowModal(false)} className="text-[#161616]/30 hover:text-[#161616]">✕</button>
            </div>
            <form onSubmit={handleCreateProject} className="p-6 flex flex-col gap-4">
              <div>
                <label className="text-[10px] font-bold text-[#161616]/40 uppercase tracking-widest block mb-1">Client / Project Name</label>
                <input 
                  type="text" required value={formData.clientName} onChange={e => setFormData({...formData, clientName: e.target.value})}
                  className="w-full px-3 py-2 border border-[#DFDFDF] rounded-[4px] text-sm focus:outline-none focus:border-[#161616]/50" 
                  placeholder="e.g. Acme Corp Migration"
                />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="text-[10px] font-bold text-[#161616]/40 uppercase tracking-widest block mb-1">Account Manager</label>
                  <select 
                    disabled={!isManagement}
                    value={formData.accountManagerId} onChange={e => setFormData({...formData, accountManagerId: e.target.value})}
                    className="w-full px-3 py-2 border border-[#DFDFDF] rounded-[4px] text-sm focus:outline-none focus:border-[#161616]/50 bg-white disabled:bg-[#F9F9F9] disabled:cursor-not-allowed"
                  >
                    <option value="">— Unassigned —</option>
                    {usersList.map(u => <option key={u.id} value={u.id}>{u.username}</option>)}
                  </select>
                </div>
                <div>
                  <label className="text-[10px] font-bold text-[#161616]/40 uppercase tracking-widest block mb-1">Sales Liaison</label>
                  <select 
                    disabled={!isManagement}
                    value={formData.liaisonId} onChange={e => setFormData({...formData, liaisonId: e.target.value})}
                    className="w-full px-3 py-2 border border-[#DFDFDF] rounded-[4px] text-sm focus:outline-none focus:border-[#161616]/50 bg-white disabled:bg-[#F9F9F9] disabled:cursor-not-allowed"
                  >
                    <option value="">— Unassigned —</option>
                    {usersList.map(u => <option key={u.id} value={u.id}>{u.username}</option>)}
                  </select>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="text-[10px] font-bold text-[#161616]/40 uppercase tracking-widest block mb-1">Start Date</label>
                  <input 
                    type="date" required value={formData.startDate} onChange={e => setFormData({...formData, startDate: e.target.value})}
                    className="w-full px-3 py-2 border border-[#DFDFDF] rounded-[4px] text-sm focus:outline-none focus:border-[#161616]/50" 
                  />
                </div>
                <div>
                  <label className="text-[10px] font-bold text-[#161616]/40 uppercase tracking-widest block mb-1">Due Date</label>
                  <input 
                    type="date" required value={formData.dueDate} onChange={e => setFormData({...formData, dueDate: e.target.value})}
                    className="w-full px-3 py-2 border border-[#DFDFDF] rounded-[4px] text-sm focus:outline-none focus:border-[#161616]/50" 
                  />
                </div>
              </div>
              <div className="flex justify-end gap-2 mt-2">
                <button type="button" onClick={() => setShowModal(false)} className="px-4 py-2 text-xs font-bold text-[#161616]/50 hover:text-[#161616]">CANCEL</button>
                <button type="submit" disabled={isSaving} className="bg-[#161616] text-white px-5 py-2 rounded-[4px] text-xs font-bold hover:opacity-90 disabled:opacity-50">
                  {isSaving ? 'STARTING...' : 'START PROJECT'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {isLoading ? (
        <div className="bg-white border border-[#DFDFDF] rounded-[6px] p-12 text-center text-[#161616]/30 italic text-sm">Loading projects...</div>
      ) : view === 'kanban' ? (
        <div className="flex gap-4 overflow-x-auto pb-4">
          {STAGES.map((stage, stageIdx) => {
            const stageProjects = projects.filter((p) => p.status === stage.key);
            const isLast = stageIdx === STAGES.length - 1;
            return (
              <div key={stage.key} className="flex-1 min-w-[280px] flex flex-col gap-3">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <div className={`w-2.5 h-2.5 rounded-sm border border-[#161616]/30 ${isLast ? 'bg-[#161616]' : stageIdx === 1 ? 'bg-[#161616]/40' : 'bg-transparent'}`}></div>
                    <span className="text-[11px] font-bold text-[#161616]/50 uppercase tracking-widest">{stage.label}</span>
                  </div>
                  <span className="text-[10px] font-bold text-[#161616]/30 w-5 h-5 rounded-full bg-[#F9F9F9] border border-[#DFDFDF] flex items-center justify-center">
                    {stageProjects.length}
                  </span>
                </div>

                <div className="flex flex-col gap-3 min-h-[200px] bg-[#F9F9F9] rounded-[6px] p-2 border border-dashed border-[#DFDFDF]">
                  {stageProjects.length === 0 ? (
                    <div className="flex-1 flex items-center justify-center text-[11px] text-[#161616]/20 italic py-8">No projects</div>
                  ) : (
                    stageProjects.map((project) => (
                      <div
                        key={project.id}
                        className="bg-white border border-[#DFDFDF] rounded-[6px] p-4 cursor-pointer hover:border-[#161616]/20 hover:shadow-sm transition-all"
                      >
                        <h4 className="text-sm font-bold text-[#161616] mb-3">{project.clientName}</h4>
                        <div className="flex items-center gap-2 text-[11px] text-[#161616]/40 mb-1">
                          <CalendarIcon className="w-3 h-3" />
                          Due {new Date(project.dueDate).toLocaleDateString()}
                        </div>
                        <div className="flex items-center gap-2 text-[11px] text-[#161616]/40 mb-1">
                          <UserIcon className="w-3 h-3" />
                          AM: {usersList.find(u => u.id === project.accountManagerId)?.username || 'Unassigned'}
                        </div>
                        <div className="flex items-center gap-2 text-[11px] text-[#161616]/40 mb-4">
                          <UserIcon className="w-3 h-3 text-[#161616]/60" />
                          Liaison: {usersList.find(u => u.id === project.liaisonId)?.username || 'Unassigned'}
                        </div>
                        <div className="w-full h-1 bg-[#DFDFDF] rounded-full">
                          <div className={`h-1 rounded-full ${STAGE_FILL[project.status]}`} style={{ width: `${stage.pct}%` }}></div>
                        </div>
                        <div className="flex justify-between mt-1">
                          <span className="text-[10px] text-[#161616]/30">{stage.pct}% complete</span>
                        </div>
                      </div>
                    ))
                  )}
                </div>
              </div>
            );
          })}
        </div>
      ) : (
        <div className="bg-white border border-[#DFDFDF] rounded-[6px] overflow-hidden">
          <table className="w-full border-collapse">
            <thead>
              <tr className="border-b border-[#DFDFDF]">
                {['Client', 'Status', 'Account Manager', 'Liaison', 'Start Date', 'Due Date', 'Progress'].map((h) => (
                  <th key={h} className="text-left px-5 py-3 text-[10px] font-bold text-[#161616]/30 uppercase tracking-widest">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {projects.length === 0 ? (
                <tr><td colSpan={7} className="px-5 py-16 text-center text-[#161616]/30 italic text-sm">No projects found.</td></tr>
              ) : (
                projects.map((project) => {
                  const stageConfig = STAGES.find((s) => s.key === project.status);
                  return (
                    <tr key={project.id} className="border-b border-[#DFDFDF] last:border-0 hover:bg-[#F9F9F9] transition-colors">
                      <td className="px-5 py-3.5 text-sm font-semibold text-[#161616]">{project.clientName}</td>
                      <td className="px-5 py-3.5">
                        <span className={`px-2 py-0.5 rounded-[3px] text-[10px] font-bold uppercase tracking-wider ${STATUS_BADGE[project.status]}`}>
                          {project.status === 'InProgress' ? 'In Progress' : project.status}
                        </span>
                      </td>
                      <td className="px-5 py-3.5 text-sm text-[#161616]/40">
                        {usersList.find(u => u.id === project.accountManagerId)?.username || '-'}
                      </td>
                      <td className="px-5 py-3.5 text-sm text-[#161616]/40">
                        {usersList.find(u => u.id === project.liaisonId)?.username || '-'}
                      </td>
                      <td className="px-5 py-3.5 text-sm text-[#161616]/40">{new Date(project.startDate).toLocaleDateString()}</td>
                      <td className="px-5 py-3.5 text-sm text-[#161616]/40">{new Date(project.dueDate).toLocaleDateString()}</td>
                      <td className="px-5 py-3.5">
                        <div className="flex items-center gap-3">
                          <div className="w-20 h-1 bg-[#DFDFDF] rounded-full">
                            <div className={`h-1 rounded-full ${STAGE_FILL[project.status]}`} style={{ width: `${stageConfig?.pct || 0}%` }}></div>
                          </div>
                          <span className="text-[10px] text-[#161616]/30 tabular-nums">{stageConfig?.pct}%</span>
                        </div>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
};
