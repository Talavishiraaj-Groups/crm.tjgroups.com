import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  Bold, Italic, Underline, Link2, List, ListOrdered, Heading, Eraser, Unlink,
} from 'lucide-react';

interface Props {
  /** HTML. Only read when it differs from what the editor already holds. */
  value: string;
  onChange: (html: string) => void;
  placeholder?: string;
  disabled?: boolean;
}

type IconType = React.ComponentType<{ className?: string }>;

/** A toolbar entry: either a command to run, or a separator. */
type Tool =
  | { kind: 'divider'; id: string }
  | { kind: 'command'; id: string; label: string; icon: IconType; command: string; arg?: string }
  | { kind: 'link'; id: string; label: string; icon: IconType };

const TOOLS: Tool[] = [
  { kind: 'command', id: 'bold', label: 'Bold', icon: Bold, command: 'bold' },
  { kind: 'command', id: 'italic', label: 'Italic', icon: Italic, command: 'italic' },
  { kind: 'command', id: 'underline', label: 'Underline', icon: Underline, command: 'underline' },
  { kind: 'divider', id: 'd1' },
  { kind: 'command', id: 'h3', label: 'Heading', icon: Heading, command: 'formatBlock', arg: '<h3>' },
  { kind: 'command', id: 'ul', label: 'Bulleted list', icon: List, command: 'insertUnorderedList' },
  { kind: 'command', id: 'ol', label: 'Numbered list', icon: ListOrdered, command: 'insertOrderedList' },
  { kind: 'divider', id: 'd2' },
  { kind: 'link', id: 'link', label: 'Insert link', icon: Link2 },
  { kind: 'command', id: 'unlink', label: 'Remove link', icon: Unlink, command: 'unlink' },
  { kind: 'command', id: 'clear', label: 'Clear formatting', icon: Eraser, command: 'removeFormat' },
];

/**
 * Separate component rather than a helper the parent calls while rendering:
 * a render-time call that reaches through to the editor's ref is exactly what
 * the React compiler warns about, and the warning is fair.
 */
const ToolbarButton: React.FC<{
  label: string; Icon: IconType; disabled: boolean; onClick: () => void;
}> = ({ label, Icon, disabled, onClick }) => (
  <button
    type="button"
    title={label}
    aria-label={label}
    disabled={disabled}
    // Keep the selection alive — focus must not leave the editor on press,
    // or the command has nothing to apply to.
    onMouseDown={(e) => e.preventDefault()}
    onClick={onClick}
    className="p-1.5 rounded-[4px] text-white/50 hover:text-white hover:bg-white/10 disabled:opacity-30 transition-colors cursor-pointer"
  >
    <Icon className="w-3.5 h-3.5" />
  </button>
);

/**
 * A small rich-text editor for composing email.
 *
 * Built on `contentEditable` and `document.execCommand`. execCommand is
 * formally deprecated, but every browser still implements it, it is the only
 * built-in that maintains a correct undo stack across formatting operations,
 * and the alternative — a real editor framework — is roughly 100 kB of
 * JavaScript for bold, italic and a link. On a free-tier deployment served to
 * salespeople on hotel wifi, that trade is not worth making.
 *
 * The editor is UNCONTROLLED once mounted: React writing innerHTML on every
 * keystroke destroys the caret position. `value` is pushed in only when it
 * diverges from the DOM, which happens when a draft is loaded or cleared.
 */
export const RichTextEditor: React.FC<Props> = ({
  value, onChange, placeholder, disabled = false,
}) => {
  const ref = useRef<HTMLDivElement>(null);
  const [isEmpty, setIsEmpty] = useState(!value);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    // Only when they differ — otherwise every keystroke would reset the caret
    // to the start of the box.
    if (el.innerHTML !== value) {
      el.innerHTML = value || '';
      setIsEmpty(!el.textContent?.trim());
    }
  }, [value]);

  const emit = useCallback(() => {
    const el = ref.current;
    if (!el) return;
    setIsEmpty(!el.textContent?.trim());
    onChange(el.innerHTML);
  }, [onChange]);

  const exec = useCallback((command: string, arg?: string) => {
    ref.current?.focus();
    document.execCommand(command, false, arg);
    emit();
  }, [emit]);

  const addLink = useCallback(() => {
    const selection = window.getSelection();
    const selected = selection ? selection.toString() : '';
    const raw = window.prompt('Link address', 'https://');
    if (!raw) return;

    // Anything without a scheme becomes https rather than a relative link into
    // the CRM, and javascript:/data: are refused outright — either would ship
    // an executable link to a client's inbox.
    let url = raw.trim();
    if (/^\s*javascript:/i.test(url) || /^\s*data:/i.test(url)) {
      window.alert('That kind of link cannot be sent in an email.');
      return;
    }
    if (!/^https?:\/\//i.test(url) && !/^mailto:/i.test(url)) {
      url = 'https://' + url.replace(/^\/+/, '');
    }

    if (!selected) {
      // Nothing selected means nothing to turn into a link, so insert the
      // address as its own visible, clickable text.
      exec('insertHTML', `<a href="${escapeAttr(url)}">${escapeHtml(url)}</a>`);
      return;
    }
    exec('createLink', url);
  }, [exec]);

  const handlePaste = useCallback((e: React.ClipboardEvent<HTMLDivElement>) => {
    // Paste as plain text. Copying from a web page otherwise drags in that
    // page's fonts, colours and background, which is how outbound mail ends up
    // looking like a broken clone of someone else's website.
    e.preventDefault();
    const text = e.clipboardData.getData('text/plain');
    document.execCommand('insertText', false, text);
    emit();
  }, [emit]);

  return (
    <div className="border border-white/10 rounded-[8px] overflow-hidden bg-white/5 focus-within:border-white/30 transition-colors">
      <div className="flex flex-wrap items-center gap-0.5 px-2 py-1.5 border-b border-white/10 bg-white/5">
        {TOOLS.map((tool) =>
          tool.kind === 'divider' ? (
            <span key={tool.id} className="w-px h-4 bg-white/10 mx-1" />
          ) : (
            <ToolbarButton
              key={tool.id}
              label={tool.label}
              Icon={tool.icon}
              disabled={disabled}
              onClick={
                tool.kind === 'link'
                  ? addLink
                  : () => exec(tool.command, tool.arg)
              }
            />
          )
        )}
      </div>

      <div className="relative">
        {isEmpty && placeholder && (
          <span className="absolute left-5 top-4 text-sm text-white/20 pointer-events-none select-none">
            {placeholder}
          </span>
        )}
        <div
          ref={ref}
          role="textbox"
          aria-multiline="true"
          aria-label="Email body"
          contentEditable={!disabled}
          suppressContentEditableWarning
          onInput={emit}
          onBlur={emit}
          onPaste={handlePaste}
          className="min-h-[180px] max-h-[420px] overflow-y-auto px-5 py-4 text-sm text-white leading-relaxed focus:outline-none [&_a]:text-blue-300 [&_a]:underline [&_h3]:text-base [&_h3]:font-bold [&_h3]:my-2 [&_ul]:list-disc [&_ul]:pl-5 [&_ol]:list-decimal [&_ol]:pl-5 [&_li]:my-0.5"
        />
      </div>
    </div>
  );
};

function escapeHtml(s: string) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function escapeAttr(s: string) {
  return escapeHtml(s).replace(/"/g, '&quot;');
}
