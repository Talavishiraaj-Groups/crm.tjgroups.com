import React, { useState } from 'react';
import { Clock, X } from 'lucide-react';

interface Props {
  /** The server's explanation of what is owed and why. */
  message: string;
  /** Shown when saving the reason itself failed. */
  error?: string;
  busy?: boolean;
  onCancel: () => void;
  onSubmit: (reason: string) => void;
}

/** The server refuses anything shorter; matching it here avoids a round trip. */
const MIN_REASON = 5;

/**
 * Ask why a follow-up was left to go stale.
 *
 * Raised only when the server refuses to move a follow-up date that has been
 * overdue for more than a day. Moving the date is the one edit that makes a
 * missed follow-up stop looking missed, so it costs one sentence — and that
 * sentence is attributed and timestamped server-side, then filed under its own
 * FOLLOWUP_DELAYED action so a manager can read back every slip.
 *
 * There is deliberately no "save anyway": the prompt exists because the write
 * was already rejected, and offering to skip it would just produce a request
 * that fails again.
 *
 * Both places that can reschedule — the follow-up panel and the overdue banner
 * on the lead page — render this same component. They previously would have
 * needed the identical modal twice.
 */
export const FollowUpDelayPrompt: React.FC<Props> = ({
  message, error, busy = false, onCancel, onSubmit,
}) => {
  const [reason, setReason] = useState('');
  const tooShort = reason.trim().length < MIN_REASON;

  return (
    <div className="fixed inset-0 bg-[#161616]/40 backdrop-blur-[2px] flex items-center justify-center z-[9999] p-4">
      <div className="bg-white rounded-[6px] border border-[#DFDFDF] w-full max-w-[460px] shadow-2xl overflow-hidden">
        <div className="px-6 py-4 border-b border-[#DFDFDF] flex justify-between items-center bg-[#F9F9F9]">
          <h3 className="text-sm font-bold text-[#161616] uppercase tracking-widest flex items-center gap-2">
            <Clock className="w-4 h-4" /> Why was this missed?
          </h3>
          <button
            type="button"
            onClick={onCancel}
            aria-label="Cancel"
            className="text-[#161616]/30 hover:text-[#161616]"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (tooShort || busy) return;
            onSubmit(reason.trim());
          }}
          className="p-6 flex flex-col gap-4"
        >
          {error && (
            <div role="alert" className="bg-red-50 text-red-700 px-3 py-2 rounded-[4px] text-xs border border-red-100 font-bold">
              {error}
            </div>
          )}

          <p className="text-xs text-[#161616]/60 leading-relaxed">{message}</p>

          <label className="flex flex-col gap-1.5">
            <span className="text-[10px] font-bold uppercase tracking-widest text-[#161616]/40">
              Reason
            </span>
            <textarea
              autoFocus
              rows={3}
              value={reason}
              disabled={busy}
              onChange={(e) => setReason(e.target.value)}
              placeholder="e.g. Client asked us to hold until their board meets."
              className="w-full border border-[#DFDFDF] rounded-[4px] px-3 py-2 text-xs focus:outline-none focus:border-[#161616] resize-none disabled:opacity-50"
            />
          </label>

          <div className="flex justify-end gap-2">
            <button
              type="button"
              onClick={onCancel}
              className="px-4 py-2 text-[11px] font-bold uppercase tracking-widest text-[#161616]/50 hover:text-[#161616]"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={tooShort || busy}
              className="px-4 py-2 bg-[#161616] text-white rounded-[4px] text-[11px] font-bold uppercase tracking-widest disabled:opacity-30"
            >
              {busy ? 'Saving…' : 'Save reason & move date'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
