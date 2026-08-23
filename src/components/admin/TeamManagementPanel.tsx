import React, { useCallback, useEffect, useState } from 'react';
import { Users, AlertTriangle, Check } from 'lucide-react';
import { api } from '../../api/services';
import { ApiError } from '../../api/errors';

interface Member {
  id: string;
  username: string;
  role: string;
  status: string;
  team: string;
}

interface Team {
  name: string;
  key: string;
  spellings: string[];
  memberCount: number;
  managerCount: number;
  leadCount: number;
  managers: Member[];
  members: Member[];
}

/**
 * Team structure, managed by a Super Admin.
 *
 * An ADMIN sees the records of people on their team. That boundary is DATA,
 * decided here, rather than a setting in a config file — a permission rule
 * buried in Script Properties is one nobody reviews.
 *
 * The panel exists mainly because the failure mode is silent: a manager whose
 * team matches nobody just sees an empty CRM, with nothing explaining why.
 * Warnings surface that here instead.
 */
export const TeamManagementPanel: React.FC = () => {
  const [teams, setTeams] = useState<Team[]>([]);
  const [unassigned, setUnassigned] = useState<Member[]>([]);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [totals, setTotals] = useState<{ totalLeads: number; unassignedLeadCount: number }>({
    totalLeads: 0, unassignedLeadCount: 0,
  });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [savingId, setSavingId] = useState<string | null>(null);
  const [savedId, setSavedId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await api.teams.overview();
      setTeams((data.teams ?? []) as Team[]);
      setUnassigned((data.unassigned ?? []) as Member[]);
      setWarnings((data.warnings ?? []) as string[]);
      setTotals({
        totalLeads: Number(data.totalLeads || 0),
        unassignedLeadCount: Number(data.unassignedLeadCount || 0),
      });
    } catch (err) {
      setError(err instanceof ApiError ? err.displayMessage : 'Could not load teams.');
    } finally {
      setLoading(false);
    }
  }, []);

  // Fetch on mount. `load` sets state, which the lint rule flags as a
  // cascading render — but fetching remote data IS synchronising with an
  // external system, which is exactly what an effect is for. The alternative
  // is a data-fetching library, which is a larger change than this panel
  // warrants.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load();
  }, [load]);

  const assign = async (userId: string, team: string) => {
    setSavingId(userId);
    setError(null);
    try {
      await api.teams.setUserTeam(userId, team);
      setSavedId(userId);
      window.setTimeout(() => setSavedId(null), 2000);
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.displayMessage : 'Could not save.');
    } finally {
      setSavingId(null);
    }
  };

  // Existing team names, so assignment is a pick rather than a retype — the
  // quickest way to end up with "Sales Team" and "Sales team" is free text.
  const knownTeams = [...new Set(teams.map((t) => t.name).filter(Boolean))].sort();

  const picker = (m: Member) => (
    <div className="flex items-center gap-2">
      <select
        value={m.team ?? ''}
        disabled={savingId === m.id}
        onChange={(e) => assign(m.id, e.target.value)}
        className="px-2 py-1 border border-[#DFDFDF] rounded-[4px] text-xs bg-white focus:outline-none focus:border-[#161616]/50 disabled:opacity-50"
      >
        <option value="">— no team —</option>
        {knownTeams.map((t) => (
          <option key={t} value={t}>{t}</option>
        ))}
      </select>
      <button
        type="button"
        onClick={() => {
          const name = window.prompt('New team name', m.team || '');
          if (name !== null) assign(m.id, name.trim());
        }}
        className="text-[10px] font-bold text-[#161616]/40 hover:text-[#161616] uppercase tracking-wider"
      >
        New
      </button>
      {savedId === m.id && <Check className="w-3.5 h-3.5 text-green-600" />}
    </div>
  );

  return (
    <div className="bg-white border border-[#DFDFDF] rounded-[10px] p-5 shadow-sm">
      <div className="flex items-center justify-between mb-1">
        <h3 className="text-[10px] font-bold text-[#161616]/30 uppercase tracking-widest flex items-center gap-2">
          <Users className="w-3.5 h-3.5" /> Team Structure
        </h3>
        <button
          type="button"
          onClick={load}
          className="text-[10px] font-bold text-[#161616]/40 hover:text-[#161616] uppercase tracking-wider"
        >
          Refresh
        </button>
      </div>
      <p className="mb-4 text-[10px] leading-relaxed text-[#161616]/40">
        An Admin sees the leads, deals and projects of everyone on their team.
        Put a manager and the people they manage on the same team.
      </p>

      {error && (
        <p role="alert" className="mb-3 text-[11px] font-bold text-red-600">{error}</p>
      )}

      {warnings.length > 0 && (
        <div className="mb-4 rounded-[6px] border border-amber-300 bg-amber-50 px-3 py-2.5">
          <div className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-widest text-amber-800">
            <AlertTriangle className="w-3.5 h-3.5" /> Needs attention
          </div>
          <ul className="mt-1.5 space-y-1">
            {warnings.map((w, i) => (
              <li key={i} className="text-[11px] leading-relaxed text-amber-900/80">• {w}</li>
            ))}
          </ul>
        </div>
      )}

      {loading ? (
        <p className="py-6 text-center text-sm italic text-[#161616]/30">Loading…</p>
      ) : (
        <div className="space-y-5">
          {teams.map((t) => (
            <div key={t.key} className="rounded-[6px] border border-[#DFDFDF] overflow-hidden">
              <div className="flex items-center justify-between px-4 py-2.5 bg-[#F9F9F9] border-b border-[#DFDFDF]">
                <div>
                  <span className="text-sm font-bold text-[#161616]">{t.name}</span>
                  <span className="ml-2 text-[10px] font-medium text-[#161616]/40">
                    {t.memberCount} member{t.memberCount === 1 ? '' : 's'} ·{' '}
                    {t.leadCount} lead{t.leadCount === 1 ? '' : 's'}
                  </span>
                </div>
                {t.managerCount === 0 ? (
                  <span className="px-2 py-0.5 rounded-[3px] bg-amber-100 text-amber-800 text-[9px] font-bold uppercase tracking-wider">
                    no manager
                  </span>
                ) : (
                  <span className="text-[10px] font-medium text-[#161616]/40">
                    managed by {t.managers.map((m) => `@${m.username}`).join(', ')}
                  </span>
                )}
              </div>
              <ul className="divide-y divide-[#DFDFDF]">
                {t.members.map((m) => (
                  <li key={m.id} className="flex items-center justify-between px-4 py-2">
                    <div className="min-w-0">
                      <span className="text-sm font-semibold text-[#161616]">@{m.username}</span>
                      <span className="ml-2 text-[10px] font-bold uppercase tracking-wider text-[#161616]/40">
                        {m.role}
                      </span>
                      {m.status !== 'Active' && (
                        <span className="ml-2 text-[9px] font-bold uppercase text-[#161616]/25">inactive</span>
                      )}
                    </div>
                    {picker(m)}
                  </li>
                ))}
              </ul>
            </div>
          ))}

          {unassigned.length > 0 && (
            <div className="rounded-[6px] border border-amber-300 overflow-hidden">
              <div className="px-4 py-2.5 bg-amber-50 border-b border-amber-300">
                <span className="text-sm font-bold text-amber-900">Not on a team</span>
                <span className="ml-2 text-[10px] font-medium text-amber-900/60">
                  their records are invisible to every Admin
                </span>
              </div>
              <ul className="divide-y divide-[#DFDFDF]">
                {unassigned.map((m) => (
                  <li key={m.id} className="flex items-center justify-between px-4 py-2">
                    <div>
                      <span className="text-sm font-semibold text-[#161616]">@{m.username}</span>
                      <span className="ml-2 text-[10px] font-bold uppercase tracking-wider text-[#161616]/40">
                        {m.role}
                      </span>
                      {m.status !== 'Active' && (
                        <span className="ml-2 text-[9px] font-bold uppercase text-[#161616]/25">inactive</span>
                      )}
                    </div>
                    {picker(m)}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {totals.unassignedLeadCount > 0 && (
            <p className="text-[10px] text-[#161616]/40">
              {totals.unassignedLeadCount} of {totals.totalLeads} leads are owned by
              nobody on a team, so no Admin can see them.
            </p>
          )}
        </div>
      )}
    </div>
  );
};
