import React, { useState } from 'react';
import { X, Trash2, Archive } from 'lucide-react';
import { api } from '../../api/services';
import { ApiError } from '../../api/errors';
import type { Lead } from '../../types';

interface Props {
  lead: Lead;
  onClose: () => void;
  onDeleted: () => void;
}

/**
 * Delete a lead — managers only.
 *
 * This is a soft delete. The row is flagged and an entry is written to the
 * DeletedLeads archive with a full snapshot; nothing is removed from the
 * spreadsheet, and it can be restored. The wording below says so plainly,
 * because "delete" that quietly means something else is worse than either.
 *
 * A lead that has been converted to a deal cannot be deleted at all — the
 * server refuses, and explains why.
 */
export const DeleteLeadModal: React.FC<Props> = ({ lead, onClose, onDeleted }) => {
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const confirm = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api.leads.remove(lead.id, reason.trim());
      onDeleted();
      onClose();
    } catch (err) {
      setError(err instanceof ApiError ? err.displayMessage : 'Could not delete the lead.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-[#161616]/40 backdrop-blur-[2px] flex items-center justify-center z-[9999] p-4">
      <div className="bg-white rounded-[6px] border border-[#DFDFDF] w-full max-w-[460px] shadow-2xl overflow-hidden">
        <div className="px-6 py-4 border-b border-[#DFDFDF] flex justify-between items-center bg-[#F9F9F9]">
          <h3 className="text-sm font-bold text-[#161616] uppercase tracking-widest flex items-center gap-2">
            <Trash2 className="w-4 h-4" /> Delete Lead
          </h3>
          <button onClick={onClose} className="text-[#161616]/30 hover:text-[#161616]">
            <X className="w-4 h-4" />
          </button>
        </div>

        <form onSubmit={confirm} className="p-6 flex flex-col gap-4">
          {error && (
            <div role="alert" className="bg-red-50 text-red-700 px-3 py-2 rounded-[4px] text-xs border border-red-100 font-bold">
              {error}
            </div>
          )}

          <p className="text-sm text-[#161616]">
            Remove <span className="font-bold">{lead.name}</span> from the CRM?
          </p>

          <div className="flex items-start gap-2.5 rounded-[4px] border border-[#DFDFDF] bg-[#F9F9F9] px-3 py-2.5">
            <Archive className="mt-0.5 h-3.5 w-3.5 shrink-0 text-[#161616]/40" />
            <p className="text-[11px] leading-relaxed text-[#161616]/60">
              The record is <span className="font-semibold">archived, not erased</span>.
              It disappears from the CRM but stays in the spreadsheet, and a
              copy is kept in the deleted-leads archive with your name, the
              time and the reason. An administrator can restore it.
            </p>
          </div>

          <div>
            <label className="text-[10px] font-bold text-[#161616]/40 uppercase tracking-widest block mb-1">
              Reason (recommended)
            </label>
            <input
              type="text"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="e.g. duplicate of an existing account"
              className="w-full px-3 py-2 border border-[#DFDFDF] rounded-[4px] text-sm focus:outline-none focus:border-[#161616]/50"
            />
          </div>

          <div className="flex justify-end gap-2 mt-1">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 text-xs font-bold text-[#161616]/50 hover:text-[#161616]"
            >
              CANCEL
            </button>
            <button
              type="submit"
              disabled={busy}
              className="flex items-center gap-2 bg-red-600 text-white px-5 py-2 rounded-[4px] text-xs font-bold hover:bg-red-700 disabled:opacity-50"
            >
              <Trash2 className="w-3.5 h-3.5" />
              {busy ? 'DELETING…' : 'DELETE LEAD'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
