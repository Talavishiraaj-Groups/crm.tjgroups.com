import React, { useState, useCallback } from 'react';
import { ZohoEmailItem, Log } from '../../types';
import { api } from '../../api/services';
import { ApiError } from '../../api/errors';
import { decodeHtmlEntities, stripHtmlTags, isHtmlContent } from '../../utils/htmlUtils';
import { 
  Mail, Search, RefreshCw, ChevronDown, ChevronUp, 
  Maximize2, Copy, Check, X, ArrowUpRight, ArrowDownLeft, Clock, Eye, FileText, CheckCircle2, Type
} from 'lucide-react';

/**
 * Render an email address the way a person writes it.
 *
 * Zoho returns addresses HTML-escaped and angle-wrapped, so the raw value is
 * literally `&lt;someone@example.com&gt;`. Only the subject was being decoded,
 * so every From/To line showed the entities verbatim.
 */
function formatAddress(value?: string): string {
  const decoded = decodeHtmlEntities(String(value || '')).trim();
  if (!decoded) return '';
  // `"Name" <addr>` keeps the name; a bare `<addr>` loses the brackets.
  const wrapped = decoded.match(/^<([^>]+)>$/);
  return wrapped ? wrapped[1] : decoded;
}
interface ZohoEmailViewerProps {
  emails: ZohoEmailItem[];
  /** Needed to authorise fetching a message body. */
  leadId: string;
  leadEmail: string;
  leadName: string;
  crmLogs?: Log[];
  onRefresh: () => void;
  isRefreshing?: boolean;
}

export const ZohoEmailViewer: React.FC<ZohoEmailViewerProps> = ({
  emails,
  leadId,
  leadEmail,
  leadName,
  crmLogs = [],
  onRefresh,
  isRefreshing = false
}) => {
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());
  const [selectedEmail, setSelectedEmail] = useState<ZohoEmailItem | null>(null);

  /**
   * Full bodies fetched on demand, keyed by message id.
   *
   * Neither a search result nor an archived row carries the whole message —
   * both hold Zoho's summary, which is truncated. "Full view" was therefore
   * showing a cut-off paragraph and calling it the full text. The real body
   * costs a Zoho round trip, so it is fetched when a message is opened and
   * then remembered.
   */
  const [bodies, setBodies] = useState<Record<string, { text: string; complete: boolean; note?: string }>>({});
  const [loadingBody, setLoadingBody] = useState<string | null>(null);

  const loadFullBody = useCallback(async (item: ZohoEmailItem) => {
    const key = item.messageId || item.id;
    if (!key || bodies[key] || loadingBody === key) return;
    setLoadingBody(key);
    try {
      const res = await api.zoho.getEmailContent(key, { leadId });
      setBodies((prev) => ({
        ...prev,
        [key]: { text: res.content, complete: res.complete, note: res.note },
      }));
    } catch (err) {
      // Keep the summary on screen — it is better than nothing — but record
      // that this is NOT the full message. Silently showing a truncated
      // preview as though it were the whole email is the actual bug: the
      // reader has no way to know they are missing the end of it.
      setBodies((prev) => ({
        ...prev,
        [key]: {
          text: '',
          complete: false,
          note: err instanceof ApiError && err.code === 'UNKNOWN_ACTION'
            ? 'The backend does not support loading full messages yet. Deploy ' +
              'a new Apps Script version to enable it.'
            : 'The full message could not be loaded from the mailbox.',
        },
      }));
    } finally {
      setLoadingBody(null);
    }
  }, [bodies, loadingBody, leadId]);
  const [modalTab, setModalTab] = useState<'preview' | 'text'>('preview');
  const [fontSize, setFontSize] = useState<'normal' | 'large'>('normal');
  const [searchQuery, setSearchQuery] = useState('');
  const [sortOrder, setSortOrder] = useState<'newest' | 'oldest'>('newest');
  const [copied, setCopied] = useState(false);

  const toggleExpand = (id: string) => {
    setExpandedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  };

  const handleCopyText = (text: string) => {
    navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  /**
   * Resolves 100% full-length email body content by checking Zoho Mail content 
   * and cross-referencing with recorded CRM logs if Zoho returned only summary.
   */
  const getResolvedFullBody = (item: ZohoEmailItem): { body: string; isFromLog: boolean } => {
    // A body fetched from the mailbox wins over everything else: the other
    // sources are Zoho's truncated summary.
    const fetched = bodies[item.messageId || item.id];
    if (fetched && fetched.complete && fetched.text) {
      return { body: decodeHtmlEntities(fetched.text), isFromLog: false };
    }
    // An INCOMPLETE result is still better than the list summary if it is
    // longer, but it must not be treated as the whole message.
    if (fetched && fetched.text && fetched.text.length > (item.content || '').length) {
      return { body: decodeHtmlEntities(fetched.text), isFromLog: false };
    }

    let body = item.content || item.summary || '';
    let isFromLog = false;

    if (crmLogs && crmLogs.length > 0) {
      const subjectClean = decodeHtmlEntities(item.subject || '').trim().toLowerCase();
      const match = crmLogs.find(l => {
        if (!l.details) return false;
        const det = l.details.toLowerCase();
        return subjectClean && det.includes(subjectClean);
      });

      if (match) {
        // Extract text after subject tag if present
        let extracted = match.details;
        const closingBracket = extracted.indexOf(']');
        if (closingBracket !== -1 && closingBracket < 150) {
          extracted = extracted.substring(closingBracket + 1).trim();
        } else if (extracted.startsWith('Sent email via Zoho:')) {
          extracted = extracted.replace(/^Sent email via Zoho:\s*/i, '').trim();
        }

        if (extracted.length > body.length) {
          body = extracted;
          isFromLog = true;
        }
      }
    }

    return {
      body: decodeHtmlEntities(body),
      isFromLog
    };
  };

  // Combine Zoho API emails with any logged emails in CRM logs
  const allEmails = [...emails];
  if (crmLogs && crmLogs.length > 0) {
    const existingSubjects = new Set(allEmails.map(e => decodeHtmlEntities(e.subject || '').trim().toLowerCase()));

    crmLogs.forEach(log => {
      // Normalise first. This read `log.details.match(...)` after a condition
      // that could pass on `action === 'EMAIL'` alone, so a legacy row with an
      // empty Details cell threw during render and blanked the whole tab.
      const details = log.details ?? '';
      const isEmailish = log.action === 'EMAIL' ||
        details.includes('Sent email via Zoho') || details.includes('Subject:');

      if (isEmailish) {
        let subject = 'Email Activity';
        let content = details;

        const subjectMatch = details.match(/\[Subject:\s*([^\]]+)\]/i);
        if (subjectMatch) {
          subject = subjectMatch[1].trim();
          const bracketIdx = details.indexOf(']');
          content = details.substring(bracketIdx + 1).trim();
        } else if (details.startsWith('Sent email via Zoho:')) {
          content = details.replace(/^Sent email via Zoho:\s*/i, '').trim();
        }

        const normSubject = subject.trim().toLowerCase();
        if (!existingSubjects.has(normSubject)) {
          existingSubjects.add(normSubject);
          allEmails.push({
            id: `log-email-${log.id}`,
            subject,
            summary: content,
            content,
            sender: 'CRM User / Rep',
            toAddress: leadEmail,
            direction: 'out',
            timestamp: log.timestamp || new Date().toISOString()
          });
        }
      }
    });
  }

  // Filter & Sort
  const filteredEmails = allEmails.filter(email => {
    const query = searchQuery.toLowerCase().trim();
    if (!query) return true;
    const subject = decodeHtmlEntities(email.subject || '').toLowerCase();
    const summary = stripHtmlTags(email.summary || '').toLowerCase();
    const content = stripHtmlTags(email.content || '').toLowerCase();
    const sender = (email.sender || '').toLowerCase();
    return subject.includes(query) || summary.includes(query) || content.includes(query) || sender.includes(query);
  });

  const storedCount = allEmails.filter(e => e.stored).length;

  const sortedEmails = [...filteredEmails].sort((a, b) => {
    const timeA = new Date(a.timestamp).getTime();
    const timeB = new Date(b.timestamp).getTime();
    return sortOrder === 'newest' ? timeB - timeA : timeA - timeB;
  });

  return (
    <div className="flex flex-col gap-5">
      {/* Header controls bar */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 bg-[#F9F9F9] border border-[#DFDFDF] p-3 rounded-[8px]">
        <div className="flex items-center gap-2">
          <span className="bg-blue-100 text-blue-800 text-[10px] font-black px-2 py-1 rounded-[4px] uppercase tracking-wider flex items-center gap-1">
            <Mail className="w-3.5 h-3.5" /> {allEmails.length} {allEmails.length === 1 ? 'EMAIL' : 'EMAILS'} SYNCED
          </span>
          {storedCount > 0 && (
            <span
              className="bg-amber-100 text-amber-900 text-[10px] font-black px-2 py-1 rounded-[4px] uppercase tracking-wider"
              title="These are held in the CRM rather than read live from the mailbox. They keep the conversation intact, but hold only the envelope and a summary."
            >
              {storedCount} FROM CRM ARCHIVE
            </span>
          )}
          <span className="text-[11px] text-[#161616]/50 font-medium">with {leadName} ({leadEmail})</span>
        </div>

        <div className="flex items-center gap-2 shrink-0">
          {/* Search box */}
          <div className="relative flex-1 sm:w-48">
            <Search className="w-3.5 h-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-[#161616]/30" />
            <input
              type="text"
              placeholder="Search emails..."
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
              className="w-full pl-8 pr-3 py-1.5 bg-white border border-[#DFDFDF] rounded-[6px] text-xs font-medium text-[#161616] focus:outline-none focus:border-blue-500 placeholder:text-[#161616]/30"
            />
            {searchQuery && (
              <button 
                onClick={() => setSearchQuery('')}
                className="absolute right-2 top-1/2 -translate-y-1/2 text-[#161616]/30 hover:text-[#161616]"
              >
                <X className="w-3 h-3" />
              </button>
            )}
          </div>

          {/* Sort button */}
          <button
            onClick={() => setSortOrder(prev => prev === 'newest' ? 'oldest' : 'newest')}
            className="px-2.5 py-1.5 bg-white border border-[#DFDFDF] hover:border-[#161616] rounded-[6px] text-[10px] font-bold uppercase tracking-wider text-[#161616]/70 transition-all cursor-pointer"
            title="Toggle sort order"
          >
            {sortOrder === 'newest' ? 'Newest First' : 'Oldest First'}
          </button>

          {/* Refresh button */}
          <button
            onClick={onRefresh}
            disabled={isRefreshing}
            className="p-1.5 bg-white border border-[#DFDFDF] hover:border-blue-500 text-blue-600 rounded-[6px] transition-all cursor-pointer disabled:opacity-40"
            title="Sync Latest Emails from Zoho Mail"
          >
            <RefreshCw className={`w-4 h-4 ${isRefreshing ? 'animate-spin' : ''}`} />
          </button>
        </div>
      </div>

      {/* Emails Timeline List */}
      {sortedEmails.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-16 text-center gap-3 bg-[#F9F9F9] border border-dashed border-[#DFDFDF] rounded-[8px] px-6">
          <Mail className="w-8 h-8 text-[#161616]/20" />
          <p className="text-xs font-bold text-[#161616]/50 uppercase tracking-wider">
            {searchQuery ? 'No emails matching your search' : 'No email conversations found'}
          </p>
          {searchQuery && (
            <button 
              onClick={() => setSearchQuery('')}
              className="text-[11px] font-bold text-blue-600 hover:underline uppercase tracking-wider"
            >
              Clear Search
            </button>
          )}
        </div>
      ) : (
        <div className="flex flex-col gap-4 relative ml-2 max-h-[600px] overflow-y-auto pr-2">
          <div className="absolute left-[7px] top-3 bottom-3 w-px bg-[#DFDFDF]"></div>

          {sortedEmails.map((item) => {
            const isExpanded = expandedIds.has(item.id);
            const isIncoming = item.direction === 'in';
            const decodedSubject = decodeHtmlEntities(item.subject || '(No Subject)');
            const { body: resolvedBody } = getResolvedFullBody(item);
            const plainTextFull = stripHtmlTags(resolvedBody);
            const hasRichHtml = isHtmlContent(resolvedBody);

            return (
              <div key={item.id} className="flex gap-4 sm:gap-6 relative group">
                {/* Status Dot */}
                <div className={`w-3.5 h-3.5 rounded-full shrink-0 mt-3.5 z-10 border-2 transition-all group-hover:scale-125 ${
                  isIncoming 
                    ? 'border-emerald-500 bg-emerald-500 shadow-sm' 
                    : 'border-blue-500 bg-blue-500 shadow-sm'
                }`}></div>

                {/* Email Card Container */}
                <div className="flex-1 bg-white border border-[#DFDFDF] hover:border-[#161616]/30 rounded-[10px] shadow-sm transition-all overflow-hidden">
                  {/* Top Badge Bar */}
                  <div className={`px-4 py-2.5 border-b border-[#DFDFDF] flex flex-wrap justify-between items-center gap-2 ${
                    isIncoming ? 'bg-emerald-50/40' : 'bg-blue-50/40'
                  }`}>
                    <div className="flex items-center gap-2">
                      <span className={`px-2 py-0.5 rounded-[4px] text-[9px] font-black uppercase tracking-wider flex items-center gap-1 ${
                        isIncoming ? 'bg-emerald-100 text-emerald-800' : 'bg-blue-100 text-blue-800'
                      }`}>
                        {isIncoming ? (
                          <><ArrowDownLeft className="w-3 h-3" /> RECEIVED</>
                        ) : (
                          <><ArrowUpRight className="w-3 h-3" /> SENT</>
                        )}
                      </span>

                      <span
                        className="text-[8px] font-black bg-gray-200 text-gray-700 px-1.5 py-0.5 rounded-[3px] uppercase tracking-wider"
                        title={item.stored
                          ? 'Held in the CRM. Kept even if the message leaves the mailbox — envelope and summary only.'
                          : 'Read live from Zoho Mail.'}
                      >
                        {item.stored ? 'Saved in CRM' : 'Zoho Mail'}
                      </span>

                      {bodies[item.messageId || item.id]?.complete && (
                        <span className="text-[8px] font-black bg-emerald-100 text-emerald-800 px-1.5 py-0.5 rounded-[3px] uppercase tracking-wider flex items-center gap-1">
                          <CheckCircle2 className="w-2.5 h-2.5" /> Full Body Synced
                        </span>
                      )}

                      <span className="text-[11px] font-bold text-[#161616]/60 truncate max-w-[240px]">
                        {isIncoming ? `From: ${formatAddress(item.sender) || leadEmail}` : `To: ${formatAddress(item.toAddress) || leadEmail}`}
                      </span>
                    </div>

                    <div className="flex items-center gap-2">
                      <span className="text-[10px] font-mono text-[#161616]/40 flex items-center gap-1">
                        <Clock className="w-3 h-3" />
                        {new Date(item.timestamp).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })}
                      </span>
                    </div>
                  </div>

                  {/* Subject and Body */}
                  <div className="p-4">
                    <h4 className="text-sm font-bold text-[#161616] tracking-tight mb-2">
                      {decodedSubject}
                    </h4>

                    {/* Content Preview or Expanded Full Text */}
                    {isExpanded ? (
                      <div className="mt-3 pt-3 border-t border-[#DFDFDF]/80">
                        {hasRichHtml ? (
                          <div className="bg-[#FDFDFD] border border-[#DFDFDF] rounded-[6px] p-4 text-xs max-h-[500px] overflow-y-auto">
                            <div className="prose prose-sm max-w-none text-[#161616] leading-relaxed font-sans" dangerouslySetInnerHTML={{ __html: resolvedBody }} />
                          </div>
                        ) : (
                          <div className="bg-[#F9F9F9] border border-[#DFDFDF] rounded-[6px] p-4 text-xs font-mono text-[#161616] leading-relaxed whitespace-pre-wrap max-h-[400px] overflow-y-auto">
                            {plainTextFull}
                          </div>
                        )}
                      </div>
                    ) : (
                      <p className="text-xs text-[#161616]/80 leading-relaxed font-normal line-clamp-3">
                        {plainTextFull}
                      </p>
                    )}
                  </div>

                  {/* Card Footer Actions */}
                  <div className="px-4 py-2.5 bg-[#F9F9F9] border-t border-[#DFDFDF] flex items-center justify-between text-xs">
                    <button
                      onClick={() => { toggleExpand(item.id); loadFullBody(item); }}
                      className="flex items-center gap-1.5 text-[10px] font-black text-[#161616]/60 hover:text-[#161616] uppercase tracking-wider cursor-pointer transition-colors"
                    >
                      {isExpanded ? (
                        <><ChevronUp className="w-3.5 h-3.5" /> Collapse View</>
                      ) : (
                        <><ChevronDown className="w-3.5 h-3.5" /> Inline Expand</>
                      )}
                    </button>

                    <button
                      onClick={() => {
                        setSelectedEmail(item);
                        setModalTab(hasRichHtml ? 'preview' : 'text');
                        loadFullBody(item);
                      }}
                      className="flex items-center gap-1.5 px-3.5 py-1.5 bg-[#161616] hover:bg-[#161616]/90 text-white rounded-[6px] text-[10px] font-black uppercase tracking-wider transition-all cursor-pointer shadow-sm"
                    >
                      <Maximize2 className="w-3 h-3 text-blue-400" /> FULL VIEW OPTION
                    </button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* FULL END-TO-END EMAIL VIEW MODAL */}
      {selectedEmail && (() => {
        const { body: resolvedBody } = getResolvedFullBody(selectedEmail);
        const decodedSubject = decodeHtmlEntities(selectedEmail.subject || '(No Subject)');
        const plainTextFull = stripHtmlTags(resolvedBody);
        const hasRichHtml = isHtmlContent(resolvedBody);

        return (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 sm:p-6 bg-black/60 backdrop-blur-xs animate-in fade-in duration-150">
            <div className="bg-white rounded-[12px] shadow-2xl border border-[#DFDFDF] w-full max-w-4xl max-h-[92vh] flex flex-col overflow-hidden">
              {/* Modal Header */}
              <div className="px-6 py-4 bg-[#161616] text-white flex items-center justify-between shrink-0">
                <div className="flex items-center gap-3">
                  <div className={`p-2.5 rounded-[8px] ${selectedEmail.direction === 'in' ? 'bg-emerald-500' : 'bg-blue-500'}`}>
                    <Mail className="w-4 h-4 text-white" />
                  </div>
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="text-[10px] font-black uppercase tracking-widest text-white/40">
                        Zoho Email Full End-to-End View
                      </span>
                      {bodies[selectedEmail.messageId || selectedEmail.id]?.complete && (
                        <span className="text-[8px] font-black bg-emerald-500/20 text-emerald-300 border border-emerald-500/40 px-1.5 py-0.5 rounded uppercase tracking-wider">
                          Full Body Verified
                        </span>
                      )}
                    </div>
                    <h3 className="text-base font-bold text-white tracking-tight mt-0.5">
                      {decodedSubject}
                    </h3>
                  </div>
                </div>

                <button
                  onClick={() => setSelectedEmail(null)}
                  className="p-2 text-white/50 hover:text-white hover:bg-white/10 rounded-[6px] transition-all cursor-pointer"
                  title="Close Modal"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>

              {/* Email Metadata Details Header */}
              <div className="px-6 py-4 bg-[#F9F9F9] border-b border-[#DFDFDF] grid grid-cols-1 sm:grid-cols-2 gap-4 text-xs shrink-0">
                <div>
                  <span className="text-[9px] font-bold text-[#161616]/40 uppercase tracking-widest block mb-0.5">Sender (From)</span>
                  <span className="font-semibold text-[#161616] text-xs">{formatAddress(selectedEmail.sender) || (selectedEmail.direction === 'in' ? leadEmail : 'You')}</span>
                </div>
                <div>
                  <span className="text-[9px] font-bold text-[#161616]/40 uppercase tracking-widest block mb-0.5">Recipient (To)</span>
                  <span className="font-semibold text-[#161616] text-xs">{formatAddress(selectedEmail.toAddress) || (selectedEmail.direction === 'out' ? leadEmail : 'You')}</span>
                </div>
                <div>
                  <span className="text-[9px] font-bold text-[#161616]/40 uppercase tracking-widest block mb-0.5">Timestamp</span>
                  <span className="font-medium text-[#161616]/80 text-xs">{new Date(selectedEmail.timestamp).toLocaleString(undefined, { dateStyle: 'full', timeStyle: 'medium' })}</span>
                </div>
                <div>
                  <span className="text-[9px] font-bold text-[#161616]/40 uppercase tracking-widest block mb-0.5">Communication Direction</span>
                  <span className={`inline-flex items-center gap-1 font-bold text-[10px] uppercase px-2 py-0.5 rounded ${
                    selectedEmail.direction === 'in' ? 'bg-emerald-100 text-emerald-800' : 'bg-blue-100 text-blue-800'
                  }`}>
                    {selectedEmail.direction === 'in' ? 'Incoming Email from Client' : 'Outgoing Email to Client'}
                  </span>
                </div>
              </div>

              {/* Controls Bar: Format Tabs + Font Size Switcher + Copy */}
              <div className="px-6 py-2 border-b border-[#DFDFDF] bg-white flex flex-wrap justify-between items-center gap-3 shrink-0">
                <div className="flex gap-2">
                  {hasRichHtml && (
                    <button
                      onClick={() => setModalTab('preview')}
                      className={`py-2 px-3 text-[10px] font-black uppercase tracking-wider border-b-2 transition-all flex items-center gap-1.5 cursor-pointer ${
                        modalTab === 'preview' ? 'border-[#161616] text-[#161616]' : 'border-transparent text-[#161616]/40 hover:text-[#161616]'
                      }`}
                    >
                      <Eye className="w-3.5 h-3.5" /> Formatted View
                    </button>
                  )}
                  <button
                    onClick={() => setModalTab('text')}
                    className={`py-2 px-3 text-[10px] font-black uppercase tracking-wider border-b-2 transition-all flex items-center gap-1.5 cursor-pointer ${
                      modalTab === 'text' || !hasRichHtml ? 'border-[#161616] text-[#161616]' : 'border-transparent text-[#161616]/40 hover:text-[#161616]'
                    }`}
                  >
                    <FileText className="w-3.5 h-3.5" /> Full Text View
                  </button>
                </div>

                <div className="flex items-center gap-3">
                  {/* Font Size Toggle */}
                  <div className="flex items-center gap-1 bg-[#F9F9F9] border border-[#DFDFDF] p-1 rounded-[5px]">
                    <Type className="w-3 h-3 text-[#161616]/40 ml-1" />
                    <button
                      onClick={() => setFontSize('normal')}
                      className={`px-2 py-0.5 text-[9px] font-bold uppercase rounded ${
                        fontSize === 'normal' ? 'bg-white text-[#161616] shadow-2xs' : 'text-[#161616]/40 hover:text-[#161616]'
                      }`}
                    >
                      Normal
                    </button>
                    <button
                      onClick={() => setFontSize('large')}
                      className={`px-2 py-0.5 text-[9px] font-bold uppercase rounded ${
                        fontSize === 'large' ? 'bg-white text-[#161616] shadow-2xs' : 'text-[#161616]/40 hover:text-[#161616]'
                      }`}
                    >
                      Large
                    </button>
                  </div>

                  {/* Copy Button */}
                  <button
                    onClick={() => handleCopyText(plainTextFull)}
                    className="flex items-center gap-1.5 text-[10px] font-bold text-[#161616]/70 hover:text-[#161616] px-3 py-1 bg-[#F9F9F9] border border-[#DFDFDF] rounded-[5px] cursor-pointer transition-colors"
                  >
                    {copied ? <><Check className="w-3 h-3 text-green-600" /> Copied!</> : <><Copy className="w-3 h-3" /> Copy Full Text</>}
                  </button>
                </div>
              </div>

              {/* Modal Main Body Content Display */}
              <div className="p-6 overflow-y-auto flex-1 bg-white min-h-[300px]">
                {modalTab === 'preview' && hasRichHtml ? (
                  <div className="w-full rounded-[8px] border border-[#DFDFDF] overflow-hidden bg-white p-5 min-h-[250px]">
                    <div 
                      className={`prose max-w-none text-[#161616] leading-relaxed font-sans ${fontSize === 'large' ? 'text-base' : 'text-sm'}`}
                      dangerouslySetInnerHTML={{ __html: resolvedBody }} 
                    />
                  </div>
                ) : (
                  <div className={`w-full p-6 bg-[#F9F9F9] border border-[#DFDFDF] rounded-[8px] text-[#161616] leading-relaxed whitespace-pre-wrap font-sans ${
                    fontSize === 'large' ? 'text-base leading-loose' : 'text-sm leading-relaxed'
                  }`}>
                    {plainTextFull}
                  </div>
                )}
              </div>

              {/* Modal Footer */}
              <div className="px-6 py-3.5 bg-[#F9F9F9] border-t border-[#DFDFDF] flex justify-between items-center shrink-0">
                {(() => {
                  const key = selectedEmail.messageId || selectedEmail.id;
                  const loaded = bodies[key];
                  if (loadingBody === key) {
                    return (
                      <span className="text-[10px] font-bold text-[#161616]/50">
                        Loading the full message…
                      </span>
                    );
                  }
                  // "Full message" is a claim, and it was being made whenever
                  // any text existed — including a 249-character summary.
                  // Only say it when the backend confirmed the body is whole.
                  if (loaded && loaded.complete && loaded.text) {
                    return (
                      <span className="text-[10px] font-mono text-[#161616]/40">
                        Full message · {plainTextFull.length} characters
                      </span>
                    );
                  }
                  // No full body: say so rather than implying this is all of it.
                  return (
                    <span className="text-[10px] font-bold text-amber-700">
                      Preview only — this is the start of the message, not all of it
                      {loaded && loaded.note ? `. ${loaded.note}` : '.'}
                    </span>
                  );
                })()}
                <button
                  onClick={() => setSelectedEmail(null)}
                  className="px-6 py-2.5 bg-[#161616] text-white rounded-[6px] text-xs font-bold uppercase tracking-wider hover:opacity-90 transition-all cursor-pointer shadow-md"
                >
                  Close View
                </button>
              </div>
            </div>
          </div>
        );
      })()}
    </div>
  );
};
