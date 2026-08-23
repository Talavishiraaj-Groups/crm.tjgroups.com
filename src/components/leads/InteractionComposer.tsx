import React, { useState } from 'react';
import { api } from '../../api/services';
import { ApiError } from '../../api/errors';
import type { Lead } from '../../types';
import {
  Phone, MessageCircle, Mail, MoreHorizontal, Send, CheckCircle2, AlertTriangle,
} from 'lucide-react';

interface Props {
  lead: Lead;
  /** Latest date the business allows a follow-up to be scheduled. */
  maxDate: string;
  onDone: () => void;
}

const MODES = [
  { id: 'CALL', label: 'Call', icon: Phone },
  { id: 'WHATSAPP', label: 'WhatsApp', icon: MessageCircle },
  { id: 'EMAIL', label: 'Email', icon: Mail },
  { id: 'OTHER', label: 'Other', icon: MoreHorizontal },
] as const;

/**
 * The single place a human records that they spoke to a lead.
 *
 * There used to be two: a "Log New Interaction" box on the right and a
 * separate "Log a completed follow-up" panel on the left, both asking for a
 * channel and a note, both writing to the same history. Which one you used
 * changed whether the follow-up advanced, which is not a distinction anyone
 * could see from the screen. They are one action.
 *
 * Whether this also closes the follow-up is now an explicit switch, defaulted
 * on when a follow-up is actually due — recording contact and leaving the
 * follow-up showing as overdue was the more common mistake.
 *
 * Email sent through the CRM does not need logging here at all: sending
 * already records an EMAIL contact server-side. The hint says so, because
 * people were logging it twice.
 */
export const InteractionComposer: React.FC<Props> = ({ lead, maxDate, onDone }) => {
  const [mode, setMode] = useState<string>('CALL');
  const [note, setNote] = useState('');
  const [nextDate, setNextDate] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [justSaved, setJustSaved] = useState(false);

  // Read the clock once on mount rather than during render, so the panel
  // cannot change state simply because React re-rendered.
  const [today] = useState(() => new Date().toISOString().split('T')[0]);

  const due = (lead.nextFollowUp ?? '').split('T')[0];
  const followUpOutstanding =
    Boolean(due) && due <= today && lead.followUpStatus !== 'Completed';

  const [completesFollowUp, setCompletesFollowUp] = useState(followUpOutstanding);

  const submit = async () => {
    if (!note.trim()) { setError('Say what happened before saving.'); return; }
    setBusy(true);
    setError(null);
    try {
      if (completesFollowUp) {
        // One transaction: records the contact, closes the follow-up, and
        // schedules the next one if a date was given.
        await api.leads.completeFollowUp(lead.id, {
          contactMode: mode,
          outcome: note.trim(),
          nextFollowUp: nextDate.trim() || undefined,
        });
      } else {
        await api.logs.create({
          entityId: lead.id,
          entityType: 'Lead',
          action: mode,
          details: note.trim(),
          contactMode: mode,
        });
        if (nextDate.trim()) {
          await api.leads.update(lead.id, { nextFollowUp: nextDate.trim() });
        }
      }
      setNote('');
      setNextDate('');
      setJustSaved(true);
      window.setTimeout(() => setJustSaved(false), 3000);
      onDone();
    } catch (err) {
      setError(err instanceof ApiError ? err.displayMessage : 'Could not save.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="bg-[#161616] rounded-[6px] p-6 shadow-xl">
      <div className="flex flex-wrap items-center justify-between gap-2 mb-5">
        <h3 className="text-[10px] font-black text-white/30 uppercase tracking-widest">
          Log an interaction
        </h3>
        {followUpOutstanding && (
          <span className="px-2 py-0.5 rounded text-[9px] font-black uppercase tracking-wider bg-amber-500/15 text-amber-300 border border-amber-500/30">
            Follow-up {due < today ? 'overdue' : 'due today'}
          </span>
        )}
      </div>

      <label className="text-[10px] font-bold text-white/30 uppercase tracking-widest block mb-2">
        How did you reach them?
      </label>
      <div className="grid grid-cols-4 gap-2 mb-5">
        {MODES.map(({ id, label, icon: Icon }) => (
          <button
            key={id}
            type="button"
            onClick={() => setMode(id)}
            className={`flex items-center justify-center gap-2 py-2.5 rounded-[6px] text-[11px] font-black uppercase tracking-widest transition-all cursor-pointer ${
              mode === id
                ? 'bg-white text-[#161616]'
                : 'border border-white/10 text-white/40 hover:border-white/30 hover:text-white'
            }`}
          >
            <Icon className="w-3.5 h-3.5" />{label}
          </button>
        ))}
      </div>

      {mode === 'EMAIL' && (
        <p className="mb-4 text-[10px] leading-relaxed text-white/40 bg-white/5 border border-white/10 rounded-[6px] px-3 py-2">
          Only for email you sent from somewhere else. Anything sent from the
          Zoho Emails tab is recorded automatically — logging it here as well
          counts the same conversation twice.
        </p>
      )}

      <textarea
        value={note}
        onChange={(e) => setNote(e.target.value)}
        placeholder={`What came out of the ${mode === 'OTHER' ? 'conversation' : mode.toLowerCase()}?`}
        className="w-full min-h-[120px] px-5 py-4 bg-white/5 border border-white/10 rounded-[8px] text-sm focus:outline-none focus:border-white/30 resize-y text-white placeholder:text-white/20 mb-4"
      />

      <div className="flex flex-wrap items-center gap-x-6 gap-y-3 mb-5">
        <label className="flex items-center gap-2.5 cursor-pointer select-none">
          <input
            type="checkbox"
            checked={completesFollowUp}
            onChange={(e) => setCompletesFollowUp(e.target.checked)}
            className="w-4 h-4 accent-white cursor-pointer"
          />
          <span className="text-[11px] font-bold text-white/70">
            This completes the follow-up
          </span>
        </label>

        <div className="flex items-center gap-2">
          <span className="text-[10px] font-bold text-white/30 uppercase tracking-widest">
            Next follow-up
          </span>
          <input
            type="date"
            min={today}
            max={maxDate}
            value={nextDate}
            onChange={(e) => setNextDate(e.target.value)}
            className="bg-white/5 border border-white/10 rounded-[6px] px-3 py-1.5 text-xs text-white focus:outline-none focus:border-white/30 cursor-pointer"
          />
        </div>
      </div>

      {error && (
        <div className="mb-4 flex items-start gap-2 px-4 py-3 bg-red-500/10 border border-red-500/30 rounded-[6px]">
          <AlertTriangle className="w-3.5 h-3.5 text-red-400 shrink-0 mt-0.5" />
          <span role="alert" className="text-[11px] text-red-300 leading-relaxed">{error}</span>
        </div>
      )}

      <div className="flex items-center justify-between gap-3">
        <span className="text-[10px] text-white/25 leading-relaxed max-w-[320px]">
          Recorded against you with a timestamp. Saving twice logs one
          interaction, not two.
        </span>
        <button
          type="button"
          onClick={submit}
          disabled={!note.trim() || busy}
          className="flex items-center gap-2 bg-white text-[#161616] px-6 py-3 rounded-[6px] text-[11px] font-black hover:opacity-90 transition-all disabled:opacity-20 uppercase tracking-widest cursor-pointer shrink-0"
        >
          {justSaved ? <CheckCircle2 className="w-4 h-4" /> : <Send className="w-4 h-4" />}
          {busy ? 'Saving…' : justSaved ? 'Logged' : completesFollowUp ? 'Log & complete' : 'Commit log'}
        </button>
      </div>
    </div>
  );
};
