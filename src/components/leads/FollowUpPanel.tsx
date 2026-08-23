import React, { useState } from 'react';
import { Calendar, ArrowRight } from 'lucide-react';
import { api } from '../../api/services';
import { ApiError } from '../../api/errors';
import type { Lead } from '../../types';

interface Props {
  lead: Lead;
  onDone: () => void;
  /** Latest date the business allows a follow-up to be scheduled. */
  maxDate: string;
}

/**
 * When the next follow-up is due, and nothing else.
 *
 * This panel used to also carry a "log a completed follow-up" form — a
 * channel picker, an outcome box and a submit button — which duplicated the
 * interaction composer on the right of the same page. Two forms asking the
 * same two questions, writing to the same history, differing only in whether
 * the follow-up advanced. Recording contact now happens in exactly one place;
 * see InteractionComposer.
 */
export const FollowUpPanel: React.FC<Props> = ({ lead, onDone, maxDate }) => {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Read the clock once on mount. Calling Date.now() during render would let
  // the badge change simply because React re-rendered.
  const [today] = useState(() => new Date().toISOString().split('T')[0]);

  const due = (lead.nextFollowUp ?? '').split('T')[0];
  const state = !due ? 'UNSET' : due < today ? 'OVERDUE' : due === today ? 'DUE TODAY' : 'SCHEDULED';

  const badgeClass = {
    OVERDUE: 'bg-red-100 text-red-700 border-red-200',
    'DUE TODAY': 'bg-amber-100 text-amber-700 border-amber-200',
    SCHEDULED: 'bg-green-100 text-green-700 border-green-200',
    UNSET: 'bg-gray-100 text-gray-500 border-gray-200',
  }[state];

  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    try {
      await fn();
      onDone();
    } catch (err) {
      setError(err instanceof ApiError ? err.displayMessage : 'Could not save.');
    } finally {
      setBusy(false);
    }
  };

  const schedule = (date: string) =>
    run(async () => { await api.leads.update(lead.id, { nextFollowUp: date }); });

  const scheduleInDays = (days: number) => {
    const d = new Date();
    d.setDate(d.getDate() + days);
    return schedule(d.toISOString().split('T')[0]);
  };

  return (
    <div className="bg-white border border-[#DFDFDF] rounded-[10px] shadow-sm overflow-hidden">
      <div className="p-5">
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-[10px] font-black text-[#161616] uppercase tracking-widest flex items-center gap-2">
            <Calendar className="w-3.5 h-3.5 text-[#161616]/40" /> Follow-Up
          </h3>
          <span className={`px-2 py-0.5 rounded text-[9px] font-black uppercase tracking-wider border ${badgeClass}`}>
            {state}
          </span>
        </div>

        {error && (
          <p role="alert" className="mb-3 text-[11px] font-bold text-red-600">{error}</p>
        )}

        <div className="p-3 bg-[#F9F9F9] border border-[#DFDFDF] rounded-[6px] flex items-center justify-between gap-3">
          <span className="text-xs font-bold text-[#161616]">
            {due || 'No follow-up date set'}
          </span>
          <input
            type="date"
            min={today}
            max={maxDate}
            value={due}
            disabled={busy}
            onChange={(e) => e.target.value && schedule(e.target.value)}
            className="text-xs border border-[#DFDFDF] rounded px-2 py-1 bg-white font-medium focus:outline-none cursor-pointer disabled:opacity-50"
          />
        </div>

        <div className="mt-3">
          <p className="text-[9px] font-bold text-[#161616]/30 uppercase tracking-widest mb-2">
            Quick presets (max 3 days)
          </p>
          <div className="grid grid-cols-3 gap-2">
            {[1, 2, 3].map((d) => (
              <button
                key={d}
                type="button"
                disabled={busy}
                onClick={() => scheduleInDays(d)}
                className="py-1.5 px-2 bg-white border border-[#DFDFDF] hover:border-[#161616] text-[#161616] rounded text-[10px] font-black uppercase transition-all disabled:opacity-50"
              >
                +{d} {d === 1 ? 'Day' : 'Days'}
              </button>
            ))}
          </div>
        </div>

        <p className="mt-4 pt-3 border-t border-[#DFDFDF]/70 text-[10px] leading-relaxed text-[#161616]/40 flex items-start gap-1.5">
          <ArrowRight className="w-3 h-3 mt-0.5 shrink-0" />
          <span>
            To record that you contacted them, use{' '}
            <span className="font-bold">Log an interaction</span> on the right — it
            closes the follow-up and sets the next date in one step.
          </span>
        </p>
      </div>
    </div>
  );
};
