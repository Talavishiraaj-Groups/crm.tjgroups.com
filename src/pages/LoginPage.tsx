import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { User } from '../types';
import logo from '../assets/tjgroups-logo-dark.png';
import { api } from '../api/services';
import { MOCK_USERS } from '../api/mockData';

export const LoginPage: React.FC = () => {
  const { login } = useAuth();
  const navigate = useNavigate();
  const [users, setUsers] = useState<User[]>([]);
  const [loading, setLoading] = useState(true);

  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    const fetchUsers = async () => {
      try {
        const data = await api.users.getAll();
        const activeUsers = data.filter(u => u.status === 'Active');

        if (activeUsers.length === 0) {
          // Fallback to mock data if the live DB is completely empty so they can still test the app
          setUsers(MOCK_USERS);
        } else {
          setUsers(activeUsers);
        }
      } catch (error) {
        console.error("Failed to load users", error);
        // Fallback to mock data if the backend is down or not configured
        setUsers(MOCK_USERS);
        setError("Warning: Using demo credentials because live backend is unreachable.");
      } finally {
        setLoading(false);
      }
    };
    fetchUsers();
  }, []);

  const handleLogin = (e: React.FormEvent) => {
    e.preventDefault();
    setError('');

    // Find user by exact username (case-insensitive for convenience)
    const user = users.find(u => u.username.toLowerCase() === username.toLowerCase());

    if (user) {
      // If the user has a password in the DB, verify it. 
      // If they don't have one (legacy user/mock), let them in but warn.
      if (user.password && user.password !== password) {
        setError('Incorrect password.');
        return;
      }
      login(user);
      navigate('/');
    } else {
      setError('Invalid username or your account is inactive.');
    }
  };

  return (
    <div className="min-h-screen bg-[#F9F9F9] flex items-center justify-center p-4">
      <div className="w-full max-w-[420px] bg-white rounded-[6px] shadow-lg p-10 border border-[rgba(22,22,22,0.1)]">
        <div className="flex flex-col items-center mb-8">
          <img src={logo} alt="TJGROUPS" className="h-12 w-auto mb-4" />
          <h1 className="text-2xl font-bold text-[#161616] tracking-tight">TJGROUPS CRM</h1>
          <p className="text-sm text-[#161616]/50 mt-1 text-center">Enter your credentials to access the workspace</p>
        </div>

        {loading ? (
          <div className="text-center py-4 text-sm text-[#161616]/50">Loading...</div>
        ) : (
          <form onSubmit={handleLogin} className="flex flex-col gap-4">
            {error && (
              <div className="bg-red-50 text-red-600 px-4 py-3 rounded-[4px] text-xs font-bold border border-red-100">
                {error}
              </div>
            )}

            <div className="flex flex-col gap-1.5">
              <label className="text-[10px] font-bold text-[#161616]/50 uppercase tracking-widest">Username</label>
              <input
                type="text"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                required
                className="w-full px-4 py-3 border border-[#DFDFDF] rounded-[6px] text-sm focus:outline-none focus:border-[#161616]/50 text-[#161616] transition-colors"
                placeholder="e.g. team_lead"
              />
            </div>

            <div className="flex flex-col gap-1.5">
              <label className="text-[10px] font-bold text-[#161616]/50 uppercase tracking-widest">Password</label>
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                className="w-full px-4 py-3 border border-[#DFDFDF] rounded-[6px] text-sm focus:outline-none focus:border-[#161616]/50 text-[#161616] transition-colors"
                placeholder="••••••••"
              />
            </div>

            <button
              type="submit"
              className="w-full py-4 mt-2 rounded-[6px] font-bold transition-all bg-[#161616] text-white hover:opacity-90 text-sm tracking-wide"
            >
              SECURE LOGIN
            </button>
          </form>
        )}

        <div className="mt-8 pt-4 border-t border-[#DFDFDF] text-center">
          <div className="text-[10px] text-[#161616]/30 font-medium leading-relaxed">
            <p>© 2026 <a href="https://www.talavishiraajgroups.com/" target="_blank" rel="noopener noreferrer" className="hover:text-[#161616] transition-colors">Talavishiraaj Groups</a>. All rights reserved.</p>
          </div>
        </div>
      </div>
    </div>
  );
};
