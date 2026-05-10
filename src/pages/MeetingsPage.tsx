import React, { useState, useEffect } from 'react';
import { Calendar, Clock, Plus, User as UserIcon, Link as LinkIcon, MessageSquare } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { api } from '../api/services';
import { Lead, Log } from '../types';

export const MeetingsPage: React.FC = () => {
  const { user, role } = useAuth();
  const [leads, setLeads] = useState<Lead[]>([]);
  const [meetings, setMeetings] = useState<Log[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [showScheduleModal, setShowScheduleModal] = useState(false);

  const [formData, setFormData] = useState({
    leadId: '',
    date: '',
    time: '',
    link: '',
    notes: ''
  });

  const fetchData = async () => {
    if (!user) return;
    setIsLoading(true);
    try {
      const [leadsData, allLogs] = await Promise.all([
        api.leads.getAll(role!, user.id),
        api.logs.getByEntity('GLOBAL')
      ]);
      setLeads(leadsData.filter(l => l.status !== 'Converted' && l.status !== 'Closed'));
      setMeetings(allLogs.filter(log => log.action === 'MEETING' || log.action === 'SCHEDULED_CALL'));
    } catch (err) {
      console.error("Failed to fetch meetings:", err);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
  }, [user]);

  const handleSchedule = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user) return;
    try {
      const lead = leads.find(l => l.id === formData.leadId);
      await api.logs.create({
        entityId: formData.leadId,
        entityType: 'Lead',
        action: 'MEETING',
        userId: user.id,
        details: `Meeting scheduled with ${lead?.name} for ${formData.date} at ${formData.time}. Notes: ${formData.notes}`,
        metadata: JSON.stringify({
          date: formData.date,
          time: formData.time,
          link: formData.link
        })
      });
      setShowScheduleModal(false);
      setFormData({ leadId: '', date: '', time: '', link: '', notes: '' });
      fetchData();
      alert('Meeting scheduled successfully!');
    } catch (err) {
      alert('Failed to schedule meeting.');
    }
  };

  if (isLoading) {
    return <div className="p-8 text-center text-[#161616]/40 uppercase tracking-widest font-bold text-xs">Loading meetings...</div>;
  }

  return (
    <div className="p-8 max-w-6xl mx-auto">
      <div className="flex justify-between items-end mb-10">
        <div>
          <h1 className="text-3xl font-black text-[#161616] tracking-tight uppercase">Setter Meetings</h1>
          <p className="text-[#161616]/50 text-sm font-medium mt-1">Manage and track your upcoming discovery calls</p>
        </div>
        <button 
          onClick={() => setShowScheduleModal(true)}
          className="flex items-center gap-2 bg-[#161616] text-white px-6 py-3 rounded-[4px] text-xs font-bold uppercase tracking-wider hover:opacity-90 transition-all shadow-lg"
        >
          <Plus size={16} />
          Schedule Meeting
        </button>
      </div>

      <div className="grid grid-cols-1 gap-6">
        {meetings.length === 0 ? (
          <div className="bg-white border border-[rgba(22,22,22,0.05)] rounded-[4px] p-20 text-center">
            <Calendar size={40} className="mx-auto text-[#161616]/10 mb-4" />
            <p className="text-[#161616]/40 text-sm font-bold uppercase tracking-widest">No meetings scheduled yet</p>
          </div>
        ) : (
          meetings.map((meeting) => {
            const meta = meeting.metadata ? JSON.parse(meeting.metadata) : {};
            const lead = leads.find(l => l.id === meeting.entityId);
            
            return (
              <div key={meeting.id} className="bg-white border border-[rgba(22,22,22,0.05)] rounded-[4px] p-6 hover:border-[#161616]/20 transition-all group shadow-sm">
                <div className="flex justify-between items-start">
                  <div className="flex gap-6">
                    <div className="w-16 h-16 bg-[#F9F9F9] rounded-[4px] flex flex-col items-center justify-center border border-[rgba(22,22,22,0.03)]">
                      <span className="text-[10px] font-black text-[#161616]/30 uppercase">{new Date(meta.date || meeting.timestamp).toLocaleString('en-US', { month: 'short' })}</span>
                      <span className="text-xl font-black text-[#161616]">{new Date(meta.date || meeting.timestamp).getDate()}</span>
                    </div>
                    <div>
                      <div className="flex items-center gap-2 mb-1">
                        <span className="text-[10px] font-black bg-[#161616] text-white px-2 py-0.5 rounded-[2px] uppercase tracking-tighter">Confirmed</span>
                        <h3 className="text-lg font-bold text-[#161616] tracking-tight">{lead?.name || 'Unknown Lead'}</h3>
                      </div>
                      <div className="flex items-center gap-4 text-[11px] font-bold text-[#161616]/40 uppercase tracking-widest">
                        <div className="flex items-center gap-1.5"><Clock size={12} /> {meta.time || 'TBD'}</div>
                        <div className="flex items-center gap-1.5"><UserIcon size={12} /> {meeting.userId === user?.id ? 'Scheduled by Me' : 'System Log'}</div>
                      </div>
                      <p className="mt-3 text-sm text-[#161616]/60 leading-relaxed max-w-xl">{meeting.details}</p>
                    </div>
                  </div>
                  
                  {meta.link && (
                    <a 
                      href={meta.link} 
                      target="_blank" 
                      rel="noopener noreferrer"
                      className="flex items-center gap-2 border border-[#161616]/10 text-[#161616] px-4 py-2 rounded-[4px] text-[10px] font-black uppercase tracking-widest hover:bg-[#161616] hover:text-white transition-all"
                    >
                      <LinkIcon size={14} />
                      Join Meeting
                    </a>
                  )}
                </div>
              </div>
            );
          })
        )}
      </div>

      {showScheduleModal && (
        <div className="fixed inset-0 bg-[#161616]/80 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-[4px] w-full max-w-lg p-10 shadow-2xl">
            <h2 className="text-2xl font-black text-[#161616] mb-8 uppercase tracking-tight">Schedule New Call</h2>
            <form onSubmit={handleSchedule} className="space-y-6">
              <div className="space-y-1.5">
                <label className="text-[10px] font-black text-[#161616]/40 uppercase tracking-widest">Select Lead</label>
                <select 
                  required
                  className="w-full bg-[#F9F9F9] border border-[rgba(22,22,22,0.05)] rounded-[4px] px-4 py-3 text-sm font-medium focus:outline-none focus:border-[#161616]/20 transition-all"
                  value={formData.leadId}
                  onChange={e => setFormData({...formData, leadId: e.target.value})}
                >
                  <option value="">Choose a prospect...</option>
                  {leads.map(l => (
                    <option key={l.id} value={l.id}>{l.name} ({l.email})</option>
                  ))}
                </select>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <label className="text-[10px] font-black text-[#161616]/40 uppercase tracking-widest">Date</label>
                  <input 
                    type="date"
                    required
                    className="w-full bg-[#F9F9F9] border border-[rgba(22,22,22,0.05)] rounded-[4px] px-4 py-3 text-sm font-medium focus:outline-none focus:border-[#161616]/20 transition-all"
                    value={formData.date}
                    onChange={e => setFormData({...formData, date: e.target.value})}
                  />
                </div>
                <div className="space-y-1.5">
                  <label className="text-[10px] font-black text-[#161616]/40 uppercase tracking-widest">Time</label>
                  <input 
                    type="time"
                    required
                    className="w-full bg-[#F9F9F9] border border-[rgba(22,22,22,0.05)] rounded-[4px] px-4 py-3 text-sm font-medium focus:outline-none focus:border-[#161616]/20 transition-all"
                    value={formData.time}
                    onChange={e => setFormData({...formData, time: e.target.value})}
                  />
                </div>
              </div>

              <div className="space-y-1.5">
                <label className="text-[10px] font-black text-[#161616]/40 uppercase tracking-widest">Meeting Link (Zoom/Meet)</label>
                <div className="relative">
                  <LinkIcon size={14} className="absolute left-4 top-1/2 -translate-y-1/2 text-[#161616]/20" />
                  <input 
                    type="url"
                    placeholder="https://zoom.us/j/..."
                    className="w-full bg-[#F9F9F9] border border-[rgba(22,22,22,0.05)] rounded-[4px] pl-10 pr-4 py-3 text-sm font-medium focus:outline-none focus:border-[#161616]/20 transition-all"
                    value={formData.link}
                    onChange={e => setFormData({...formData, link: e.target.value})}
                  />
                </div>
              </div>

              <div className="space-y-1.5">
                <label className="text-[10px] font-black text-[#161616]/40 uppercase tracking-widest">Brief Agenda / Notes</label>
                <textarea 
                  rows={3}
                  className="w-full bg-[#F9F9F9] border border-[rgba(22,22,22,0.05)] rounded-[4px] px-4 py-3 text-sm font-medium focus:outline-none focus:border-[#161616]/20 transition-all resize-none"
                  value={formData.notes}
                  onChange={e => setFormData({...formData, notes: e.target.value})}
                />
              </div>

              <div className="flex gap-4 pt-4">
                <button 
                  type="button"
                  onClick={() => setShowScheduleModal(false)}
                  className="flex-1 px-6 py-4 rounded-[4px] text-[10px] font-black uppercase tracking-widest border border-[#161616]/10 hover:bg-[#F9F9F9] transition-all"
                >
                  Cancel
                </button>
                <button 
                  type="submit"
                  className="flex-1 bg-[#161616] text-white px-6 py-4 rounded-[4px] text-[10px] font-black uppercase tracking-widest shadow-xl hover:opacity-90 transition-all"
                >
                  Schedule Call
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
