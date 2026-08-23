import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import logo from '../assets/tjgroups-logo-dark.png';
import { ApiError } from '../api/errors';

/**
 * Credentials are verified by the SERVER.
 *
 * What this screen used to do, and no longer does:
 *   - download every user record (including any secrets) before login
 *   - compare the password in the browser
 *   - fall back to hard-coded demo users when the backend was unreachable,
 *     which handed out an ADMIN session to anyone who could break the API call
 *
 * It now posts a username and password and receives a session token, or an
 * error explaining precisely what went wrong.
 */
export const LoginPage: React.FC = () => {
  const { login, restoreError } = useAuth();
  const navigate = useNavigate();

  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<{ text: string; hint?: string } | null>(null);
  const [submitting, setSubmitting] = useState(false);

  /**
   * If we landed here because session restoration FAILED rather than because
   * the user signed out, say so. Otherwise a backend outage is indistinguishable
   * from "your session ended" — the same class of bug as an outage rendering as
   * an empty list.
   */
  const shown = error ?? (restoreError ? describe(restoreError) : null);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSubmitting(true);

    try {
      await login(username.trim(), password);
      navigate('/', { replace: true });
    } catch (err) {
      setError(describe(err));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen bg-[#F9F9F9] flex items-center justify-center p-4">
      <div className="w-full max-w-[420px] bg-white rounded-[6px] shadow-lg p-10 border border-[rgba(22,22,22,0.1)]">
        <div className="flex flex-col items-center mb-8">
          <img src={logo} alt="TJGROUPS" className="h-12 w-auto mb-4" />
          <h1 className="text-2xl font-bold text-[#161616] tracking-tight">TJGROUPS CRM</h1>
          <p className="text-sm text-[#161616]/50 mt-1 text-center">
            Enter your credentials to access the workspace
          </p>
        </div>

        <form onSubmit={handleLogin} className="flex flex-col gap-4">
          {shown && (
            <div
              role="alert"
              className="bg-red-50 text-red-700 px-4 py-3 rounded-[4px] text-xs border border-red-100"
            >
              <div className="font-bold">{shown.text}</div>
              {shown.hint && <div className="mt-1 font-medium text-red-600/80">{shown.hint}</div>}
            </div>
          )}

          <div className="flex flex-col gap-1.5">
            <label
              htmlFor="username"
              className="text-[10px] font-bold text-[#161616]/50 uppercase tracking-widest"
            >
              Username
            </label>
            <input
              id="username"
              name="username"
              type="text"
              autoComplete="username"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              required
              disabled={submitting}
              className="w-full px-4 py-3 border border-[#DFDFDF] rounded-[6px] text-sm focus:outline-none focus:border-[#161616]/50 text-[#161616] transition-colors disabled:opacity-60"
              placeholder="e.g. team_lead"
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <label
              htmlFor="password"
              className="text-[10px] font-bold text-[#161616]/50 uppercase tracking-widest"
            >
              Password
            </label>
            <input
              id="password"
              name="password"
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              disabled={submitting}
              className="w-full px-4 py-3 border border-[#DFDFDF] rounded-[6px] text-sm focus:outline-none focus:border-[#161616]/50 text-[#161616] transition-colors disabled:opacity-60"
              placeholder="••••••••"
            />
          </div>

          <button
            type="submit"
            disabled={submitting}
            className="w-full py-4 mt-2 rounded-[6px] font-bold transition-all bg-[#161616] text-white hover:opacity-90 text-sm tracking-wide disabled:opacity-50"
          >
            {submitting ? 'SIGNING IN…' : 'SECURE LOGIN'}
          </button>
        </form>

        <div className="mt-8 pt-4 border-t border-[#DFDFDF] text-center">
          <div className="text-[10px] text-[#161616]/30 font-medium leading-relaxed">
            <p>
              © 2026{' '}
              <a
                href="https://www.talavishiraajgroups.com/"
                target="_blank"
                rel="noopener noreferrer"
                className="hover:text-[#161616] transition-colors"
              >
                Talavishiraaj Groups
              </a>
              . All rights reserved.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
};

/**
 * Turn a failure into something the user can act on. An outage and a wrong
 * password are different problems and must read differently.
 */
function describe(err: unknown): { text: string; hint?: string } {
  if (!(err instanceof ApiError)) {
    return { text: 'Sign-in failed.', hint: 'Please try again.' };
  }

  switch (err.code) {
    case 'INVALID_CREDENTIALS':
      return { text: 'Incorrect username or password.' };
    case 'ACCOUNT_INACTIVE':
      return {
        text: 'This account is not active.',
        hint: 'Ask an administrator to reactivate it.',
      };
    case 'ACCOUNT_LOCKED':
      return {
        text: 'Too many failed attempts.',
        hint: 'The account is temporarily locked. Try again in a few minutes.',
      };
    case 'PASSWORD_NOT_SET':
      return {
        text: 'No password is set for this account.',
        hint: 'An administrator must set one before you can sign in.',
      };
    case 'NOT_CONFIGURED':
      return {
        text: 'The CRM is not configured.',
        hint: 'VITE_API_URL is missing from the deployment environment.',
      };
    case 'NETWORK':
    case 'STORAGE_ERROR':
    case 'MALFORMED_RESPONSE':
      return {
        text: 'Cannot reach the CRM backend.',
        hint: 'This is a connection problem, not a wrong password. Please retry shortly.',
      };
    default:
      return { text: err.displayMessage };
  }
}
