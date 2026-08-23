import React, { useState } from 'react';
import { Download, Check } from 'lucide-react';
import { api } from '../../api/services';
import { ApiError } from '../../api/errors';

/**
 * Download a complete CRM export. SUPER_ADMIN only.
 *
 * The file is built by the BACKEND from the sheets themselves, not from
 * whatever rows the current screen happens to be showing — so it is a real
 * backup rather than a view dump. Secrets are stripped server-side: password
 * hashes, salts, session tokens and Zoho refresh tokens never appear, and the
 * Sessions sheet is excluded entirely.
 */
export const ExportDataButton: React.FC = () => {
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [summary, setSummary] = useState<string | null>(null);

  const run = async () => {
    setBusy(true);
    setError(null);
    setDone(false);
    try {
      const dump = await api.finance.exportAll();

      const counts = (dump.counts ?? {}) as Record<string, number>;
      const total = Object.values(counts).reduce((n, v) => n + Number(v || 0), 0);
      setSummary(
        Object.entries(counts).map(([k, v]) => `${k} ${v}`).join(' · ') +
        `  (${total} records)`
      );

      const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');
      const blob = new Blob([JSON.stringify(dump, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);

      const a = document.createElement('a');
      a.href = url;
      a.download = `tjgroups-crm-export-${stamp}.json`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);

      setDone(true);
      window.setTimeout(() => setDone(false), 4000);
    } catch (err) {
      setError(err instanceof ApiError ? err.displayMessage : 'Export failed.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex flex-col gap-2">
      <button
        type="button"
        onClick={run}
        disabled={busy}
        className="flex items-center justify-center gap-2 bg-[#161616] text-white px-4 py-2.5 rounded-[6px] text-xs font-bold hover:opacity-90 disabled:opacity-50 transition-all"
      >
        {done ? <Check className="w-3.5 h-3.5" /> : <Download className="w-3.5 h-3.5" />}
        {busy ? 'BUILDING EXPORT…' : done ? 'DOWNLOADED' : 'DOWNLOAD FULL CRM EXPORT'}
      </button>

      {error && (
        <p role="alert" className="text-[10px] font-bold text-red-600">
          {error}
        </p>
      )}

      {summary && !error && (
        <p className="text-[10px] leading-relaxed text-[#161616]/40 font-mono">{summary}</p>
      )}

      <p className="text-[10px] leading-relaxed text-[#161616]/40">
        Read directly from the database, so it is always current — not a copy of
        what is on screen. Passwords, session tokens and Zoho credentials are
        excluded. The file contains real business data: store it accordingly.
      </p>
    </div>
  );
};
