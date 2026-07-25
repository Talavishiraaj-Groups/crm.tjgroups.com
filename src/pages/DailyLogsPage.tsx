import React, { useState, useEffect } from 'react';
import { api } from '../api/services';
import { Log, User } from '../types';
import { useAuth } from '../context/AuthContext';
import { DailyLogsTab } from '../components/DailyLogsTab';

export const DailyLogsPage: React.FC = () => {
  const { user, role } = useAuth();
  const [logs, setLogs] = useState<Log[]>([]);
  const [allUsers, setAllUsers] = useState<User[]>([]);
  const [hasLoggedToday, setHasLoggedToday] = useState(false);
  const [dailyNote, setDailyNote] = useState('');
  const [isLoggingDaily, setIsLoggingDaily] = useState(false);
  const [isLoading, setIsLoading] = useState(true);

  const fetchData = async () => {
    if (!user) return;
    setIsLoading(true);
    try {
      const [usersData, logsData] = await Promise.all([
        api.users.getAll(),
        api.logs.getByEntity('GLOBAL')
      ]);
      setAllUsers(usersData);
      setLogs(logsData);

      const today = new Date().toDateString();
      const loggedToday = logsData.some(l =>
        (l.userId === user.id || l.userId === user.username) &&
        l.action === 'DAILY_LOG' &&
        new Date(l.timestamp).toDateString() === today
      );
      setHasLoggedToday(loggedToday);
    } catch (err) {
      console.error(err);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
  }, [user]);

  const handleSubmitLog = async () => {
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
  };

  if (isLoading) {
    return (
      <div className="flex flex-col items-center justify-center py-32 gap-4">
        <div className="w-8 h-8 border-2 border-[#161616] border-t-transparent rounded-full animate-spin"></div>
        <p className="text-[10px] font-black text-[#161616]/30 uppercase tracking-[0.2em]">Loading Daily Logs Environment</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h2 className="text-xl font-bold text-[#161616] tracking-tight">Daily Contribution Logs</h2>
        <p className="text-sm text-[#161616]/40 font-medium mt-0.5">Submit and review team daily operational summaries.</p>
      </div>

      <DailyLogsTab
        logs={logs}
        allUsers={allUsers}
        currentUser={user}
        currentUserRole={role}
        hasLoggedToday={hasLoggedToday}
        dailyNote={dailyNote}
        setDailyNote={setDailyNote}
        isLoggingDaily={isLoggingDaily}
        onSubmitLog={handleSubmitLog}
      />
    </div>
  );
};
