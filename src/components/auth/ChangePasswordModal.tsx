import React, { useState } from 'react';
import { api } from '../../api/services';
import { ApiError } from '../../api/errors';
import { KeyRound, ShieldAlert, Check, X, Eye, EyeOff } from 'lucide-react';

interface Props {
  /**
   * True when the account is flagged MustChangePassword. The dialog cannot
   * then be dismissed without changing, and explains why it appeared.
   */
  required: boolean;
  onDone: () => void;
  onClose?: () => void;
}

/** Mirrors the server-side policy, so the failure is caught before a round trip. */
function policyProblems(pw: string): string[] {
  const problems: string[] = [];
  if (pw.length < 10) problems.push('at least 10 characters');
  if (!/[a-zA-Z]/.test(pw) || !/[0-9]/.test(pw)) problems.push('both letters and digits');
  return problems;
}

/**
 * Change your own password.
 *
 * Shown automatically when the account is flagged, and reachable voluntarily
 * from the top bar. Without this the flag was inert: the migration marked
 * every account whose old password had been readable in the Users sheet, and
 * there was no screen anywhere to act on it.
 *
 * The current password is required even in the forced case. It is what proves
 * the person at the keyboard is the account holder rather than someone who
 * walked up to an unlocked laptop.
 */
export const ChangePasswordModal: React.FC<Props> = ({ required, onDone, onClose }) => {
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const problems = next ? policyProblems(next) : [];
  const mismatch = Boolean(confirm) && next !== confirm;
  const sameAsOld = Boolean(next) && next === current;
  const canSubmit =
    Boolean(current) && Boolean(next) && !problems.length && !mismatch && !sameAsOld && !busy;

  const [done, setDone] = useState(false);

  const submit = async () => {
    if (!canSubmit) return;
    setBusy(true);
    setError(null);
    try {
      await api.auth.changePassword(current, next);
      // Confirm it plainly before closing. The change also ends every OTHER
      // session, which is worth saying out loud — someone signed in elsewhere
      // is about to be logged out and should know why.
      setDone(true);
      setCurrent('');
      setNext('');
      setConfirm('');
    } catch (err) {
      setError(err instanceof ApiError ? err.displayMessage : 'Could not change the password.');
    } finally {
      setBusy(false);
    }
  };

  if (done) {
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-xs">
        <div className="bg-white rounded-[12px] shadow-2xl border border-[#DFDFDF] w-full max-w-md overflow-hidden">
          <div className="px-6 py-4 bg-[#161616] flex items-center gap-3">
            <div className="p-2 bg-emerald-500/20 rounded-[8px]">
              <Check className="w-4 h-4 text-emerald-400" />
            </div>
            <h3 className="text-sm font-bold text-white tracking-tight">Password changed</h3>
          </div>
          <div className="p-6 flex flex-col gap-4">
            <p className="text-sm text-[#161616]/70 leading-relaxed">
              Your new password is active now. You are still signed in here —
              there is nothing else to do.
            </p>
            <p className="text-[11px] text-[#161616]/40 leading-relaxed">
              Anywhere else you were signed in has been logged out, so the old
              password no longer gives access to anything.
            </p>
            <button
              type="button"
              onClick={onDone}
              className="w-full bg-[#161616] text-white py-3 rounded-[6px] text-[11px] font-black uppercase tracking-widest hover:opacity-90 transition-all cursor-pointer"
            >
              Continue
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-xs">
      <div className="bg-white rounded-[12px] shadow-2xl border border-[#DFDFDF] w-full max-w-md overflow-hidden">
        <div className="px-6 py-4 bg-[#161616] flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-white/10 rounded-[8px]">
              <KeyRound className="w-4 h-4 text-white" />
            </div>
            <h3 className="text-sm font-bold text-white tracking-tight">
              {required ? 'Choose a new password' : 'Change your password'}
            </h3>
          </div>
          {!required && onClose && (
            <button
              type="button"
              onClick={onClose}
              className="p-1.5 text-white/50 hover:text-white rounded transition-colors cursor-pointer"
            >
              <X className="w-4 h-4" />
            </button>
          )}
        </div>

        {required && (
          <div className="px-6 py-3 bg-amber-50 border-b border-amber-200 flex items-start gap-2">
            <ShieldAlert className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
            <p className="text-[11px] text-amber-900 leading-relaxed">
              Your previous password was stored in a way other people could read.
              It still works, but please replace it now. You cannot skip this step.
            </p>
          </div>
        )}

        <div className="p-6 flex flex-col gap-4">
          <div>
            <label className="text-[10px] font-bold text-[#161616]/40 uppercase tracking-widest block mb-1.5">
              Current password
            </label>
            <input
              type={show ? 'text' : 'password'}
              value={current}
              autoComplete="current-password"
              onChange={(e) => setCurrent(e.target.value)}
              className="w-full px-3 py-2 border border-[#DFDFDF] rounded-[6px] text-sm focus:outline-none focus:border-[#161616]/50"
            />
          </div>

          <div>
            <div className="flex items-center justify-between mb-1.5">
              <label className="text-[10px] font-bold text-[#161616]/40 uppercase tracking-widest">
                New password
              </label>
              <button
                type="button"
                onClick={() => setShow((v) => !v)}
                className="flex items-center gap-1 text-[10px] font-bold text-[#161616]/40 hover:text-[#161616] cursor-pointer"
              >
                {show ? <EyeOff className="w-3 h-3" /> : <Eye className="w-3 h-3" />}
                {show ? 'Hide' : 'Show'}
              </button>
            </div>
            <input
              type={show ? 'text' : 'password'}
              value={next}
              autoComplete="new-password"
              onChange={(e) => setNext(e.target.value)}
              className="w-full px-3 py-2 border border-[#DFDFDF] rounded-[6px] text-sm focus:outline-none focus:border-[#161616]/50"
            />
            <p className="mt-1.5 text-[10px] text-[#161616]/40">
              Must be {problems.length && next
                ? <span className="text-red-600 font-semibold">{problems.join(' and ')}</span>
                : 'at least 10 characters, with both letters and digits'}.
            </p>
          </div>

          <div>
            <label className="text-[10px] font-bold text-[#161616]/40 uppercase tracking-widest block mb-1.5">
              Confirm new password
            </label>
            <input
              type={show ? 'text' : 'password'}
              value={confirm}
              autoComplete="new-password"
              onChange={(e) => setConfirm(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') submit(); }}
              className={`w-full px-3 py-2 border rounded-[6px] text-sm focus:outline-none ${
                mismatch ? 'border-red-400 focus:border-red-500' : 'border-[#DFDFDF] focus:border-[#161616]/50'
              }`}
            />
            {mismatch && (
              <p className="mt-1.5 text-[10px] font-semibold text-red-600">
                The two entries do not match.
              </p>
            )}
            {sameAsOld && (
              <p className="mt-1.5 text-[10px] font-semibold text-red-600">
                The new password must be different from the current one.
              </p>
            )}
          </div>

          {error && (
            <p role="alert" className="px-3 py-2 bg-red-50 border border-red-200 rounded-[6px] text-[11px] font-semibold text-red-700">
              {error}
            </p>
          )}

          <button
            type="button"
            onClick={submit}
            disabled={!canSubmit}
            className="w-full flex items-center justify-center gap-2 bg-[#161616] text-white py-3 rounded-[6px] text-[11px] font-black uppercase tracking-widest hover:opacity-90 disabled:opacity-30 transition-all cursor-pointer"
          >
            <Check className="w-4 h-4" />
            {busy ? 'Saving…' : 'Update password'}
          </button>

          {required && (
            <p className="text-[10px] text-center text-[#161616]/35 leading-relaxed">
              Signing out without changing it leaves the old password in use.
            </p>
          )}
        </div>
      </div>
    </div>
  );
};
