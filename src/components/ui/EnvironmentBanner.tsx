import React from 'react';
import { AlertOctagon } from 'lucide-react';

const API_URL = (import.meta.env.VITE_API_URL as string | undefined) ?? '';

/** A remote backend during development means you are editing real records. */
const isRemote = /^https?:\/\//i.test(API_URL) && !/localhost|127\.0\.0\.1/.test(API_URL);
const isDev = Boolean(import.meta.env.DEV);

/**
 * Shown only when a DEV build is pointed at a remote backend.
 *
 * Connecting local development to the deployed Apps Script is supported, but
 * it is not a read-only window onto production: every action here writes to
 * the live CRM. The one thing that must never happen is someone forgetting
 * which database they are in, so this stays on screen for the whole session.
 *
 * It renders nothing in a production build, and nothing when the local dev
 * API is in use.
 */
export const EnvironmentBanner: React.FC = () => {
  if (!isDev || !isRemote) return null;

  let host = API_URL;
  try {
    host = new URL(API_URL).host;
  } catch {
    /* keep the raw value */
  }

  return (
    <div
      role="alert"
      className="mb-6 flex items-start gap-3 rounded-[6px] border-2 border-red-500 bg-red-50 px-4 py-3"
    >
      <AlertOctagon className="mt-0.5 h-5 w-5 shrink-0 text-red-600" />
      <div className="min-w-0">
        <div className="text-xs font-black uppercase tracking-widest text-red-700">
          Connected to the live CRM
        </div>
        <p className="mt-1 text-xs leading-relaxed text-red-900/80">
          This is a development server talking to <span className="font-mono">{host}</span>.
          Everything you do here — creating leads, marking deals won, settling
          payouts — changes real production data.
        </p>
        <p className="mt-1 text-[11px] font-medium text-red-900/60">
          For a safe sandbox instead: <span className="font-mono">npm run dev:api</span>
        </p>
      </div>
    </div>
  );
};
