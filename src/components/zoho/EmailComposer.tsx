import React, { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '../../api/services';
import { EmailDraft } from '../../types';
import { stripHtmlTags } from '../../utils/htmlUtils';
import { RichTextEditor } from './RichTextEditor';
import {
  Send, Save, Trash2, FileEdit, Check, AlertTriangle, Loader2, X,
  Paperclip, File as FileIcon,
} from 'lucide-react';

interface EmailComposerProps {
  leadId: string;
  leadEmail: string;
  leadName: string;
  /** Called after a message actually leaves the mailbox. */
  onSent: () => void;
}

/** Idle time before an unsaved draft is written to the CRM. */
const AUTOSAVE_IDLE_MS = 5000;

/**
 * Kept below the backend's ceiling on purpose. Base64 inflates a file by about
 * a third, so refusing here — where we can name the file — is friendlier than
 * letting the server reject the whole message after the upload.
 */
const MAX_ATTACHMENT_BYTES = 5 * 1024 * 1024;
const MAX_ATTACHMENT_COUNT = 5;

interface PendingAttachment {
  name: string;
  mimeType: string;
  size: number;
  /** base64, without the data: prefix. */
  data: string;
}

const readAsBase64 = (file: File): Promise<string> =>
  new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error(`Could not read ${file.name}.`));
    reader.onload = () => {
      const result = String(reader.result || '');
      const comma = result.indexOf(',');
      resolve(comma === -1 ? result : result.slice(comma + 1));
    };
    reader.readAsDataURL(file);
  });

const formatBytes = (n: number) =>
  n >= 1024 * 1024 ? `${(n / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`;

/**
 * Compose, save and send email for one lead.
 *
 * Drafts live in the CRM rather than in Zoho's drafts folder, so a half-written
 * reply stays next to the lead it belongs to and survives a browser refresh,
 * a lost connection, or the tab being closed.
 *
 * Autosave is deliberately lazy — it fires only after typing stops and only
 * when the text actually changed. Every save is a Sheets write on a free-tier
 * backend, so saving on each keystroke would be expensive for no benefit.
 */
export const EmailComposer: React.FC<EmailComposerProps> = ({
  leadId, leadEmail, leadName, onSent,
}) => {
  const [subject, setSubject] = useState('');
  const [body, setBody] = useState('');
  const [drafts, setDrafts] = useState<EmailDraft[]>([]);
  const [isSending, setIsSending] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState('');
  const [showDrafts, setShowDrafts] = useState(false);

  /**
   * What the server last confirmed it holds. Kept as state rather than a ref
   * because the "unsaved changes" indicator is derived from it during render.
   */
  const [saved, setSaved] = useState({ id: '', subject: '', body: '', at: '' });

  /**
   * Attachments live only in this tab. They are deliberately NOT written into
   * the draft: a draft is a row in a spreadsheet, and putting a 5 MB base64
   * blob in a cell would be both slow and fragile. Reopening a draft therefore
   * restores the text and asks for the files again, which the hint says out
   * loud rather than leaving the user to discover it after sending.
   */
  const [attachments, setAttachments] = useState<PendingAttachment[]>([]);

  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  const loadDrafts = useCallback(async () => {
    try {
      setDrafts(await api.zoho.getDrafts(leadId));
    } catch {
      // Drafts are a convenience; failing to list them must not break sending.
    }
  }, [leadId]);

  useEffect(() => {
    // Reads the draft list on mount. State lands after the request resolves,
    // never synchronously during the effect.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    loadDrafts();
  }, [loadDrafts]);

  const persist = useCallback(async (nextSubject: string, nextBody: string) => {
    if (!nextSubject.trim() && !stripHtmlTags(nextBody).trim()) return;
    if (nextSubject === saved.subject && nextBody === saved.body) return;

    setIsSaving(true);
    setError('');
    try {
      const draft = await api.zoho.saveDraft({
        draftId: saved.id || undefined,
        leadId,
        to: leadEmail,
        subject: nextSubject,
        content: nextBody,
      });
      setSaved({
        id: draft.id, subject: nextSubject, body: nextBody,
        at: new Date().toISOString(),
      });
      loadDrafts();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save the draft.');
    } finally {
      setIsSaving(false);
    }
  }, [leadId, leadEmail, loadDrafts, saved]);

  // Debounced autosave. Cleared on every change, so it only fires once the
  // user has actually stopped typing.
  useEffect(() => {
    if (!subject.trim() && !stripHtmlTags(body).trim()) return;
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => { persist(subject, body); }, AUTOSAVE_IDLE_MS);
    return () => { if (timer.current) clearTimeout(timer.current); };
  }, [subject, body, persist]);

  const openDraft = (d: EmailDraft) => {
    if (timer.current) clearTimeout(timer.current);
    setSubject(d.subject);
    setBody(d.content);
    setSaved({
      id: d.id, subject: d.subject, body: d.content,
      at: d.updatedAt || d.createdAt,
    });
    setShowDrafts(false);
  };

  const startNew = () => {
    if (timer.current) clearTimeout(timer.current);
    setSubject('');
    setBody('');
    setError('');
    setAttachments([]);
    setSaved({ id: '', subject: '', body: '', at: '' });
  };

  const addFiles = async (files: FileList | null) => {
    if (!files || !files.length) return;
    setError('');

    const incoming = Array.from(files);
    if (attachments.length + incoming.length > MAX_ATTACHMENT_COUNT) {
      setError(`At most ${MAX_ATTACHMENT_COUNT} attachments per message.`);
      return;
    }

    const existingBytes = attachments.reduce((sum, a) => sum + a.size, 0);
    const addedBytes = incoming.reduce((sum, f) => sum + f.size, 0);
    if (existingBytes + addedBytes > MAX_ATTACHMENT_BYTES) {
      setError(`Attachments must total under ${formatBytes(MAX_ATTACHMENT_BYTES)}.`);
      return;
    }

    try {
      const read = await Promise.all(incoming.map(async (f) => ({
        name: f.name,
        mimeType: f.type || 'application/octet-stream',
        size: f.size,
        data: await readAsBase64(f),
      })));
      setAttachments((prev) => [...prev, ...read]);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not read that file.');
    }
  };

  const discardDraft = async (id: string) => {
    try {
      await api.zoho.deleteDraft(id);
      if (id === saved.id) startNew();
      loadDrafts();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not discard the draft.');
    }
  };

  const handleSend = async () => {
    if (!subject.trim()) { setError('Give the email a subject before sending.'); return; }
    if (!stripHtmlTags(body).trim()) { setError('The message body is empty.'); return; }
    if (timer.current) clearTimeout(timer.current);

    setIsSending(true);
    setError('');
    try {
      await api.zoho.sendEmail(leadEmail, subject, body, {
        leadId,
        // Sending a draft closes it out server-side rather than leaving it
        // sitting in the list as if it were still unsent.
        draftId: saved.id || undefined,
        attachments: attachments.map(({ name, mimeType, data }) => ({ name, mimeType, data })),
      });
      startNew();
      loadDrafts();
      onSent();
    } catch (err) {
      // The draft is kept on failure — the text the user wrote is not thrown
      // away just because Zoho refused the message.
      setError(err instanceof Error ? err.message : 'Zoho did not accept the message.');
      persist(subject, body);
    } finally {
      setIsSending(false);
    }
  };

  const dirty = subject !== saved.subject || body !== saved.body;
  // The body is HTML now, so "empty" means no visible text — an editor holding
  // `<p><br></p>` after a stray keypress is not something worth sending or
  // saving as a draft.
  const bodyText = stripHtmlTags(body).trim();
  const hasText = Boolean(subject.trim() || bodyText);

  return (
    <div className="bg-[#161616] rounded-[6px] p-6 shadow-xl">
      <div className="flex flex-wrap items-center justify-between gap-3 mb-5">
        <h3 className="text-[10px] font-black text-white/30 uppercase tracking-widest">
          {saved.id ? 'Editing Draft' : 'Compose & Send Zoho Email'}
        </h3>

        <div className="flex items-center gap-2">
          {drafts.length > 0 && (
            <button
              type="button"
              onClick={() => setShowDrafts(v => !v)}
              className="flex items-center gap-1.5 px-3 py-1.5 border border-white/10 hover:border-white/30 text-white/60 hover:text-white rounded-[6px] text-[10px] font-black uppercase tracking-widest transition-all cursor-pointer"
            >
              <FileEdit className="w-3.5 h-3.5" />
              {drafts.length} {drafts.length === 1 ? 'Draft' : 'Drafts'}
            </button>
          )}
          {hasText && (
            <button
              type="button"
              onClick={startNew}
              className="px-3 py-1.5 border border-white/10 hover:border-white/30 text-white/40 hover:text-white rounded-[6px] text-[10px] font-black uppercase tracking-widest transition-all cursor-pointer"
            >
              Clear
            </button>
          )}
        </div>
      </div>

      {/* Saved drafts for this lead */}
      {showDrafts && (
        <div className="mb-5 border border-white/10 rounded-[8px] overflow-hidden">
          <div className="px-4 py-2 bg-white/5 flex items-center justify-between">
            <span className="text-[9px] font-black text-white/40 uppercase tracking-widest">
              Your saved drafts for {leadName}
            </span>
            <span className="text-[9px] text-white/25 font-medium">Only you can see these</span>
          </div>
          {drafts.map(d => (
            <div
              key={d.id}
              className={`px-4 py-3 flex items-center justify-between gap-3 border-t border-white/5 transition-colors ${
                d.id === saved.id ? 'bg-white/10' : 'hover:bg-white/5'
              }`}
            >
              <button
                type="button"
                onClick={() => openDraft(d)}
                className="flex-1 text-left min-w-0 cursor-pointer"
              >
                <div className="text-xs font-bold text-white truncate">
                  {d.subject || '(No subject)'}
                </div>
                <div className="text-[10px] text-white/35 truncate mt-0.5">
                  {stripHtmlTags(d.content).slice(0, 90) || 'Empty draft'}
                </div>
              </button>
              <span className="text-[9px] font-mono text-white/25 shrink-0 hidden sm:block">
                {new Date(d.updatedAt || d.createdAt).toLocaleString(undefined, {
                  dateStyle: 'medium', timeStyle: 'short',
                })}
              </span>
              <button
                type="button"
                onClick={() => discardDraft(d.id)}
                title="Discard this draft"
                className="p-1.5 text-white/25 hover:text-red-400 rounded transition-colors cursor-pointer shrink-0"
              >
                <Trash2 className="w-3.5 h-3.5" />
              </button>
            </div>
          ))}
        </div>
      )}

      <div className="mb-3 flex items-center gap-2 text-[10px] text-white/30 font-bold uppercase tracking-widest">
        <span>To</span>
        <span className="text-white/70 normal-case tracking-normal font-semibold">{leadEmail}</span>
      </div>

      <input
        type="text"
        placeholder="Email Subject..."
        value={subject}
        onChange={e => setSubject(e.target.value)}
        className="w-full px-5 py-3 mb-4 bg-white/5 border border-white/10 rounded-[8px] text-sm focus:outline-none focus:border-white/30 text-white placeholder:text-white/20 font-bold"
      />

      <div className="mb-4">
        <RichTextEditor
          value={body}
          onChange={setBody}
          disabled={isSending}
          placeholder="Write your email body…"
        />
      </div>

      {/* Attachments */}
      <div className="mb-4">
        <input
          ref={fileInput}
          type="file"
          multiple
          className="hidden"
          onChange={(e) => {
            addFiles(e.target.files);
            // Reset so picking the same file twice still fires a change.
            e.target.value = '';
          }}
        />

        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => fileInput.current?.click()}
            disabled={isSending || attachments.length >= MAX_ATTACHMENT_COUNT}
            className="flex items-center gap-2 px-3 py-1.5 border border-white/15 text-white/60 hover:text-white hover:border-white/40 rounded-[6px] text-[10px] font-black uppercase tracking-widest transition-all disabled:opacity-30 cursor-pointer"
          >
            <Paperclip className="w-3.5 h-3.5" /> Attach files
          </button>
          <span className="text-[10px] text-white/25">
            Up to {MAX_ATTACHMENT_COUNT} files, {formatBytes(MAX_ATTACHMENT_BYTES)} total.
            Files are not kept with a saved draft.
          </span>
        </div>

        {attachments.length > 0 && (
          <div className="mt-3 flex flex-wrap gap-2">
            {attachments.map((a, i) => (
              <span
                key={`${a.name}-${i}`}
                className="inline-flex items-center gap-2 pl-2.5 pr-1.5 py-1.5 bg-white/5 border border-white/10 rounded-[6px] max-w-full"
              >
                <FileIcon className="w-3.5 h-3.5 text-white/40 shrink-0" />
                <span className="text-[11px] text-white/80 font-medium truncate max-w-[200px]">
                  {a.name}
                </span>
                <span className="text-[10px] text-white/30 shrink-0">{formatBytes(a.size)}</span>
                <button
                  type="button"
                  onClick={() => setAttachments(prev => prev.filter((_, idx) => idx !== i))}
                  title={`Remove ${a.name}`}
                  className="p-0.5 text-white/30 hover:text-red-400 rounded transition-colors cursor-pointer shrink-0"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              </span>
            ))}
          </div>
        )}
      </div>

      {error && (
        <div className="mb-4 flex items-start gap-2 px-4 py-3 bg-red-500/10 border border-red-500/30 rounded-[6px]">
          <AlertTriangle className="w-3.5 h-3.5 text-red-400 shrink-0 mt-0.5" />
          <span className="text-[11px] text-red-300 leading-relaxed">{error}</span>
          <button
            type="button"
            onClick={() => setError('')}
            className="ml-auto text-red-400/50 hover:text-red-300 cursor-pointer"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      )}

      <div className="flex flex-wrap items-center justify-between gap-3">
        <span className="text-[10px] font-medium text-white/30 flex items-center gap-1.5">
          {isSaving ? (
            <><Loader2 className="w-3 h-3 animate-spin" /> Saving draft…</>
          ) : dirty && hasText ? (
            <>Unsaved changes</>
          ) : saved.at ? (
            <><Check className="w-3 h-3 text-emerald-400" /> Draft saved {new Date(saved.at).toLocaleTimeString(undefined, { timeStyle: 'short' })}</>
          ) : (
            <>Drafts save automatically</>
          )}
        </span>

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => persist(subject, body)}
            disabled={!hasText || isSaving || !dirty}
            className="flex items-center gap-2 border border-white/15 text-white/70 hover:text-white hover:border-white/40 px-5 py-3 rounded-[6px] text-[11px] font-black uppercase tracking-widest transition-all disabled:opacity-20 cursor-pointer"
          >
            <Save className="w-4 h-4" /> Save Draft
          </button>

          <button
            type="button"
            onClick={handleSend}
            disabled={!subject.trim() || !bodyText || isSending}
            className="flex items-center gap-2 bg-white text-[#161616] px-6 py-3 rounded-[6px] text-[11px] font-black hover:opacity-90 transition-all disabled:opacity-20 uppercase tracking-widest cursor-pointer"
          >
            <Send className="w-4 h-4" />
            {isSending ? 'Sending…' : 'Send Zoho Email'}
          </button>
        </div>
      </div>
    </div>
  );
};
