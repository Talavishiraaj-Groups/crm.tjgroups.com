import React, { useState } from 'react';
import { api } from '../../api/services';
import { ApiError } from '../../api/errors';

/**
 * Starts the Zoho OAuth flow.
 *
 * The authorization URL is built by the BACKEND, not here. Two reasons:
 *
 *  1. The client id used to be hardcoded in Dashboard.tsx, which shipped it
 *     to every browser in the Vercel bundle. Credentials now live only in
 *     Apps Script Script Properties.
 *  2. The backend attaches a signed `state` bound to the current user, so an
 *     authorization code issued for one account cannot be redeemed against
 *     another. The old URL carried no state at all.
 */
export const ZohoConnectButton: React.FC = () => {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const connect = async () => {
    setBusy(true);
    setError(null);
    try {
      const url = await api.users.getZohoAuthUrl(window.location.origin + '/oauth/callback');
      window.location.href = url;
    } catch (err) {
      setError(
        err instanceof ApiError ? err.displayMessage : 'Could not start Zoho authorisation.'
      );
      setBusy(false);
    }
  };

  return (
    <div className="space-y-3">
      <p className="text-xs text-[#161616]/60 leading-relaxed font-medium">
        Link your Zoho Business Mail to view communications and send mail directly from the CRM.
      </p>
      {error && (
        <p role="alert" className="text-[10px] font-bold text-red-600">
          {error}
        </p>
      )}
      <button
        type="button"
        onClick={connect}
        disabled={busy}
        className="w-full bg-[#161616] text-white py-2.5 rounded-[4px] text-[10px] font-black uppercase tracking-widest hover:opacity-90 transition-all flex items-center justify-center gap-2 disabled:opacity-50"
      >
        {busy ? 'Redirecting…' : 'Connect Zoho Mail'}
      </button>
    </div>
  );
};
