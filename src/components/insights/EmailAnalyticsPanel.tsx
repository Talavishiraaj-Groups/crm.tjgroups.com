import React, { useCallback, useEffect, useState } from 'react';
import { api } from '../../api/services';
import { ApiError } from '../../api/errors';
import type { EmailAnalytics, UnmatchedEmails } from '../../types';
import {
  Mail, ArrowUpRight, ArrowDownLeft, RefreshCw, Info, MailQuestion,
  ChevronDown, ChevronUp, Loader2,
} from 'lucide-react';

interface Props {
  days: number;
  /** Managers get the unmatched-mail list; everyone gets their own figures. */
  canSeeUnmatched: boolean;
}

const SCOPE_LABEL: Record<string, string> = {
  organisation: 'Everyone in the organisation',
  team: 'You and your team',
  self: 'Your own mailbox',
};

/**
 * Email activity, for whoever is looking.
 *
 * A rep sees their own numbers, a manager their team's, a Super Admin the
 * whole organisation — the backend decides the scope from the session, and
 * this panel just reports which scope it got. That is printed on the page
 * rather than assumed, because "3 emails" means something very different
 * depending on whose it is.
 *
 * The coverage note is not decoration. These are counts of what the CRM has
 * synced, and a mailbox nobody has connected contributes nothing. Presenting
 * that as an organisation total without the caveat would be a lie.
 */
export const EmailAnalyticsPanel: React.FC<Props> = ({ days, canSeeUnmatched }) => {
  const [data, setData] = useState<EmailAnalytics | null>(null);
  const [unmatched, setUnmatched] = useState<UnmatchedEmails | null>(null);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [showUnmatched, setShowUnmatched] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const stats = await api.zoho.getEmailAnalytics(days);
      setData(stats);
      if (canSeeUnmatched) {
        setUnmatched(await api.zoho.getUnmatchedEmails());
      }
    } catch (err) {
      setError(err instanceof ApiError ? err.displayMessage : 'Could not load email analytics.');
    } finally {
      setLoading(false);
    }
  }, [days, canSeeUnmatched]);

  useEffect(() => {
    // Reading remote data on mount: state lands after the request resolves.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load();
  }, [load]);

  const sync = async () => {
    setSyncing(true);
    setError(null);
    setNotice(null);
    try {
      const res = await api.zoho.syncMailbox();
      setNotice(
        res.stored === 0
          ? `Nothing new — ${res.scanned} recent messages checked in ${res.mailbox}.`
          : `${res.stored} new message${res.stored === 1 ? '' : 's'} recorded: ` +
            `${res.matchedToLead} matched to a lead, ${res.withoutLead} with no matching lead.`
      );
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.displayMessage : 'Could not sync the mailbox.');
    } finally {
      setSyncing(false);
    }
  };

  const stat = (label: string, value: React.ReactNode, hint?: string) => (
    <div className="px-4 py-3 bg-[#F9F9F9] border border-[#DFDFDF] rounded-[6px]">
      <p className="text-[9px] font-bold text-[#161616]/30 uppercase tracking-widest mb-1">{label}</p>
      <p className="text-xl font-bold text-[#161616] tabular-nums leading-none">{value}</p>
      {hint && <p className="mt-1.5 text-[10px] text-[#161616]/35 leading-snug">{hint}</p>}
    </div>
  );

  return (
    <div className="bg-white border border-[#DFDFDF] rounded-[10px] overflow-hidden shadow-sm">
      <div className="px-5 py-3 border-b border-[#DFDFDF] bg-[#F9F9F9] flex flex-wrap items-center justify-between gap-3">
        <h3 className="text-[10px] font-bold text-[#161616]/40 uppercase tracking-widest flex items-center gap-2">
          <Mail className="w-3.5 h-3.5" /> Email Activity
          {data && (
            <span className="ml-1 px-2 py-0.5 rounded bg-[#161616]/5 text-[#161616]/50 normal-case tracking-normal font-semibold">
              {SCOPE_LABEL[data.scope] || data.scope}
            </span>
          )}
        </h3>

        <button
          type="button"
          onClick={sync}
          disabled={syncing}
          title="Read recent messages from your own mailbox and record them here"
          className="flex items-center gap-1.5 px-3 py-1.5 bg-white border border-[#DFDFDF] hover:border-[#161616] text-[#161616]/70 hover:text-[#161616] rounded-[6px] text-[10px] font-black uppercase tracking-widest transition-all disabled:opacity-40 cursor-pointer"
        >
          {syncing
            ? <><Loader2 className="w-3.5 h-3.5 animate-spin" /> Syncing…</>
            : <><RefreshCw className="w-3.5 h-3.5" /> Sync my mailbox</>}
        </button>
      </div>

      <div className="p-5">
        {error && (
          <p role="alert" className="mb-4 rounded-[6px] border border-red-200 bg-red-50 px-4 py-2.5 text-xs font-bold text-red-700">
            {error}
          </p>
        )}
        {notice && (
          <p className="mb-4 rounded-[6px] border border-emerald-200 bg-emerald-50 px-4 py-2.5 text-xs font-semibold text-emerald-800">
            {notice}
          </p>
        )}

        {loading ? (
          <p className="py-8 text-center text-sm italic text-[#161616]/30">Loading email activity…</p>
        ) : !data ? null : (
          <>
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-5">
              {stat(
                'Sent',
                <span className="flex items-center gap-1.5">
                  <ArrowUpRight className="w-4 h-4 text-blue-500" />{data.totals.sent}
                </span>
              )}
              {stat(
                'Received',
                <span className="flex items-center gap-1.5">
                  <ArrowDownLeft className="w-4 h-4 text-emerald-500" />{data.totals.received}
                </span>
              )}
              {stat(
                'Leads emailed',
                data.engagement.leadsEmailed,
                'Distinct leads contacted in this window'
              )}
              {stat(
                'Reply rate',
                data.engagement.replyRatePercent === null
                  ? <span className="text-base text-[#161616]/30">—</span>
                  : `${data.engagement.replyRatePercent}%`,
                data.engagement.replyRatePercent === null
                  ? 'No outbound email in this window'
                  : `${data.engagement.leadsThatReplied} of ${data.engagement.leadsEmailed} replied`
              )}
            </div>

            {data.byUser.length > 0 && (
              <div className="border border-[#DFDFDF] rounded-[6px] overflow-hidden mb-4">
                <div className="overflow-x-auto">
                  <table className="w-full border-collapse">
                    <thead>
                      <tr className="border-b border-[#DFDFDF] bg-[#F9F9F9]">
                        {['Person', 'Sent', 'Received', 'No matching lead'].map((h) => (
                          <th key={h} className="text-left px-4 py-2.5 text-[9px] font-bold text-[#161616]/30 uppercase tracking-widest whitespace-nowrap">
                            {h}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {data.byUser.map((u) => (
                        <tr key={u.userId} className="border-b border-[#DFDFDF] last:border-0 hover:bg-[#F9F9F9]">
                          <td className="px-4 py-2.5 text-sm font-semibold text-[#161616] whitespace-nowrap">
                            @{u.username}
                          </td>
                          <td className="px-4 py-2.5 text-sm text-[#161616]/70 tabular-nums">{u.sent}</td>
                          <td className="px-4 py-2.5 text-sm text-[#161616]/70 tabular-nums">{u.received}</td>
                          <td className="px-4 py-2.5 text-sm text-[#161616]/70 tabular-nums">{u.withoutLead}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            {/* Mail with nobody in the CRM behind it */}
            {canSeeUnmatched && unmatched && unmatched.total > 0 && (
              <div className="border border-amber-200 bg-amber-50/50 rounded-[6px] overflow-hidden mb-4">
                <button
                  type="button"
                  onClick={() => setShowUnmatched((v) => !v)}
                  className="w-full px-4 py-3 flex items-center justify-between gap-3 text-left cursor-pointer hover:bg-amber-50"
                >
                  <span className="flex items-center gap-2 text-xs font-bold text-amber-900">
                    <MailQuestion className="w-4 h-4 shrink-0" />
                    {unmatched.total} message{unmatched.total === 1 ? '' : 's'} with no
                    matching lead in the CRM
                  </span>
                  {showUnmatched
                    ? <ChevronUp className="w-4 h-4 text-amber-700 shrink-0" />
                    : <ChevronDown className="w-4 h-4 text-amber-700 shrink-0" />}
                </button>

                {showUnmatched && (
                  <div className="border-t border-amber-200 max-h-[320px] overflow-y-auto">
                    {unmatched.messages.map((m) => (
                      <div key={m.id} className="px-4 py-2.5 border-b border-amber-100 last:border-0 flex items-start gap-3">
                        <span className={`mt-1 shrink-0 ${m.direction === 'in' ? 'text-emerald-600' : 'text-blue-600'}`}>
                          {m.direction === 'in'
                            ? <ArrowDownLeft className="w-3.5 h-3.5" />
                            : <ArrowUpRight className="w-3.5 h-3.5" />}
                        </span>
                        <div className="min-w-0 flex-1">
                          <p className="text-xs font-semibold text-[#161616] truncate">{m.subject}</p>
                          <p className="text-[10px] text-[#161616]/50 truncate">
                            {m.direction === 'in' ? m.sender : m.toAddress}
                          </p>
                        </div>
                        <span className="text-[10px] font-mono text-[#161616]/35 shrink-0">
                          {m.sentAt
                            ? new Date(m.sentAt).toLocaleDateString(undefined, { dateStyle: 'medium' })
                            : '—'}
                        </span>
                      </div>
                    ))}
                    {unmatched.truncated && (
                      <p className="px-4 py-2.5 text-[10px] text-amber-800 bg-amber-50">
                        Showing the most recent {unmatched.messages.length} of {unmatched.total}.
                      </p>
                    )}
                  </div>
                )}
              </div>
            )}

            <p className="flex items-start gap-1.5 text-[10px] text-[#161616]/40 leading-relaxed">
              <Info className="w-3 h-3 mt-0.5 shrink-0" />
              {data.coverage.note} {data.coverage.mailboxesReporting === 0
                ? 'No mailbox has been synced in this window yet.'
                : `${data.coverage.mailboxesReporting} mailbox${
                    data.coverage.mailboxesReporting === 1 ? '' : 'es'
                  } contributed to these figures.`}
            </p>
          </>
        )}
      </div>
    </div>
  );
};
