import React, { useEffect, useState } from 'react';
import { AlertTriangle, RefreshCw } from 'lucide-react';
import { subscribeApiHealth, type ApiHealthState } from '../../api/health';

/**
 * Persistent banner shown whenever the last API call failed.
 *
 * This exists because the original client turned every backend failure into
 * an empty array, so an outage rendered as a perfectly calm "no leads yet"
 * screen. Pages still render their own empty states; this guarantees that a
 * failure is never silently indistinguishable from genuinely having no data.
 */
export const ApiHealthBanner: React.FC = () => {
  const [health, setHealth] = useState<ApiHealthState | null>(null);

  useEffect(() => subscribeApiHealth(setHealth), []);

  if (!health || health.ok || !health.lastError) return null;

  const err = health.lastError;

  return (
    <div
      role="alert"
      className="mb-6 flex items-start gap-3 rounded-[6px] border border-amber-300 bg-amber-50 px-4 py-3"
    >
      <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" />
      <div className="flex-1 min-w-0">
        <div className="text-xs font-bold uppercase tracking-widest text-amber-800">
          Data may be incomplete
        </div>
        <p className="mt-1 text-xs leading-relaxed text-amber-900/80">
          {err.displayMessage}
          {health.failingAction && (
            <span className="ml-1 font-mono text-[10px] text-amber-900/50">
              ({health.failingAction})
            </span>
          )}
        </p>
        <p className="mt-1 text-[11px] font-medium text-amber-900/60">
          Anything shown as empty below may be unavailable rather than absent.
        </p>
      </div>
      {err.retryable && (
        <button
          type="button"
          onClick={() => window.location.reload()}
          className="flex shrink-0 items-center gap-1.5 rounded-[4px] border border-amber-400 px-2.5 py-1 text-[10px] font-bold uppercase tracking-wider text-amber-800 transition-colors hover:bg-amber-100"
        >
          <RefreshCw className="h-3 w-3" /> Retry
        </button>
      )}
    </div>
  );
};
