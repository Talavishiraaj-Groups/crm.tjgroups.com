import React, { useState } from 'react';
import { X, Save } from 'lucide-react';
import { api } from '../../api/services';
import { ApiError } from '../../api/errors';
import type { Lead } from '../../types';

interface Props {
  lead: Lead;
  onClose: () => void;
  onSaved: () => void;
}

/**
 * Edit a lead's details.
 *
 * Every field here goes through the same server-side validation and record
 * scoping as any other mutation — the form is a convenience, not the
 * authority. Fields the server owns (follow-up completion, deletion flags,
 * IDs, timestamps) are deliberately absent: they are set by their own
 * transactions and are stripped from a direct field write anyway.
 */
export const EditLeadModal: React.FC<Props> = ({ lead, onClose, onSaved }) => {
  const [form, setForm] = useState({
    name: lead.name ?? '',
    email: lead.email ?? '',
    phone: lead.phone ?? '',
    linkedin: lead.linkedin ?? '',
    notes: lead.notes ?? '',
    nextFollowUp: lead.nextFollowUp ?? '',
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
    setForm({ ...form, [k]: e.target.value });

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setError(null);
    setFieldErrors({});

    try {
      // Send ONLY what actually changed.
      //
      // Real leads carry legacy values that predate validation — an email
      // field holding "n.a. — no address published", a LinkedIn without its
      // https:// prefix. Re-submitting an untouched field would fail the whole
      // save on data the user never typed, making the record uneditable. A
      // field is validated when you change it, not because you opened a form.
      const patch: Record<string, string> = {};
      const original: Record<string, string> = {
        name: lead.name ?? '',
        email: lead.email ?? '',
        phone: lead.phone ?? '',
        linkedin: lead.linkedin ?? '',
        notes: lead.notes ?? '',
        nextFollowUp: lead.nextFollowUp ?? '',
      };

      for (const key of Object.keys(form) as Array<keyof typeof form>) {
        let next = key === 'notes' ? form[key] : form[key].trim();

        // A bare "linkedin.com/in/x" is unambiguous — prefix it rather than
        // rejecting something the user clearly meant as a URL.
        if (key === 'linkedin' && next && !/^https?:\/\//i.test(next)) {
          next = `https://${next.replace(/^\/+/, '')}`;
        }

        if (next !== original[key]) patch[key] = next;
      }

      if (Object.keys(patch).length === 0) {
        onClose();
        return;
      }

      await api.leads.update(lead.id, patch);
      onSaved();
      onClose();
    } catch (err) {
      if (err instanceof ApiError) {
        // Field-level messages come back from the same validators the API
        // uses, so the form shows the server's reason rather than guessing.
        if (err.fieldErrors.length) {
          const map: Record<string, string> = {};
          for (const fe of err.fieldErrors) map[fe.field.toLowerCase()] = fe.message;
          setFieldErrors(map);
        }
        setError(err.displayMessage);
      } else {
        setError('Could not save the lead.');
      }
    } finally {
      setSaving(false);
    }
  };

  const field = (
    label: string,
    key: keyof typeof form,
    opts: { type?: string; placeholder?: string; serverKey?: string } = {}
  ) => {
    const err = fieldErrors[(opts.serverKey ?? key).toLowerCase()];
    return (
      <div>
        <label className="text-[10px] font-bold text-[#161616]/40 uppercase tracking-widest block mb-1">
          {label}
        </label>
        <input
          type={opts.type ?? 'text'}
          value={form[key]}
          onChange={set(key)}
          placeholder={opts.placeholder}
          className={`w-full px-3 py-2 border rounded-[4px] text-sm focus:outline-none bg-white ${
            err ? 'border-red-400 focus:border-red-500' : 'border-[#DFDFDF] focus:border-[#161616]/50'
          }`}
        />
        {err && <p className="mt-1 text-[10px] font-bold text-red-600">{err}</p>}
      </div>
    );
  };

  return (
    <div className="fixed inset-0 bg-[#161616]/40 backdrop-blur-[2px] flex items-center justify-center z-[9999] p-4">
      <div className="bg-white rounded-[6px] border border-[#DFDFDF] w-full max-w-[520px] shadow-2xl overflow-hidden">
        <div className="px-6 py-4 border-b border-[#DFDFDF] flex justify-between items-center bg-[#F9F9F9]">
          <h3 className="text-sm font-bold text-[#161616] uppercase tracking-widest">
            Edit Lead
          </h3>
          <button onClick={onClose} className="text-[#161616]/30 hover:text-[#161616]">
            <X className="w-4 h-4" />
          </button>
        </div>

        <form onSubmit={submit} className="p-6 flex flex-col gap-4 max-h-[70vh] overflow-y-auto">
          {error && (
            <div role="alert" className="bg-red-50 text-red-700 px-3 py-2 rounded-[4px] text-xs border border-red-100 font-bold">
              {error}
            </div>
          )}

          {field('Company / Lead Name', 'name')}
          {field('Email Address', 'email', { type: 'email', placeholder: 'name@company.com' })}
          {field('Phone Number', 'phone')}
          {field('LinkedIn', 'linkedin', { placeholder: 'https://linkedin.com/company/...' })}
          {field('Next Follow-Up', 'nextFollowUp', { type: 'date' })}

          <div>
            <label className="text-[10px] font-bold text-[#161616]/40 uppercase tracking-widest block mb-1">
              Notes
            </label>
            <textarea
              value={form.notes}
              onChange={set('notes')}
              rows={4}
              className="w-full px-3 py-2 border border-[#DFDFDF] rounded-[4px] text-sm focus:outline-none focus:border-[#161616]/50 resize-y"
            />
            {fieldErrors.notes && (
              <p className="mt-1 text-[10px] font-bold text-red-600">{fieldErrors.notes}</p>
            )}
          </div>

          <p className="text-[10px] text-[#161616]/40 leading-relaxed">
            Owner, setter and closer are changed from the assignment controls —
            those are recorded separately so the history of who handled this
            lead stays intact.
          </p>

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
              disabled={saving}
              className="flex items-center gap-2 bg-[#161616] text-white px-5 py-2 rounded-[4px] text-xs font-bold hover:opacity-90 disabled:opacity-50"
            >
              <Save className="w-3.5 h-3.5" />
              {saving ? 'SAVING…' : 'SAVE CHANGES'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
