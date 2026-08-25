import React, { useCallback, useEffect, useState } from 'react';
import { Info, AlertTriangle } from 'lucide-react';
import { api } from '../api/services';
import { ApiError } from '../api/errors';
import { useAuth } from '../context/AuthContext';
import { EmailAnalyticsPanel } from '../components/insights/EmailAnalyticsPanel';

/**
 * Productivity and organisation analytics.
 *
 * Two rules this page follows, because the numbers are used to judge people:
 *
 *  1. Nothing is shown that the data cannot support. Where a metric only
 *     started being collected at migration, the page says so and gives the
 *     date, rather than presenting a partial count as a whole history.
 *
 *  2. Every figure is a count of stored events. Nothing is inferred from what
 *     the UI happens to render, and retried requests do not inflate a total,
 *     because the underlying operations are idempotent.
 */
/**
 * Report shapes, mirroring what getProductivity / getAnalytics return.
 *
 * Deliberately narrow: only the fields this page actually renders. The
 * backend sends more, and a wider type here would suggest a contract that is
 * not enforced anywhere.
 */
interface PersonStats {
  userId: string;
  username: string;
  role: string;
  status: string;
  leadsCreated: number;
  followUpsCompleted: number;
  contactEvents: number;
  dealsWon: number;
  conversions: number;
  emailsSent: number;
  openLeads: number;
}

interface ProductivityReport {
  timeZone: string;
  timeZoneSource: 'viewer' | 'organisation default';
  contactModeTrackingSince: string | null;
  users: PersonStats[];
}

interface ContactModeSummary {
  trackingSince: string | null;
  trackedEvents: number;
  byMode: Record<string, number>;
  eventsWithoutMode: number;
  activityPredatingTracking: number;
  complete: boolean;
  note: string;
}

interface AnalyticsReport {
  contactMode: ContactModeSummary;
  email: { sent: number; source: string; trackedFrom: string | null };
  pipeline: {
    leadsByStatus: Record<string, number>;
    followUpByState: Record<string, number>;
    dealsByStatus: Record<string, number>;
    wonValue: number;
    openValue: number;
    winRate: number | null;
    winRateNote: string | null;
  };
}

export const InsightsPage: React.FC = () => {
  const { role } = useAuth();
  const isSuperAdmin = role === 'SUPER_ADMIN';

  const [days, setDays] = useState(30);
  const [productivity, setProductivity] = useState<ProductivityReport | null>(null);
  const [analytics, setAnalytics] = useState<AnalyticsReport | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      // Send the browser's zone so "today" matches the viewer's calendar day,
      // wherever in the world they are.
      const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;

      // One round trip, not two. These were sequential awaits, so a Super
      // Admin paid the full Apps Script latency twice over — and that latency
      // is ~2.5s per call on the free tier however little work the request
      // does. Neither report depends on the other, so there was never a reason
      // to wait for the first before asking for the second.
      const [prod, analytics] = await Promise.all([
        api.reports.productivity<ProductivityReport>(days, tz),
        isSuperAdmin ? api.reports.analytics<AnalyticsReport>(days) : Promise.resolve(null),
      ]);

      setProductivity(prod);
      if (analytics) setAnalytics(analytics);
    } catch (err) {
      setError(err instanceof ApiError ? err.displayMessage : 'Could not load reports.');
    } finally {
      setLoading(false);
    }
  }, [days, isSuperAdmin]);

  // See TeamManagementPanel: fetching remote data on mount is synchronising
  // with an external system, which is what an effect is for.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load();
  }, [load]);

  const users = productivity?.users ?? [];

  return (
    <div className="flex flex-col gap-6">
      <div className="flex justify-between items-center">
        <div>
          <h2 className="text-xl font-bold text-[#161616] tracking-tight">Insights</h2>
          <p className="text-sm text-[#161616]/40 font-medium mt-0.5">
            Activity and performance, counted from recorded events.
          </p>
        </div>
        <div className="flex bg-[#F9F9F9] border border-[#DFDFDF] p-0.5 rounded-[6px]">
          {[7, 30, 90].map((d) => (
            <button
              key={d}
              type="button"
              onClick={() => setDays(d)}
              className={`px-3 py-1.5 rounded-[4px] text-[10px] font-bold uppercase tracking-wider transition-all ${
                days === d ? 'bg-white shadow-sm text-[#161616]' : 'text-[#161616]/40 hover:text-[#161616]/60'
              }`}
            >
              {d} days
            </button>
          ))}
        </div>
      </div>

      {error && (
        <div role="alert" className="rounded-[6px] border border-red-200 bg-red-50 px-4 py-3 text-xs font-bold text-red-700">
          {error}
        </div>
      )}

      {loading ? (
        <div className="bg-white border border-[#DFDFDF] rounded-[6px] p-12 text-center text-[#161616]/30 italic text-sm">
          Loading insights…
        </div>
      ) : (
        <>
          {productivity?.timeZone && (
            <p className="flex items-center gap-1.5 text-[10px] text-[#161616]/40">
              <Info className="w-3 h-3" />
              Days are counted in <span className="font-mono">{productivity.timeZone}</span>
              {productivity.timeZoneSource === 'viewer' ? ' (your timezone)' : ' (organisation default)'}
            </p>
          )}

          {/* ---------- Email ----------
              Everyone sees this. The backend scopes it: a rep gets their own
              figures, a manager their team's, a Super Admin the organisation's.
              The unmatched-mail list is the part that only makes sense for
              someone with oversight of more than one mailbox. */}
          <EmailAnalyticsPanel
            days={days}
            canSeeUnmatched={role === 'SUPER_ADMIN' || role === 'ADMIN'}
          />

          {/* ---------- Productivity ---------- */}
          <div className="bg-white border border-[#DFDFDF] rounded-[10px] overflow-hidden shadow-sm">
            <div className="px-5 py-3 border-b border-[#DFDFDF] bg-[#F9F9F9]">
              <h3 className="text-[10px] font-bold text-[#161616]/40 uppercase tracking-widest">
                Team Productivity
              </h3>
            </div>

            {users.length === 0 ? (
              <p className="p-8 text-center text-sm italic text-[#161616]/30">
                No activity recorded in this window.
              </p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full border-collapse">
                  <thead>
                    <tr className="border-b border-[#DFDFDF] bg-[#F9F9F9]">
                      {['Person', 'Role', 'Leads made', 'Follow-ups', 'Contacts', 'Deals won', 'Conversions', 'Emails', 'Open leads']
                        .map((h) => (
                          <th key={h} className="text-left px-4 py-2.5 text-[9px] font-bold text-[#161616]/30 uppercase tracking-widest whitespace-nowrap">
                            {h}
                          </th>
                        ))}
                    </tr>
                  </thead>
                  <tbody>
                    {users.map((u) => (
                      <tr key={u.userId} className="border-b border-[#DFDFDF] last:border-0 hover:bg-[#F9F9F9]">
                        <td className="px-4 py-3 text-sm font-semibold text-[#161616] whitespace-nowrap">
                          @{u.username}
                          {u.status !== 'Active' && (
                            <span className="ml-2 text-[9px] font-bold uppercase text-[#161616]/30">inactive</span>
                          )}
                        </td>
                        <td className="px-4 py-3 text-[10px] font-bold uppercase tracking-wider text-[#161616]/40">{u.role}</td>
                        <td className="px-4 py-3 text-sm tabular-nums text-[#161616]">{u.leadsCreated}</td>
                        <td className="px-4 py-3 text-sm tabular-nums text-[#161616]">{u.followUpsCompleted}</td>
                        <td className="px-4 py-3 text-sm tabular-nums text-[#161616]">{u.contactEvents}</td>
                        <td className="px-4 py-3 text-sm tabular-nums font-bold text-[#161616]">{u.dealsWon}</td>
                        <td className="px-4 py-3 text-sm tabular-nums text-[#161616]">{u.conversions}</td>
                        <td className="px-4 py-3 text-sm tabular-nums text-[#161616]">{u.emailsSent}</td>
                        <td className="px-4 py-3 text-sm tabular-nums text-[#161616]/60">{u.openLeads}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          {/* ---------- Organisation analytics ---------- */}
          {isSuperAdmin && analytics && (
            <>
              <ContactModeCard contactMode={analytics.contactMode} email={analytics.email} />

              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <Breakdown title="Leads by status" data={analytics.pipeline.leadsByStatus} />
                <Breakdown title="Follow-up state" data={analytics.pipeline.followUpByState} />
                <Breakdown title="Deals by status" data={analytics.pipeline.dealsByStatus} />
              </div>

              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <Figure
                  label="Won value"
                  value={`$${Number(analytics.pipeline.wonValue || 0).toLocaleString()}`}
                />
                <Figure
                  label="Open pipeline"
                  value={`$${Number(analytics.pipeline.openValue || 0).toLocaleString()}`}
                />
                <Figure
                  label="Win rate"
                  value={analytics.pipeline.winRate === null ? '—' : `${analytics.pipeline.winRate}%`}
                  note={analytics.pipeline.winRateNote}
                />
              </div>
            </>
          )}
        </>
      )}
    </div>
  );
};

/**
 * Contact-mode coverage.
 *
 * This card exists mainly to be honest about its own limits: activity that
 * predates structured tracking is reported separately rather than folded into
 * the totals or quietly dropped.
 */
const ContactModeCard: React.FC<{
  contactMode: ContactModeSummary;
  email: AnalyticsReport['email'];
}> = ({ contactMode, email }) => {
  const modes = Object.entries(contactMode?.byMode ?? {}) as Array<[string, number]>;
  const tracked = Number(contactMode?.trackedEvents || 0);

  return (
    <div className="bg-white border border-[#DFDFDF] rounded-[10px] p-5 shadow-sm">
      <h3 className="text-[10px] font-bold text-[#161616]/40 uppercase tracking-widest mb-3">
        Contact channels
      </h3>

      {contactMode?.trackingSince ? (
        <p className="flex items-start gap-1.5 mb-4 text-[10px] leading-relaxed text-[#161616]/50">
          <Info className="mt-0.5 w-3 h-3 shrink-0" />
          <span>
            Available from{' '}
            <span className="font-mono">{String(contactMode.trackingSince).slice(0, 10)}</span>,
            when structured tracking began.
            {Number(contactMode.eventsWithoutMode) > 0 && (
              <> {contactMode.eventsWithoutMode} recorded events carry no channel
              and are not counted here
              {Number(contactMode.activityPredatingTracking) > 0 &&
                ` (${contactMode.activityPredatingTracking} of them predate tracking)`}.</>
            )}
          </span>
        </p>
      ) : (
        <p className="flex items-start gap-1.5 mb-4 text-[10px] text-amber-700">
          <AlertTriangle className="mt-0.5 w-3 h-3 shrink-0" />
          Tracking has not started yet — run the database migration.
        </p>
      )}

      {tracked === 0 ? (
        <p className="text-sm italic text-[#161616]/30">
          No contacts logged with a channel yet.
        </p>
      ) : (
        <div className="space-y-2">
          {modes.map(([name, count]) => (
            <div key={name}>
              <div className="flex justify-between text-[10px] font-bold uppercase tracking-wider mb-1">
                <span className="text-[#161616]/60">{name}</span>
                <span className="text-[#161616] tabular-nums">{count}</span>
              </div>
              <div className="h-1.5 rounded-full bg-[#F0F0F0] overflow-hidden">
                <div
                  className="h-full bg-[#161616]"
                  style={{ width: `${Math.round((count / tracked) * 100)}%` }}
                />
              </div>
            </div>
          ))}
        </div>
      )}

      <div className="mt-4 pt-3 border-t border-[#DFDFDF]">
        <div className="flex justify-between items-baseline">
          <span className="text-[10px] font-bold uppercase tracking-widest text-[#161616]/40">
            Emails sent
          </span>
          <span className="text-lg font-bold tabular-nums text-[#161616]">
            {Number(email?.sent || 0)}
          </span>
        </div>
        <p className="mt-1 text-[10px] leading-relaxed text-[#161616]/40">
          Counted when the backend actually handed a message to Zoho — not from
          clicks in the interface.
        </p>
      </div>
    </div>
  );
};

const Breakdown: React.FC<{ title: string; data: Record<string, number> }> = ({ title, data }) => {
  const rows = Object.entries(data ?? {});
  return (
    <div className="bg-white border border-[#DFDFDF] rounded-[10px] p-5 shadow-sm">
      <h3 className="text-[10px] font-bold text-[#161616]/40 uppercase tracking-widest mb-3">{title}</h3>
      {rows.length === 0 ? (
        <p className="text-sm italic text-[#161616]/30">Nothing recorded.</p>
      ) : (
        <ul className="space-y-1.5">
          {rows.map(([k, v]) => (
            <li key={k} className="flex justify-between text-sm">
              <span className="text-[#161616]/60">{k}</span>
              <span className="font-bold tabular-nums text-[#161616]">{v}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
};

const Figure: React.FC<{ label: string; value: string; note?: string | null }> = ({ label, value, note }) => (
  <div className="bg-white border border-[#DFDFDF] rounded-[10px] p-5 shadow-sm">
    <div className="text-[10px] font-bold text-[#161616]/30 uppercase tracking-widest">{label}</div>
    <div className="mt-1 text-2xl font-bold tabular-nums text-[#161616]">{value}</div>
    {note && <p className="mt-1 text-[10px] text-[#161616]/40">{note}</p>}
  </div>
);
