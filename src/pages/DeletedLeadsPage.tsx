import React, { useCallback, useEffect, useState } from 'react';
import { Archive, RotateCcw, Info } from 'lucide-react';
import { api } from '../api/services';
import { ApiError } from '../api/errors';

interface ArchiveEntry {
  ID: string;
  LeadId: string;
  LeadName: string;
  DeletedAt: string;
  DeletedBy: string;
  DeletedByUsername: string;
  Reason: string;
  Snapshot: string;
  RestoredAt: string;
  RestoredBy: string;
}

/**
 * The deleted-leads archive.
 *
 * Deleting a lead does not remove its row — it flags it and writes an entry
 * here with a full snapshot of the values at that moment. This page is where
 * a manager can see what was removed, why, by whom, and put it back.
 */
export const DeletedLeadsPage: React.FC = () => {
  const [entries, setEntries] = useState<ArchiveEntry[]>([]);
  const [includeRestored, setIncludeRestored] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setEntries(await api.leads.getDeleted<ArchiveEntry[]>(includeRestored));
    } catch (err) {
      setError(err instanceof ApiError ? err.displayMessage : 'Could not load the archive.');
    } finally {
      setLoading(false);
    }
  }, [includeRestored]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load();
  }, [load]);

  const restore = async (entry: ArchiveEntry) => {
    setBusyId(entry.ID);
    setError(null);
    try {
      await api.leads.restore(entry.LeadId);
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.displayMessage : 'Could not restore.');
    } finally {
      setBusyId(null);
    }
  };

  const snapshotOf = (entry: ArchiveEntry): Record<string, string> => {
    try {
      return JSON.parse(entry.Snapshot || '{}');
    } catch {
      return {};
    }
  };

  return (
    <div className="flex flex-col gap-6">
      <div className="flex justify-between items-center">
        <div>
          <h2 className="text-xl font-bold text-[#161616] tracking-tight">Deleted Leads</h2>
          <p className="text-sm text-[#161616]/40 font-medium mt-0.5">
            Removed from the CRM, kept in the database.
          </p>
        </div>
        <label className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-wider text-[#161616]/50 cursor-pointer">
          <input
            type="checkbox"
            checked={includeRestored}
            onChange={(e) => setIncludeRestored(e.target.checked)}
            className="accent-[#161616]"
          />
          Include restored
        </label>
      </div>

      <p className="flex items-start gap-2 rounded-[6px] border border-[#DFDFDF] bg-[#F9F9F9] px-4 py-3 text-[11px] leading-relaxed text-[#161616]/60">
        <Info className="mt-0.5 h-3.5 w-3.5 shrink-0 text-[#161616]/30" />
        <span>
          Deleting never removes a row from the spreadsheet. The record is
          flagged and hidden, and a copy of every value at the moment of
          deletion is kept below. Restoring puts it straight back — the
          deletion itself stays in the history either way.
        </span>
      </p>

      {error && (
        <div role="alert" className="rounded-[6px] border border-red-200 bg-red-50 px-4 py-3 text-xs font-bold text-red-700">
          {error}
        </div>
      )}

      {loading ? (
        <div className="bg-white border border-[#DFDFDF] rounded-[6px] p-12 text-center text-[#161616]/30 italic text-sm">
          Loading archive…
        </div>
      ) : entries.length === 0 ? (
        <div className="bg-white border border-[#DFDFDF] rounded-[10px] p-12 text-center">
          <Archive className="mx-auto mb-3 h-6 w-6 text-[#161616]/20" />
          <p className="text-sm italic text-[#161616]/30">
            {includeRestored ? 'Nothing has ever been deleted.' : 'No leads are currently deleted.'}
          </p>
        </div>
      ) : (
        <div className="bg-white border border-[#DFDFDF] rounded-[10px] overflow-hidden shadow-sm">
          <ul className="divide-y divide-[#DFDFDF]">
            {entries.map((entry) => {
              const snapshot = snapshotOf(entry);
              const isOpen = expanded === entry.ID;
              const restored = Boolean(entry.RestoredAt);

              return (
                <li key={entry.ID} className="px-5 py-4">
                  <div className="flex items-start justify-between gap-4">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-sm font-bold text-[#161616]">
                          {entry.LeadName || '(unnamed lead)'}
                        </span>
                        {restored && (
                          <span className="px-2 py-0.5 rounded-[3px] bg-green-100 text-green-700 text-[9px] font-bold uppercase tracking-wider">
                            restored
                          </span>
                        )}
                      </div>

                      <p className="mt-1 text-[11px] text-[#161616]/50">
                        Deleted by <span className="font-semibold">@{entry.DeletedByUsername || 'unknown'}</span>
                        {' · '}
                        {entry.DeletedAt
                          ? new Date(entry.DeletedAt).toLocaleString(undefined, {
                              day: 'numeric', month: 'short', year: 'numeric',
                              hour: '2-digit', minute: '2-digit',
                            })
                          : 'unknown time'}
                      </p>

                      <p className="mt-1 text-xs text-[#161616]/70">
                        {entry.Reason
                          ? entry.Reason
                          : <span className="italic text-[#161616]/35">No reason given.</span>}
                      </p>

                      <button
                        type="button"
                        onClick={() => setExpanded(isOpen ? null : entry.ID)}
                        className="mt-2 text-[10px] font-bold uppercase tracking-wider text-[#161616]/40 hover:text-[#161616]"
                      >
                        {isOpen ? 'Hide details' : 'Show what was deleted'}
                      </button>

                      {isOpen && (
                        <dl className="mt-3 grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-1.5 rounded-[6px] border border-[#DFDFDF] bg-[#F9F9F9] p-3">
                          {['Name', 'Email', 'Phone', 'Status', 'Linkedin', 'Notes', 'NextFollowUp']
                            .filter((k) => String(snapshot[k] ?? '').trim() !== '')
                            .map((k) => (
                              <div key={k} className="min-w-0">
                                <dt className="text-[9px] font-bold uppercase tracking-widest text-[#161616]/30">
                                  {k}
                                </dt>
                                <dd className="text-xs text-[#161616]/80 break-words">
                                  {snapshot[k]}
                                </dd>
                              </div>
                            ))}
                        </dl>
                      )}
                    </div>

                    {!restored && (
                      <button
                        type="button"
                        onClick={() => restore(entry)}
                        disabled={busyId === entry.ID}
                        className="flex shrink-0 items-center gap-1.5 rounded-[4px] border border-[#DFDFDF] px-3 py-1.5 text-[10px] font-bold uppercase tracking-wider text-[#161616]/60 hover:border-[#161616]/40 hover:text-[#161616] transition-all disabled:opacity-50"
                      >
                        <RotateCcw className="h-3 w-3" />
                        {busyId === entry.ID ? 'Restoring…' : 'Restore'}
                      </button>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </div>
  );
};
