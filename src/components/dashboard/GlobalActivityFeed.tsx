import React, { useCallback, useEffect, useState } from 'react';
import {
  Clock, ChevronLeft, ChevronRight, Calendar,
  ArrowDownLeft, ArrowUpRight, Microscope, CheckCircle2, Trash2,
} from 'lucide-react';
import { api } from '../../api/services';
import { ApiError } from '../../api/errors';

/**
 * How an action reads on screen.
 *
 * A client replying to us is the most consequential thing that can appear in
 * this feed and the one nobody triggered from inside the CRM, so it gets a
 * colour of its own rather than sitting in the grey run of everything else.
 * Anything unlisted falls back to the raw action name, which is honest about
 * being unstyled rather than mislabelling it.
 */
const ACTION_STYLE: Record<
  string,
  { label: string; icon: React.ComponentType<{ className?: string }>; tone: string; ring: string }
> = {
  EMAIL_RECEIVED: {
    label: 'Reply received', icon: ArrowDownLeft,
    tone: 'text-emerald-700', ring: 'bg-emerald-50 border-emerald-200 text-emerald-600',
  },
  EMAIL_SENT: {
    label: 'Email sent', icon: ArrowUpRight,
    tone: 'text-blue-700', ring: 'bg-blue-50 border-blue-200 text-blue-600',
  },
  RESEARCH_UPDATED: {
    label: 'Research updated', icon: Microscope,
    tone: 'text-[#161616]', ring: 'bg-[#F9F9F9] border-[#DFDFDF] text-[#161616]/40',
  },
  FOLLOWUP_COMPLETED: {
    label: 'Follow-up completed', icon: CheckCircle2,
    tone: 'text-[#161616]', ring: 'bg-[#F9F9F9] border-[#DFDFDF] text-[#161616]/40',
  },
  LEAD_DELETED: {
    label: 'Lead deleted', icon: Trash2,
    tone: 'text-red-700', ring: 'bg-red-50 border-red-200 text-red-500',
  },
};

interface FeedEntry {
  ID: string;
  Action: string;
  UserId: string;
  Details: string;
  Timestamp: string;
  ContactMode?: string;
}

interface Feed {
  date: string;
  timeZone: string;
  timeZoneSource: string;
  count: number;
  total: number;
  truncated: boolean;
  entries: FeedEntry[];
}

interface Props {
  /** userId -> display name, so the feed shows people rather than UUIDs. */
  nameOf: (userId: string) => string;
  /** Managers get the day navigation; everyone else sees today. */
  canBrowseDays: boolean;
}

/**
 * Activity for ONE calendar day, in the viewer's own timezone.
 *
 * It used to render every log the CRM had ever written, newest first, which
 * meant scrolling through months of history to see what happened this
 * morning. A day is the unit people actually think in.
 *
 * Nothing is deleted — older days are still there, one arrow away.
 */
export const GlobalActivityFeed: React.FC<Props> = ({ nameOf, canBrowseDays }) => {
  const [tz] = useState(() => Intl.DateTimeFormat().resolvedOptions().timeZone);
  const [today] = useState(() => {
    const parts = new Intl.DateTimeFormat('en-CA', {
      timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      year: 'numeric', month: '2-digit', day: '2-digit',
    }).format(new Date());
    return parts;
  });

  const [date, setDate] = useState(today);
  const [feed, setFeed] = useState<Feed | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (target: string) => {
    setLoading(true);
    setError(null);
    try {
      setFeed(await api.reports.activityFeed<Feed>({ date: target, timeZone: tz }));
    } catch (err) {
      setError(err instanceof ApiError ? err.displayMessage : 'Could not load activity.');
      setFeed(null);
    } finally {
      setLoading(false);
    }
  }, [tz]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load(date);
  }, [date, load]);

  const shift = (days: number) => {
    const d = new Date(`${date}T12:00:00Z`);
    d.setUTCDate(d.getUTCDate() + days);
    const next = d.toISOString().slice(0, 10);
    if (next > today) return;          // there is no tomorrow to look at
    setDate(next);
  };

  const isToday = date === today;
  const label = isToday
    ? 'Today'
    : new Date(`${date}T12:00:00Z`).toLocaleDateString(undefined, {
        weekday: 'short', day: 'numeric', month: 'short', year: 'numeric',
      });

  return (
    <div className="bg-white border border-[#DFDFDF] rounded-[8px] overflow-hidden shadow-sm">
      <div className="flex justify-between items-center px-6 py-4 border-b border-[#DFDFDF] bg-[#F9F9F9]">
        <div className="flex items-center gap-3">
          {/* The backend scopes this feed by role: a manager sees the whole
              organisation, everyone else sees their own work. The heading says
              which, because "Operational Activity" alone left a rep unsure
              whether an empty day meant nobody was working or just them. */}
          <h3 className="text-[11px] font-black text-[#161616]/40 uppercase tracking-[0.2em]">
            {canBrowseDays ? 'Global Operational Activity' : 'Your Operational Activity'}
          </h3>
          <span className="px-2 py-0.5 rounded-[3px] bg-white border border-[#DFDFDF] text-[10px] font-bold text-[#161616]/60">
            {label}
          </span>
        </div>

        {canBrowseDays ? (
          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={() => shift(-1)}
              title="Previous day"
              className="p-1.5 rounded-[4px] border border-[#DFDFDF] text-[#161616]/50 hover:text-[#161616] hover:border-[#161616]/40 transition-all"
            >
              <ChevronLeft className="w-3.5 h-3.5" />
            </button>
            <input
              type="date"
              value={date}
              max={today}
              onChange={(e) => e.target.value && setDate(e.target.value)}
              className="text-[11px] border border-[#DFDFDF] rounded-[4px] px-2 py-1 bg-white font-medium focus:outline-none"
            />
            <button
              type="button"
              onClick={() => shift(1)}
              disabled={isToday}
              title={isToday ? 'Already on today' : 'Next day'}
              className="p-1.5 rounded-[4px] border border-[#DFDFDF] text-[#161616]/50 hover:text-[#161616] hover:border-[#161616]/40 transition-all disabled:opacity-30"
            >
              <ChevronRight className="w-3.5 h-3.5" />
            </button>
            {!isToday && (
              <button
                type="button"
                onClick={() => setDate(today)}
                className="ml-1 px-2 py-1 rounded-[4px] border border-[#DFDFDF] text-[10px] font-bold uppercase tracking-wider text-[#161616]/50 hover:text-[#161616]"
              >
                Today
              </button>
            )}
          </div>
        ) : (
          <Clock className="w-4 h-4 text-[#161616]/20" />
        )}
      </div>

      <div className="p-0 max-h-[500px] overflow-y-auto">
        {error && (
          <p role="alert" className="p-6 text-xs font-bold text-red-600">{error}</p>
        )}

        {!error && loading && (
          <p className="p-8 text-center text-sm italic text-[#161616]/30">Loading…</p>
        )}

        {!error && !loading && feed && feed.entries.length === 0 && (
          <p className="p-8 text-center text-sm italic text-[#161616]/30">
            {isToday ? 'Nothing logged yet today.' : `No activity on ${label}.`}
          </p>
        )}

        {!error && !loading && feed && feed.entries.map((e) => {
          const style = ACTION_STYLE[e.Action];
          const Icon = style?.icon ?? Clock;
          return (
          <div key={e.ID} className="flex gap-4 px-6 py-4 border-b border-[#DFDFDF] last:border-0 hover:bg-[#F9F9F9] transition-colors">
            <div className={`w-8 h-8 rounded-full border flex items-center justify-center shrink-0 ${
              style?.ring ?? 'bg-[#F9F9F9] border-[#DFDFDF] text-[#161616]/30'
            }`}>
              <Icon className="w-3.5 h-3.5" />
            </div>
            <div className="min-w-0 flex-1">
              <div className="flex items-baseline justify-between gap-3">
                <span className={`text-[10px] font-black uppercase tracking-wider ${style?.tone ?? 'text-[#161616]'}`}>
                  {style?.label ?? e.Action}
                  {e.ContactMode && (
                    <span className="ml-2 text-[9px] font-bold text-[#161616]/40">
                      via {e.ContactMode}
                    </span>
                  )}
                </span>
                <span className="text-[10px] font-mono text-[#161616]/30 shrink-0">
                  {new Date(e.Timestamp).toLocaleTimeString(undefined, {
                    hour: '2-digit', minute: '2-digit',
                  })}
                </span>
              </div>
              <p className="mt-0.5 text-[10px] font-bold text-[#161616]/40">
                @{nameOf(e.UserId)}
              </p>
              <p className="mt-1 text-sm text-[#161616]/70 leading-relaxed break-words">
                {e.Details}
              </p>
            </div>
          </div>
          );
        })}
      </div>

      {feed && (
        <div className="px-6 py-2.5 border-t border-[#DFDFDF] bg-[#F9F9F9] flex items-center justify-between">
          <span className="text-[10px] text-[#161616]/40">
            <Calendar className="inline w-3 h-3 mr-1 -mt-0.5" />
            {feed.total} event{feed.total === 1 ? '' : 's'}
            {feed.truncated && ` — showing the latest ${feed.count}`}
          </span>
          <span className="text-[10px] font-mono text-[#161616]/25">{feed.timeZone}</span>
        </div>
      )}
    </div>
  );
};
