import React, { useState, useEffect, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { api } from '../api/services';
import { ApiError } from '../api/errors';
import { Lead, Log, AdminRequest, User, ZohoEmailItem } from '../types';
import { useAuth } from '../context/AuthContext';
import { 
  ArrowLeft, Phone, Mail, Calendar,
  DollarSign, FileText, User as UserIcon, CheckCircle, Clock,
  ExternalLink, ShieldAlert, Pencil, Trash2
} from 'lucide-react';
import { STATUS_BADGE } from '../utils/badges';
import { ZohoEmailViewer } from '../components/zoho/ZohoEmailViewer';
import { EmailComposer } from '../components/zoho/EmailComposer';
import { EditLeadModal } from '../components/leads/EditLeadModal';
import { DeleteLeadModal } from '../components/leads/DeleteLeadModal';
import { FollowUpPanel } from '../components/leads/FollowUpPanel';
import { FollowUpDelayPrompt } from '../components/leads/FollowUpDelayPrompt';
import { InteractionComposer } from '../components/leads/InteractionComposer';
import { ResearchPanel } from '../components/leads/ResearchPanel';

/**
 * Combine the CRM's archived copies with whatever the mailbox returns now.
 *
 * The live copy wins when both exist: it carries the full body, while the
 * archive holds only the envelope and a summary. Archived entries with no live
 * counterpart are still shown — that is the whole point of keeping them, since
 * a message may have been deleted from Zoho or the token that could read it
 * may have expired.
 *
 * Outside the component because it depends on nothing in it.
 */
function mergeEmails(stored: ZohoEmailItem[], live: ZohoEmailItem[]): ZohoEmailItem[] {
  const liveIds = new Set(live.map(e => e.id));
  const kept = stored.filter(s => !liveIds.has(s.messageId || s.id));
  return [...live, ...kept];
}

/** Truthy text is not an address: many leads carry "n.a." or similar. */
const looksLikeEmail = (v?: string) =>
  !!v && /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(v.trim());

export const LeadDetail: React.FC = () => {
  const { id } = useParams();
  const navigate = useNavigate();
  const { role, user } = useAuth();
  const [lead, setLead] = useState<Lead | null>(null);
  const [logs, setLogs] = useState<Log[]>([]);
  const [requests, setRequests] = useState<AdminRequest[]>([]);
  const [users, setUsers] = useState<User[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  // Conversion state
  const [isConverting, setIsConverting] = useState(false);
  const [dealValue, setDealValue] = useState(0);

  // Tab state
  const [activeRightTab, setActiveRightTab] = useState<'activity' | 'zoho'>('activity');

  // Zoho Mail States
  const [zohoEmails, setZohoEmails] = useState<ZohoEmailItem[]>([]);
  const [isZohoLinked, setIsZohoLinked] = useState(false);
  /** Set when Zoho refuses the stored token: actionable, and not self-healing. */
  const [zohoExpired, setZohoExpired] = useState<string | null>(null);
  /** Why the lead could not be read — as opposed to the lead not existing. */
  const [loadError, setLoadError] = useState<string | null>(null);
  const [isFetchingZoho, setIsFetchingZoho] = useState(false);
  const [showMandatoryFollowUpPrompt, setShowMandatoryFollowUpPrompt] = useState(false);
  const [showEdit, setShowEdit] = useState(false);
  const [showDelete, setShowDelete] = useState(false);
  /**
   * Set when the server refuses to move a stale follow-up without a reason.
   * Holds the date that was being set, so answering the prompt completes the
   * original action rather than making the user pick the date again.
   */
  const [delayPrompt, setDelayPrompt] =
    useState<{ date: string; message: string; error?: string } | null>(null);
  const isManager = role === 'SUPER_ADMIN' || role === 'ADMIN';

  /**
   * One request per mailbox, not one per user.
   *
   * This used to walk every user id in the org until a fetch returned
   * something, which made a dozen identical calls on every lead view: the
   * backend has only ever read the caller's own mailbox, and now enforces it.
   *
   * @param preloaded archived mail already fetched alongside the rest of the
   *        page. Passing it avoids a second request for something we have.
   */
  const loadEmails = useCallback(async (targetLead: Lead, preloaded?: ZohoEmailItem[]) => {
    if (!targetLead.email) return [] as ZohoEmailItem[];

    let stored: ZohoEmailItem[] = preloaded ?? [];
    if (!preloaded) {
      try {
        stored = await api.zoho.getStoredEmails(targetLead.id, targetLead.email);
        // Show the archive straight away; the Zoho round-trip is much slower.
        setZohoEmails(stored);
      } catch (err) {
        console.error('Could not read stored emails:', err);
      }
    }

    try {
      const live = await api.zoho.getEmails(targetLead.email, targetLead.id);
      const merged = mergeEmails(stored, live);
      setZohoEmails(merged);
      setZohoExpired(null);
      return merged;
    } catch (err) {
      // An expired connection IS something they can act on, and it will not
      // fix itself — so it gets said plainly instead of being swallowed into
      // the console. Anything else (a transient Zoho blip, a network drop) is
      // not actionable: the archived conversation is still on screen.
      if (err instanceof ApiError && err.code === 'ZOHO_REAUTH_REQUIRED') {
        setZohoExpired(err.displayMessage);
      } else {
        console.error('Could not sync from Zoho:', err);
      }
      return stored;
    }
  }, []);

  /**
   * Pull the conversation again from the mailbox.
   *
   * `preloaded` is deliberately NOT passed: a manual refresh must skip the
   * archived copy and go to Zoho, or pressing it after replying just re-reads
   * the same stale rows and appears to do nothing.
   */
  const refreshZohoEmails = useCallback(async () => {
    if (!lead?.email) return;
    try {
      setIsFetchingZoho(true);
      await loadEmails(lead);
    } finally {
      setIsFetchingZoho(false);
    }
  }, [lead, loadEmails]);

  /**
   * Poll the open conversation while the tab is in view.
   *
   * A reply lands in the mailbox seconds after it is sent, and waiting for
   * someone to press a button to discover that is the wrong default. Bounded
   * deliberately: only while the Zoho tab is actually open, only while the
   * browser tab is visible, and no faster than once a minute — each poll is a
   * Zoho round trip plus an Apps Script invocation on a shared free-tier
   * budget.
   */
  useEffect(() => {
    if (activeRightTab !== 'zoho') return;
    if (!lead?.email || !looksLikeEmail(lead.email)) return;

    const POLL_MS = 60 * 1000;
    const tick = () => {
      if (document.visibilityState === 'visible') refreshZohoEmails();
    };

    const interval = setInterval(tick, POLL_MS);
    // Returning to the tab is when a stale thread is noticed, so check then
    // rather than waiting out the rest of the interval.
    document.addEventListener('visibilitychange', tick);

    return () => {
      clearInterval(interval);
      document.removeEventListener('visibilitychange', tick);
    };
  }, [activeRightTab, lead, refreshZohoEmails]);

  const fetchData = useCallback(async () => {
    if (id) {
      try {
        setIsLoading(true);

        // One round trip, not four. Every Apps Script invocation costs a
        // second or more on the free tier no matter how little it does, so
        // the request count — not the work — is what this page waited on.
        const got = await api.batch([
          { key: 'lead', action: 'getLeadById', payload: { id } },
          { key: 'logs', action: 'getLogs', payload: { id } },
          { key: 'requests', action: 'getAdminRequests' },
          { key: 'users', action: 'getUsers' },
          // The archived conversation comes along for free. Only the live
          // Zoho sync, which reaches an external service, stays out of band.
          { key: 'stored', action: 'getStoredEmails', payload: { leadId: id } },
        ]);

        // "The request failed" and "the record is gone" are different facts and
        // must not render as the same sentence. A failed read left `lead` null,
        // and the page then announced the lead had been DELETED — about a lead
        // sitting untouched in the sheet. Keep the reason so the page can tell
        // the truth and offer a retry.
        const leadFailed = got.failed('lead');
        setLoadError(leadFailed ? (got.errorFor('lead') || 'The server did not answer.') : null);

        const leadData = leadFailed
          ? undefined
          : api.map.lead(got.get<Record<string, unknown>>('lead', {}));
        const logsData = got.get<Record<string, unknown>[]>('logs', []).map(api.map.log);
        const requestsData = got.get<Record<string, unknown>[]>('requests', []).map(api.map.adminRequest);
        const usersData = got.get<Record<string, unknown>[]>('users', []).map(api.map.user);
        const storedEmails = got.get<Record<string, unknown>[]>('stored', []).map(api.map.storedEmail);

        setUsers(usersData);
        setZohoEmails(storedEmails);

        if (leadData) setLead(leadData);
        setLogs(logsData || []);
        
        // Filter requests related to this lead (by relatedDealId)
        setRequests((requestsData || []).filter(r => r.relatedDealId === id));

        // Whether YOUR mailbox is connected is a fact about you, not about
        // this lead. These were previously the same flag, so opening a lead
        // with no email address reported "Zoho Mail Not Linked" — sending
        // people off to reconnect an account that was already fine.
        //
        // "Linked" means THIS user has connected their own mailbox. It used to
        // mean "anyone in the org has", which is what let one person read and
        // send from a colleague's Zoho account.
        const me = user ? usersData.find(u => u.id === user.id) : undefined;
        setIsZohoLinked(Boolean(me?.zohoLinked || me?.zohoEmail));

        // Only attempt a mailbox lookup when the lead actually has a usable
        // address. Plenty of real leads carry placeholder text such as
        // "n.a. — no address published", which is truthy but not an address:
        // sending it would fail validation server-side and surface as a
        // "data may be incomplete" warning for a lead that simply has no email.
        if (leadData && looksLikeEmail(leadData.email) && user) {
          setIsFetchingZoho(true);

          loadEmails(leadData, storedEmails).then((fetched) => {
            // Check if an email was sent today to show mandatory follow up prompt
            const todayStr = new Date().toISOString().split('T')[0];
            const emailSentToday = (fetched && fetched.some(e => e.direction === 'out' && e.timestamp?.startsWith(todayStr))) ||
                                   (logsData && logsData.some(l => (l.action === 'EMAIL' || (l.details && l.details.includes('Sent email'))) && l.timestamp?.startsWith(todayStr)));

            if (emailSentToday && (!leadData.nextFollowUp || leadData.nextFollowUp <= todayStr)) {
              setShowMandatoryFollowUpPrompt(true);
            }

            // Move a New lead to Contacted only when WE have actually emailed
            // them since the lead was created.
            //
            // This used to fire on any message at all involving that address.
            // Creating a lead for someone you had corresponded with before —
            // which is most of them — flipped it to Contacted the instant the
            // page opened, so a brand-new lead was never New. Outreach that
            // predates the record is not outreach about this lead.
            const createdAt = Date.parse(leadData.createdAt || '');
            const contactedSinceCreation = fetched.some(e =>
              e.direction === 'out' &&
              !Number.isNaN(Date.parse(e.timestamp)) &&
              (Number.isNaN(createdAt) || Date.parse(e.timestamp) >= createdAt)
            );

            if (leadData.status === 'New' && contactedSinceCreation && id) {
              // The backend audits the status change; no client log here.
              api.leads.update(id, { status: 'Contacted' }).catch(() => {});
              setLead(prev => prev ? { ...prev, status: 'Contacted' } : null);
            }
          }).finally(() => {
            setIsFetchingZoho(false);
          });
        }
      } catch (err) {
        console.error('Failed to fetch data:', err);
      } finally {
        setIsLoading(false);
      }
    }
  }, [id, user, loadEmails]);

  const todayStr = new Date().toISOString().split('T')[0];
  const maxFollowUpDateStr = (() => {
    const d = new Date();
    d.setDate(d.getDate() + 3);
    return d.toISOString().split('T')[0];
  })();

  /**
   * Move the follow-up date, asking why if it has been ignored for a day.
   *
   * The server is the one that decides an explanation is owed — the same rule
   * has to hold whoever is calling — so this reacts to its refusal rather than
   * trying to work out staleness a second time on the client and risking the
   * two disagreeing.
   */
  const saveFollowUpDate = async (dateStr: string, delayReason?: string) => {
    if (!id) return;
    try {
      // The backend audits this update; a second log here would double it.
      await api.leads.update(id, { nextFollowUp: dateStr }, { delayReason });
      setLead(prev => (prev ? {
        ...prev,
        nextFollowUp: dateStr,
        ...(delayReason ? { followUpDelayReason: delayReason } : {}),
      } : null));
      setDelayPrompt(null);
    } catch (err) {
      if (err instanceof ApiError && err.code === 'FOLLOWUP_REASON_REQUIRED') {
        setDelayPrompt({ date: dateStr, message: err.message });
        return;
      }
      console.error('Failed to update follow up date:', err);
      setDelayPrompt(prev => (prev ? { ...prev, error: 'That did not save. Try again.' } : null));
    }
  };

  const handleSetFollowUpDays = async (days: number) => {
    if (!id || !user || !lead) return;
    const target = new Date();
    target.setDate(target.getDate() + days);
    await saveFollowUpDate(target.toISOString().split('T')[0]);
  };

  const handleCustomFollowUpDate = async (selectedDateStr: string) => {
    if (!id || !user || !lead) return;
    if (!selectedDateStr) return;
    let finalDateStr = selectedDateStr;
    if (selectedDateStr > maxFollowUpDateStr) {
      alert(`Follow-up date cannot be more than 3 days into the future. Auto-adjusting to max allowed (${maxFollowUpDateStr}).`);
      finalDateStr = maxFollowUpDateStr;
    }
    await saveFollowUpDate(finalDateStr);
  };

  useEffect(() => {
    // Loading remote data on mount. State lands after the request resolves,
    // never synchronously inside the effect body.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    fetchData();
  }, [fetchData]);

  /**
   * Apply a change locally at once, then reconcile in the background.
   *
   * Every Apps Script call costs a second or more before it does any work, so
   * `await write; await refetch` made each click a 3–6 second wait on a
   * screen that had not visibly changed. The write still has to happen — but
   * the person clicking already knows what they chose, so showing it
   * immediately and correcting later if the server disagrees is both faster
   * and more honest than a frozen button.
   */
  const applyLeadChange = (
    patch: Partial<Lead>,
    write: () => Promise<unknown>,
  ) => {
    const previous = lead;
    setLead((current) => (current ? { ...current, ...patch } : current));

    write()
      .then(() => {
        // Refresh quietly: the audit log and follow-up state may have moved
        // too, and that is not something the client can infer.
        fetchData();
      })
      .catch((err) => {
        console.error('Update failed, restoring previous value:', err);
        setLead(previous);
        alert('That change could not be saved. The previous value has been restored.');
      });
  };

  const handleUpdateStatus = (status: Lead['status']) => {
    if (!id || !user) return;
    // The backend writes the STATUS_CHANGE entry itself, with the old and
    // new value. Logging again here is what produced two rows per change.
    applyLeadChange({ status }, () => api.leads.update(id, { status }));
  };

  const handleConvertToDeal = async () => {
    if (!id || !user || dealValue <= 0) {
      alert('Please enter a valid deal value.');
      return;
    }
    if (!window.confirm(`Convert ${lead?.name} to a Deal with value $${dealValue}?`)) return;

    setIsConverting(true);
    try {
      await api.leads.convertToDeal(id, user.id, dealValue);
      alert('Lead successfully converted to Deal!');
      navigate('/deals');
    } catch (err) {
      console.error(err);
      alert('Failed to convert lead: ' +
        (err instanceof Error ? err.message : 'Ensure the backend is responding.'));
    } finally {
      setIsConverting(false);
    }
  };

  const handleRequest = async (type: 'payment' | 'paperwork') => {
    if (!id || !user) return;
    
    // Check if a pending request of this type already exists
    const existing = requests.find(r => r.type === type && r.status === 'Pending');
    if (existing) {
      alert(`A pending ${type} request already exists for this lead.`);
      return;
    }

    try {
      await api.adminRequests.create({
        type,
        relatedDealId: id,
        requestedBy: user.id,
        status: 'Pending',
        notes: `Requested from Lead Detail for ${lead?.name}`
      });
      await api.logs.create({
        entityId: id,
        entityType: 'Lead',
        action: 'REQUEST',
        userId: user.id,
        details: `Requested ${type}`
      });
      alert(`${type.charAt(0).toUpperCase() + type.slice(1)} request sent to Admin.`);
      fetchData();
    } catch (err) {
      console.error(err);
      alert('Request failed. Please try again.');
    }
  };

  if (isLoading) return (
    <div className="flex flex-col items-center justify-center py-20 gap-4">
      <div className="w-8 h-8 border-2 border-[#161616] border-t-transparent rounded-full animate-spin"></div>
      <p className="text-[10px] font-bold text-[#161616]/40 uppercase tracking-widest">Syncing Lead Data...</p>
    </div>
  );
  
  // A read that failed is NOT a lead that was deleted. Saying so sends people
  // looking for a record that is sitting exactly where they left it.
  if (!lead && loadError) return (
    <div className="bg-white border border-amber-300 rounded-[6px] p-12 text-center shadow-sm">
      <p className="font-bold text-[#161616]/70">This lead could not be loaded.</p>
      <p className="text-[11px] text-[#161616]/50 mt-2 max-w-[420px] mx-auto leading-relaxed">
        {loadError} The lead itself is fine — this is a problem reaching the
        server, which on the free tier is usually momentary.
      </p>
      <div className="flex items-center justify-center gap-3 mt-5">
        <button
          onClick={fetchData}
          className="px-4 py-2 bg-[#161616] text-white rounded-[4px] text-[11px] font-bold uppercase tracking-widest"
        >
          Try again
        </button>
        <button
          onClick={() => navigate('/leads')}
          className="px-4 py-2 text-[11px] font-bold uppercase tracking-widest text-[#161616]/50 hover:text-[#161616]"
        >
          Back to leads
        </button>
      </div>
    </div>
  );

  if (!lead) return (
    <div className="bg-white border border-[#DFDFDF] rounded-[6px] p-12 text-center shadow-sm">
      <p className="font-bold text-[#161616]/60">Lead not found or has been deleted.</p>
      <button onClick={() => navigate('/leads')} className="mt-3 text-[11px] font-bold text-[#161616]/40 hover:text-[#161616] transition-all uppercase tracking-widest">← Back to Leads</button>
    </div>
  );

  const getUsername = (id: string) => users.find(u => u.id === id || u.username === id)?.username || id;

  return (
    <div className="flex flex-col gap-6">
      {/* Header */}
      <div className="flex justify-between items-center">
        <button onClick={() => navigate('/leads')} className="flex items-center gap-2 text-[11px] font-bold text-[#161616]/40 hover:text-[#161616] transition-colors uppercase tracking-widest">
          <ArrowLeft className="w-4 h-4" /> Back to Leads
        </button>
        <div className="flex gap-2">
          {/* Editing is open to anyone who can see the lead: the person who
              finds a wrong address is whoever is working it, and every change
              is audited with its previous value. DELETING stays with managers,
              because that is the part that cannot be undone by reading the
              history back. The server enforces both independently — showing or
              hiding a button is convenience, not the control. */}
          <button
            onClick={() => setShowEdit(true)}
            className="flex items-center gap-2 border border-[#DFDFDF] text-[#161616]/60 px-4 py-2 rounded-[6px] text-xs font-bold hover:border-[#161616]/40 transition-all"
          >
            <Pencil className="w-3.5 h-3.5" /> EDIT LEAD
          </button>
          {isManager && (
            <button
              onClick={() => setShowDelete(true)}
              className="flex items-center gap-2 border border-red-200 text-red-600 px-4 py-2 rounded-[6px] text-xs font-bold hover:bg-red-50 transition-all"
            >
              <Trash2 className="w-3.5 h-3.5" /> DELETE
            </button>
          )}
          <button
            disabled={lead.status === 'Converted'}
            onClick={() => handleRequest('payment')}
            className="flex items-center gap-2 border border-[#DFDFDF] text-[#161616]/60 px-4 py-2 rounded-[6px] text-xs font-bold hover:border-[#161616]/40 transition-all disabled:opacity-30 disabled:cursor-not-allowed"
          >
            <DollarSign className="w-3.5 h-3.5" /> REQUEST PAYMENT
          </button>
          <button 
            disabled={lead.status === 'Converted'}
            onClick={() => handleRequest('paperwork')} 
            className="flex items-center gap-2 border border-[#DFDFDF] text-[#161616]/60 px-4 py-2 rounded-[6px] text-xs font-bold hover:border-[#161616]/40 transition-all disabled:opacity-30 disabled:cursor-not-allowed"
          >
            <FileText className="w-3.5 h-3.5" /> REQUEST PAPERWORK
          </button>
          
          {lead.status !== 'Converted' && lead.status !== 'Closed' && (
            <div className="flex items-center gap-2 bg-[#161616] rounded-[6px] pl-3 pr-1 py-1 shadow-lg border border-[#161616]">
              <div className="flex items-center text-white/40 text-[10px] font-bold">$</div>
              <input 
                type="number" 
                placeholder="Value" 
                className="w-16 bg-transparent text-white text-xs border-0 focus:outline-none placeholder:text-white/20 font-bold" 
                value={dealValue || ''} 
                onChange={e => setDealValue(Number(e.target.value))}
              />
              <button 
                onClick={handleConvertToDeal}
                disabled={isConverting || !dealValue}
                className="bg-white text-[#161616] px-3 py-1 rounded-[4px] text-[10px] font-black uppercase tracking-widest hover:opacity-90 transition-all disabled:opacity-20"
              >
                {isConverting ? '...' : 'CONVERT'}
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Mandatory Action Banner: Email Sent Today -> Set Follow-Up Date Required */}
      {showMandatoryFollowUpPrompt && (
        <div className="bg-amber-50 border-2 border-amber-400 rounded-[8px] p-5 shadow-md animate-in slide-in-from-top-3 duration-200">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            <div className="flex items-start gap-3">
              <div className="p-2.5 bg-amber-500 text-white rounded-[6px] shrink-0 mt-0.5 shadow-sm">
                <Calendar className="w-5 h-5" />
              </div>
              <div>
                <div className="flex items-center gap-2">
                  <span className="bg-amber-200 text-amber-900 text-[9px] font-black px-2 py-0.5 rounded uppercase tracking-wider">
                    MANDATORY ACTION REQUIRED
                  </span>
                  <span className="text-xs font-bold text-amber-800">Email Sent Today</span>
                </div>
                <h4 className="text-sm font-black text-[#161616] tracking-tight mt-1">
                  Set Mandatory Next Follow-Up Date for {lead.name}
                </h4>
                <p className="text-xs text-[#161616]/70 mt-0.5">
                  An email was sent to this lead today. Select a follow-up date (max 3 days into future) to maintain deal momentum.
                </p>
              </div>
            </div>

            <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2 shrink-0">
              <div className="flex items-center gap-1.5">
                <button
                  type="button"
                  onClick={() => {
                    handleSetFollowUpDays(1);
                    setShowMandatoryFollowUpPrompt(false);
                  }}
                  className="px-3.5 py-2 bg-white border border-amber-300 hover:border-black text-[#161616] rounded-[6px] text-xs font-black uppercase tracking-wider transition-all cursor-pointer shadow-2xs"
                >
                  +1 Day
                </button>
                <button
                  type="button"
                  onClick={() => {
                    handleSetFollowUpDays(2);
                    setShowMandatoryFollowUpPrompt(false);
                  }}
                  className="px-3.5 py-2 bg-white border border-amber-300 hover:border-black text-[#161616] rounded-[6px] text-xs font-black uppercase tracking-wider transition-all cursor-pointer shadow-2xs"
                >
                  +2 Days
                </button>
                <button
                  type="button"
                  onClick={() => {
                    handleSetFollowUpDays(3);
                    setShowMandatoryFollowUpPrompt(false);
                  }}
                  className="px-3.5 py-2 bg-white border border-amber-300 hover:border-black text-[#161616] rounded-[6px] text-xs font-black uppercase tracking-wider transition-all cursor-pointer shadow-2xs"
                >
                  +3 Days
                </button>
              </div>

              <input
                type="date"
                min={todayStr}
                max={maxFollowUpDateStr}
                value={lead.nextFollowUp ? lead.nextFollowUp.split('T')[0] : ''}
                onChange={e => {
                  handleCustomFollowUpDate(e.target.value);
                  setShowMandatoryFollowUpPrompt(false);
                }}
                className="text-xs border border-amber-300 rounded-[6px] px-3 py-2 bg-white font-bold text-[#161616] focus:outline-none cursor-pointer"
              />
            </div>
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Left Col */}
        <div className="flex flex-col gap-4">
          {/* Profile Card */}
          <div className="bg-white border border-[#DFDFDF] rounded-[6px] p-6 flex flex-col items-center text-center shadow-sm">
            <div className="w-20 h-20 rounded-full bg-[#F9F9F9] border border-[#DFDFDF] flex items-center justify-center mb-4 text-[#161616]/20 font-black text-2xl">
              {lead.name[0]}
            </div>
            <h2 className="text-xl font-bold text-[#161616] tracking-tight">{lead.name}</h2>
            <span className={`mt-2 px-2.5 py-1 rounded-[4px] text-[10px] font-black uppercase tracking-widest ${STATUS_BADGE[lead.status]}`}>
              {lead.status}
            </span>
            <div className="w-full mt-6 pt-5 border-t border-[#DFDFDF] flex flex-col gap-4 text-left">
              <div className="group cursor-pointer">
                <p className="text-[9px] font-bold text-[#161616]/30 uppercase tracking-widest mb-1">Email Address</p>
                <div className="flex items-center gap-2 text-sm text-[#161616]/70 font-medium group-hover:text-[#161616] transition-all">
                  <Mail className="w-3.5 h-3.5" /> {lead.email}
                </div>
              </div>
              <div className="group cursor-pointer">
                <p className="text-[9px] font-bold text-[#161616]/30 uppercase tracking-widest mb-1">Phone Number</p>
                <div className="flex items-center gap-2 text-sm text-[#161616]/70 font-medium group-hover:text-[#161616] transition-all">
                  <Phone className="w-3.5 h-3.5" /> 
                  {lead.phone === '#ERROR!' ? (
                    <span className="text-red-500 font-bold text-xs bg-red-50 px-2 py-0.5 rounded border border-red-100 flex items-center gap-1">
                      #ERROR! (Prepend single quote ' to number in sheet)
                    </span>
                  ) : (
                    lead.phone
                  )}
                </div>
              </div>
              {lead.linkedin && (
                <div className="group cursor-pointer">
                  <p className="text-[9px] font-bold text-[#161616]/30 uppercase tracking-widest mb-1">LinkedIn Profile</p>
                  <a 
                    href={lead.linkedin} target="_blank" rel="noopener noreferrer"
                    className="flex items-center gap-2 text-sm text-blue-600 font-medium hover:underline transition-all"
                  >
                    <ExternalLink className="w-3.5 h-3.5" /> Profile Link
                  </a>
                </div>
              )}
              <div>
                <p className="text-[9px] font-bold text-[#161616]/30 uppercase tracking-widest mb-1">Acquisition Date</p>
                <div className="flex items-center gap-2 text-sm text-[#161616]/40 font-medium">
                  <Calendar className="w-3.5 h-3.5" /> {new Date(lead.createdAt).toLocaleDateString(undefined, { dateStyle: 'long' })}
                </div>
              </div>

              <div className="pt-4 mt-4 border-t border-[#DFDFDF] space-y-3">
                <div>
                  <p className="text-[9px] font-bold text-[#161616]/30 uppercase tracking-widest mb-1">Assigned Setter</p>
                  <div className="flex items-center gap-2 text-sm text-[#161616]/70 font-semibold uppercase tracking-tight">
                    <UserIcon className="w-3.5 h-3.5 text-[#161616]/20" /> {getUsername(lead.setterId || lead.ownerRepId)}
                  </div>
                </div>
                <div>
                  <p className="text-[9px] font-bold text-[#161616]/30 uppercase tracking-widest mb-1">Assigned Closer</p>
                  <div className="flex items-center gap-2 text-sm text-[#161616]/70 font-semibold uppercase tracking-tight">
                    <UserIcon className="w-3.5 h-3.5 text-[#161616]/20" /> {lead.closerId ? getUsername(lead.closerId) : 'Not Assigned'}
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* When the next contact is due. Recording that contact happened
              lives in the interaction composer on the right. */}
          <FollowUpPanel lead={lead} onDone={fetchData} maxDate={maxFollowUpDateStr} />



          {/* Admin Requests Status */}
          {requests.length > 0 && (
            <div className="bg-white border border-[#DFDFDF] rounded-[6px] p-5 shadow-sm">
              <h3 className="text-[10px] font-black text-[#161616] uppercase tracking-widest mb-4 flex items-center gap-2">
                <ShieldAlert className="w-3.5 h-3.5" /> Admin Fulfillment
              </h3>
              <div className="flex flex-col gap-3">
                {requests.map(r => (
                  <div key={r.id} className="p-3 rounded-[6px] bg-[#F9F9F9] border border-[#DFDFDF]">
                    <div className="flex justify-between items-center mb-2">
                      <span className="text-[10px] font-bold uppercase text-[#161616]/60">{r.type} Request</span>
                      <span className={`px-1.5 py-0.5 rounded-[3px] text-[8px] font-black uppercase tracking-tighter ${r.status === 'Approved' || r.status === 'Paid' || r.status === 'Sent' ? 'bg-[#161616] text-white' : 'bg-[#DFDFDF] text-[#161616]'}`}>
                        {r.status}
                      </span>
                    </div>
                    {r.paymentLink || r.documentUrl ? (
                      <a 
                        href={r.paymentLink || r.documentUrl} 
                        target="_blank" rel="noopener noreferrer"
                        className="flex items-center justify-center gap-2 w-full bg-[#161616] text-white py-2 rounded-[4px] text-[10px] font-bold hover:opacity-90 transition-all uppercase tracking-widest"
                      >
                        <ExternalLink className="w-3 h-3" /> OPEN {r.type.toUpperCase()}
                      </a>
                    ) : (
                      <div className="flex items-center gap-2 text-[10px] text-[#161616]/30 italic py-1">
                        <Clock className="w-3 h-3" /> Awaiting Admin...
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Status Update (Vertical Stack) */}
          {lead.status !== 'Converted' && (
            <div className="bg-white border border-[#DFDFDF] rounded-[6px] p-5 shadow-sm">
              <h3 className="text-[10px] font-black text-[#161616]/30 uppercase tracking-widest mb-4">Lifecycle Stage</h3>
              <div className="flex flex-col gap-1.5">
                {(['New', 'Contacted', 'Qualified', 'Closed'] as const).map((s) => (
                  <button 
                    key={s} 
                    onClick={() => handleUpdateStatus(s)}
                    className={`w-full py-2.5 px-4 rounded-[6px] text-xs font-bold text-left transition-all ${lead.status === s ? 'bg-[#161616] text-white shadow-md' : 'text-[#161616]/40 hover:bg-[#F9F9F9] hover:text-[#161616]'}`}
                  >
                    <div className="flex items-center justify-between">
                      <span>{s}</span>
                      {lead.status === s && <CheckCircle className="w-3.5 h-3.5" />}
                    </div>
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Management Controls */}
          {(role === 'ADMIN' || role === 'SUPER_ADMIN') && (
            <div className="bg-white border border-[#DFDFDF] rounded-[6px] p-5 shadow-sm">
              <h3 className="text-[10px] font-black text-[#161616]/30 uppercase tracking-widest mb-4">Management Controls</h3>
              <div className="space-y-4">
                <div>
                  <label className="text-[9px] font-bold text-[#161616]/30 uppercase tracking-widest block mb-1.5">Re-assign Setter</label>
                  <select 
                    value={lead.setterId || lead.ownerRepId || ''}
                    onChange={(e) => {
                      const setterId = e.target.value;
                      applyLeadChange({ setterId }, () =>
                        api.leads.update(lead.id, { setterId }));
                    }}
                    className="w-full bg-[#F9F9F9] border border-[#DFDFDF] rounded-[4px] px-3 py-2 text-xs font-bold uppercase tracking-tight focus:outline-none focus:border-[#161616]/30 transition-all"
                  >
                    <option value="">No Setter</option>
                    {users.filter(u => u.status === 'Active' && (u.role === 'SETTER' || u.role === 'SALES_REP' || u.role === 'ADMIN' || u.role === 'SUPER_ADMIN')).map(u => (
                      <option key={u.id} value={u.id}>{u.username}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="text-[9px] font-bold text-[#161616]/30 uppercase tracking-widest block mb-1.5">Assign Closer</label>
                  <select 
                    value={lead.closerId || ''}
                    onChange={(e) => {
                      const closerId = e.target.value;
                      applyLeadChange({ closerId }, () =>
                        api.leads.update(lead.id, { closerId }));
                    }}
                    className="w-full bg-[#F9F9F9] border border-[#DFDFDF] rounded-[4px] px-3 py-2 text-xs font-bold uppercase tracking-tight focus:outline-none focus:border-[#161616]/30 transition-all"
                  >
                    <option value="">No Closer Assigned</option>
                    {users.filter(u => u.status === 'Active' && (u.role === 'SALES_REP' || u.role === 'ADMIN' || u.role === 'SUPER_ADMIN')).map(u => (
                      <option key={u.id} value={u.id}>{u.username}</option>
                    ))}
                  </select>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Right Col */}
        <div className="lg:col-span-2 flex flex-col gap-4">
          {/* Interaction Timeline */}
          {/* Interaction Timeline */}
          <div className="bg-white border border-[#DFDFDF] rounded-[6px] p-6 shadow-sm min-h-[400px]">
            {/* Tabs Header */}
            <div className="flex border-b border-[#DFDFDF] mb-6">
              <button
                type="button"
                onClick={() => setActiveRightTab('activity')}
                className={`px-5 py-3 text-[10px] font-black uppercase tracking-widest border-b-2 transition-all cursor-pointer ${
                  activeRightTab === 'activity' 
                    ? 'border-[#161616] text-[#161616]' 
                    : 'border-transparent text-[#161616]/40 hover:text-[#161616]/80'
                }`}
              >
                Activity Log
              </button>
              <button
                type="button"
                onClick={() => setActiveRightTab('zoho')}
                className={`px-5 py-3 text-[10px] font-black uppercase tracking-widest border-b-2 transition-all flex items-center gap-2 cursor-pointer ${
                  activeRightTab === 'zoho' 
                    ? 'border-blue-500 text-blue-600' 
                    : 'border-transparent text-[#161616]/40 hover:text-[#161616]/80'
                }`}
              >
                <Mail className="w-3.5 h-3.5" /> Zoho Emails
              </button>
            </div>

            {activeRightTab === 'activity' ? (
              // Scroll INSIDE the panel. A busy lead can carry hundreds of
              // entries, and letting them extend the page meant scrolling
              // past the whole timeline to reach anything below it.
              <div className="flex flex-col gap-8 relative ml-2 max-h-[600px] overflow-y-auto pr-2">
                <div className="absolute left-[7px] top-2 bottom-2 w-px bg-[#DFDFDF]"></div>
                {logs.length === 0 ? (
                  <div className="text-[11px] text-[#161616]/30 italic ml-6">No operational logs recorded.</div>
                ) : (
                  // Newest first. The backend already returns them that way,
                  // and this used to `.reverse()` it — so the thing that just
                  // happened sat at the bottom of a scrolling panel and you
                  // had to scroll to find it. Sorted explicitly rather than
                  // trusting the server's order, so the display cannot quietly
                  // flip if that ever changes.
                  logs
                    .slice()
                    .sort((a, b) =>
                      new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())
                    .map((item) => (
                    <div key={item.id} className="flex gap-6 relative group">
                      <div className={`w-3.5 h-3.5 rounded-full shrink-0 mt-1 z-10 border-2 transition-all group-hover:scale-125 ${
                        item.action.includes('SYSTEM') || item.action.includes('STATUS_CHANGE') 
                          ? 'border-[#DFDFDF] bg-white' 
                          : 'border-[#161616] bg-[#161616]'
                      }`}></div>
                      <div className="flex-1">
                        <div className="flex justify-between items-baseline mb-2">
                          <div className="flex items-center gap-2">
                            <span className="text-xs font-black uppercase tracking-wider text-[#161616]">{item.action}</span>
                            <span className="text-[10px] font-bold text-[#161616]/40 uppercase">
                              by {item.userId === user?.id ? 'You' : getUsername(item.userId)}
                            </span>
                          </div>
                          <span className="text-[10px] font-mono text-[#161616]/30">{new Date(item.timestamp).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })}</span>
                        </div>
                        <div className={`bg-[#F9F9F9] border border-[#DFDFDF] rounded-[8px] p-4 text-sm text-[#161616]/70 leading-relaxed whitespace-pre-wrap ${item.action === 'GUIDANCE' ? 'border-l-4 border-l-[#161616]' : ''}`}>
                          {item.details}
                        </div>
                      </div>
                    </div>
                  ))
                )}
              </div>
            ) : (
              // Zoho Emails Tab Content
              //
              // Three genuinely different situations, told apart. They used to
              // share one message — "Zoho Mail Not Linked" — which sent people
              // to reconnect a working account because the LEAD happened to
              // have no email address.
              <div className="flex flex-col gap-6">
                {/*
                  A refresh token exists, so the account reads as "linked" —
                  Zoho simply no longer honours it. Saying "not linked" would
                  send someone to check a setting that looks correct. Shown
                  ABOVE the viewer rather than instead of it, because the
                  archived conversation is still perfectly readable.
                */}
                {zohoExpired && (
                  <div className="flex items-start gap-3 bg-amber-50 border border-amber-300 rounded-[8px] px-4 py-3">
                    <Mail className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
                    <div className="min-w-0">
                      <h4 className="text-[10px] font-black text-amber-800 uppercase tracking-widest mb-1">
                        Zoho Mail connection expired
                      </h4>
                      <p className="text-[11px] text-[#161616]/60 leading-relaxed">
                        {zohoExpired} Mail already archived in the CRM is still shown
                        below; new mail will not appear until you reconnect from the
                        Dashboard.
                      </p>
                    </div>
                  </div>
                )}

                {/*
                  Not having YOUR OWN mailbox linked does not make the lead's
                  correspondence invisible: the archive belongs to the lead, not
                  to a mailbox, and a manager reviewing a rep's lead has every
                  right to read it.

                  This used to replace the viewer entirely, so an Admin who had
                  never linked Zoho saw an empty tab on a lead with a full
                  history — the mail was in the CRM the whole time. It is a
                  notice now, not a wall.
                */}
                {!isZohoLinked && (
                  <div className="flex items-start gap-3 bg-[#F9F9F9] border border-dashed border-[#DFDFDF] rounded-[8px] px-4 py-3">
                    <Mail className="w-4 h-4 text-[#161616]/30 shrink-0 mt-0.5" />
                    <div className="min-w-0">
                      <h4 className="text-[10px] font-black text-[#161616]/70 uppercase tracking-widest mb-1">
                        Your Zoho Mail is not linked
                      </h4>
                      <p className="text-[11px] text-[#161616]/50 leading-relaxed">
                        Mail already archived in the CRM is shown below. Connect your
                        own Zoho Business Mail from the Dashboard to send from here and
                        to pull in new messages. Each person links their own mailbox.
                      </p>
                    </div>
                  </div>
                )}

                {!looksLikeEmail(lead.email) ? (
                  <div className="flex flex-col items-center justify-center py-20 text-center gap-4 bg-[#F9F9F9] border border-dashed border-[#DFDFDF] rounded-[8px] px-6">
                    <Mail className="w-10 h-10 text-[#161616]/20" />
                    <div>
                      <h4 className="text-xs font-bold text-[#161616] uppercase tracking-widest mb-1.5">This lead has no email address</h4>
                      <p className="text-[11px] text-[#161616]/40 max-w-[300px] leading-relaxed mx-auto">
                        There is no address on this record to hold a conversation
                        with.
                        {lead.email ? ` The contact field currently reads "${lead.email}".` : ''}
                        {isManager ? ' Add one with Edit Lead.' : ''}
                      </p>
                    </div>
                  </div>
                ) : (
                  <ZohoEmailViewer
                    emails={zohoEmails}
                    leadId={lead.id}
                    leadEmail={lead.email}
                    leadName={lead.name}
                    crmLogs={logs}
                    onRefresh={refreshZohoEmails}
                    isRefreshing={isFetchingZoho}
                  />
                )}
              </div>
            )}
          </div>

          {/* Log Action Box */}
          {lead.status !== 'Converted' && (
            <>
              {activeRightTab === 'activity' ? (
                // The one place contact is recorded. It both writes the log
                // entry and advances the follow-up, which used to require two
                // different forms on opposite sides of this page.
                <>
                  <InteractionComposer
                    lead={lead}
                    maxDate={maxFollowUpDateStr}
                    onDone={fetchData}
                  />
                  {/* Read while you write the log entry: what was found out
                      about this company and why it was worth approaching.
                      It sat in the left column, far from the box where that
                      context is actually used. */}
                  <ResearchPanel lead={lead} users={users} onSaved={fetchData} />
                </>
              ) : (
                // Composing needs both: a mailbox to send from, and somewhere
                // to send it.
                isZohoLinked && looksLikeEmail(lead.email) && (
                  <EmailComposer
                    leadId={lead.id}
                    leadEmail={lead.email}
                    leadName={lead.name}
                    onSent={() => {
                      // The backend already logged EMAIL_SENT and archived the
                      // message; reload so both show up here.
                      setShowMandatoryFollowUpPrompt(true);
                      fetchData();
                    }}
                  />
                )
              )}
            </>
          )}
        </div>
      </div>

      {showEdit && (
        <EditLeadModal
          lead={lead}
          onClose={() => setShowEdit(false)}
          onSaved={fetchData}
        />
      )}

      {showDelete && (
        <DeleteLeadModal
          lead={lead}
          onClose={() => setShowDelete(false)}
          // The lead is no longer visible in the CRM, so there is nothing left
          // to show on this page — go back to the list.
          onDeleted={() => navigate('/leads')}
        />
      )}

      {/*
        Asked for only when the server says one is owed: the follow-up has been
        overdue for more than a day and the date is being pushed out.
      */}
      {delayPrompt && (
        <FollowUpDelayPrompt
          message={delayPrompt.message}
          error={delayPrompt.error}
          onCancel={() => setDelayPrompt(null)}
          onSubmit={(reason) => saveFollowUpDate(delayPrompt.date, reason)}
        />
      )}
    </div>
  );
};
