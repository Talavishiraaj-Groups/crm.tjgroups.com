import React, { useState } from 'react';
import { api } from '../../api/services';
import { ApiError } from '../../api/errors';
import type { Lead, User } from '../../types';
import {
  Microscope, Target, Link2, Pencil, Save, X, CheckCircle2, ExternalLink,
} from 'lucide-react';

interface Props {
  lead: Lead;
  users: User[];
  onSaved: () => void;
}

/**
 * Why this lead is in the pipeline at all.
 *
 * Two separate questions, kept apart on purpose: what was found out about the
 * company, and what about it made them worth approaching. The first is
 * evidence, the second is the judgement drawn from it — folding them together
 * produces a paragraph nobody can act on when the lead is handed to a closer
 * six weeks later.
 *
 * Kept out of Notes because Notes is a running log that scrolls; this is a
 * standing record that should still be the first thing you see.
 */
export const ResearchPanel: React.FC<Props> = ({ lead, users, onSaved }) => {
  const [editing, setEditing] = useState(false);
  const [findings, setFindings] = useState(lead.researchFindings || '');
  const [reason, setReason] = useState(lead.qualificationReason || '');
  const [source, setSource] = useState(lead.researchSource || '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const hasAnything = Boolean(
    lead.researchFindings || lead.qualificationReason || lead.researchSource
  );

  const authorName = (() => {
    if (!lead.researchUpdatedBy) return '';
    const u = users.find((x) => x.id === lead.researchUpdatedBy);
    return u?.username || lead.researchUpdatedBy;
  })();

  const startEdit = () => {
    setFindings(lead.researchFindings || '');
    setReason(lead.qualificationReason || '');
    setSource(lead.researchSource || '');
    setError(null);
    setEditing(true);
  };

  const save = async () => {
    setBusy(true);
    setError(null);
    try {
      await api.leads.update(lead.id, {
        researchFindings: findings.trim(),
        qualificationReason: reason.trim(),
        researchSource: source.trim(),
      });
      setEditing(false);
      onSaved();
    } catch (err) {
      setError(err instanceof ApiError ? err.displayMessage : 'Could not save.');
    } finally {
      setBusy(false);
    }
  };

  const sourceIsUrl = /^https?:\/\//i.test((lead.researchSource || '').trim());

  return (
    <div className="bg-white border border-[#DFDFDF] rounded-[10px] shadow-sm overflow-hidden">
      <div className="px-5 py-4 border-b border-[#DFDFDF] flex items-center justify-between gap-3">
        <h3 className="text-[10px] font-black text-[#161616] uppercase tracking-widest flex items-center gap-2">
          <Microscope className="w-3.5 h-3.5 text-[#161616]/40" /> Research & Qualification
        </h3>
        {!editing && (
          <button
            type="button"
            onClick={startEdit}
            className="flex items-center gap-1.5 px-2.5 py-1 border border-[#DFDFDF] hover:border-[#161616] text-[#161616]/60 hover:text-[#161616] rounded-[4px] text-[9px] font-black uppercase tracking-widest transition-all cursor-pointer"
          >
            <Pencil className="w-3 h-3" /> {hasAnything ? 'Edit' : 'Add'}
          </button>
        )}
      </div>

      <div className="p-5">
        {error && (
          <p role="alert" className="mb-3 text-[11px] font-bold text-red-600">{error}</p>
        )}

        {editing ? (
          <div className="flex flex-col gap-4">
            <div>
              <label className="text-[10px] font-bold text-[#161616]/40 uppercase tracking-widest block mb-1.5">
                What did you find out?
              </label>
              <textarea
                value={findings}
                onChange={(e) => setFindings(e.target.value)}
                rows={4}
                placeholder="Company size, funding, recent news, tooling they already use, who makes the decision…"
                className="w-full px-3 py-2 border border-[#DFDFDF] rounded-[4px] text-sm focus:outline-none focus:border-[#161616]/50 resize-y"
              />
            </div>

            <div>
              <label className="text-[10px] font-bold text-[#161616]/40 uppercase tracking-widest block mb-1.5">
                Why is this one worth approaching?
              </label>
              <textarea
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                rows={3}
                placeholder="The specific trigger — expanding into our region, hiring for a role we solve for, a contract coming up for renewal…"
                className="w-full px-3 py-2 border border-[#DFDFDF] rounded-[4px] text-sm focus:outline-none focus:border-[#161616]/50 resize-y"
              />
            </div>

            <div>
              <label className="text-[10px] font-bold text-[#161616]/40 uppercase tracking-widest block mb-1.5">
                Where did it come from?
              </label>
              <input
                type="text"
                value={source}
                onChange={(e) => setSource(e.target.value)}
                placeholder="A link, or where you heard it"
                className="w-full px-3 py-2 border border-[#DFDFDF] rounded-[4px] text-sm focus:outline-none focus:border-[#161616]/50"
              />
            </div>

            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={save}
                disabled={busy}
                className="flex items-center gap-2 bg-[#161616] text-white px-4 py-2 rounded-[4px] text-[10px] font-black uppercase tracking-widest hover:opacity-90 disabled:opacity-50 transition-all cursor-pointer"
              >
                <Save className="w-3.5 h-3.5" /> {busy ? 'Saving…' : 'Save'}
              </button>
              <button
                type="button"
                onClick={() => setEditing(false)}
                disabled={busy}
                className="flex items-center gap-1.5 px-4 py-2 border border-[#DFDFDF] hover:border-[#161616] text-[#161616]/60 hover:text-[#161616] rounded-[4px] text-[10px] font-black uppercase tracking-widest transition-all cursor-pointer"
              >
                <X className="w-3.5 h-3.5" /> Cancel
              </button>
            </div>
          </div>
        ) : !hasAnything ? (
          <div className="text-center py-6">
            <Microscope className="w-7 h-7 text-[#161616]/15 mx-auto mb-2" />
            <p className="text-[11px] text-[#161616]/40 leading-relaxed max-w-[280px] mx-auto">
              Nothing recorded yet. Whoever sourced this lead knows why it was
              worth the outreach — write it down before that knowledge walks.
            </p>
          </div>
        ) : (
          <div className="flex flex-col gap-4">
            {lead.researchFindings && (
              <div>
                <p className="text-[9px] font-bold text-[#161616]/30 uppercase tracking-widest mb-1.5 flex items-center gap-1.5">
                  <Microscope className="w-3 h-3" /> Findings
                </p>
                <p className="text-sm text-[#161616]/80 leading-relaxed whitespace-pre-wrap">
                  {lead.researchFindings}
                </p>
              </div>
            )}

            {lead.qualificationReason && (
              <div className="pt-3 border-t border-[#DFDFDF]/70">
                <p className="text-[9px] font-bold text-[#161616]/30 uppercase tracking-widest mb-1.5 flex items-center gap-1.5">
                  <Target className="w-3 h-3" /> Why we chose them
                </p>
                <p className="text-sm text-[#161616]/80 leading-relaxed whitespace-pre-wrap">
                  {lead.qualificationReason}
                </p>
              </div>
            )}

            {lead.researchSource && (
              <div className="pt-3 border-t border-[#DFDFDF]/70">
                <p className="text-[9px] font-bold text-[#161616]/30 uppercase tracking-widest mb-1.5 flex items-center gap-1.5">
                  <Link2 className="w-3 h-3" /> Source
                </p>
                {sourceIsUrl ? (
                  <a
                    href={lead.researchSource}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-xs text-blue-600 hover:underline break-all inline-flex items-center gap-1"
                  >
                    {lead.researchSource} <ExternalLink className="w-3 h-3 shrink-0" />
                  </a>
                ) : (
                  <p className="text-xs text-[#161616]/70 break-words">{lead.researchSource}</p>
                )}
              </div>
            )}

            {lead.researchUpdatedAt && (
              <p className="pt-3 border-t border-[#DFDFDF]/70 text-[10px] text-[#161616]/35 flex items-center gap-1.5">
                <CheckCircle2 className="w-3 h-3 text-emerald-500" />
                Last revised by {authorName || 'someone'} on{' '}
                {new Date(lead.researchUpdatedAt).toLocaleDateString(undefined, {
                  dateStyle: 'medium',
                })}
              </p>
            )}
          </div>
        )}
      </div>
    </div>
  );
};
