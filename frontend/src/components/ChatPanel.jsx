import { useEffect, useRef, useState } from 'react';
import PanelHeader from './PanelHeader';

const SUGGESTIONS = ['Find me a keyboard under ₹3,000', 'Buy a monitor', "What's in stock?"];

export default function ChatPanel({ messages, onSend, isSending }) {
  const [input, setInput] = useState('');
  const scrollRef = useRef(null);
  const inputRef = useRef(null);

  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' });
  }, [messages, isSending]);

  function submit(text) {
    const trimmed = text.trim();
    if (!trimmed || isSending) return;
    onSend(trimmed);
    setInput('');
    inputRef.current?.focus();
  }

  return (
    <section className="flex min-h-0 flex-col bg-panel">
      <PanelHeader
        icon="💬"
        title="Shopping Assistant"
        subtitle="Nova · Agentic Commerce Assistant"
        topBarClassName="bg-signal-user"
        right={
          <span className="hidden items-center gap-1.5 text-[11px] text-ink-faint sm:flex">
            <span className="h-1.5 w-1.5 rounded-full bg-signal-user" />
            session live
          </span>
        }
      />

      <div ref={scrollRef} className="flex-1 space-y-3 overflow-y-auto px-4 py-4">
        {messages.map((m) => (
          <ChatBubble key={m.id} message={m} />
        ))}
        {isSending && <TypingIndicator />}
      </div>

      {messages.length <= 1 && (
        <div className="flex flex-wrap gap-2 px-4 pb-3">
          {SUGGESTIONS.map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => submit(s)}
              className="rounded-full border border-hairline bg-panel-elevated px-3 py-1.5 text-[11px] text-ink-muted transition-colors hover:border-signal-user/50 hover:text-ink"
            >
              {s}
            </button>
          ))}
        </div>
      )}

      <form
        onSubmit={(e) => {
          e.preventDefault();
          submit(input);
        }}
        className="flex gap-2 border-t border-hairline p-3"
      >
        <input
          ref={inputRef}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="Ask Nova to find or buy something…"
          className="flex-1 rounded-xl border border-hairline bg-canvas px-4 py-2.5 text-[13px] text-ink placeholder-ink-faint outline-none transition-colors focus:border-signal-user/60"
        />
        <button
          type="submit"
          disabled={isSending || !input.trim()}
          className="rounded-xl bg-signal-user px-4 py-2.5 text-[13px] font-medium text-canvas transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:bg-panel-elevated disabled:text-ink-faint"
        >
          Send
        </button>
      </form>
    </section>
  );
}

function ChatBubble({ message }) {
  const isUser = message.role === 'user';
  return (
    <div className={`flex ${isUser ? 'justify-end' : 'justify-start'}`}>
      <div
        className={`max-w-[86%] whitespace-pre-wrap break-words rounded-2xl px-4 py-2.5 text-[13px] leading-relaxed ${
          isUser
            ? 'rounded-br-sm bg-signal-user text-canvas'
            : message.isError
              ? 'rounded-bl-sm border border-signal-error/40 bg-signal-error/10 text-signal-error'
              : 'rounded-bl-sm border border-hairline bg-panel-elevated text-ink'
        }`}
      >
        {!isUser && (
          <div className="mb-1 font-display text-[10px] font-semibold uppercase tracking-wider text-ink-faint">
            Nova
          </div>
        )}
        {renderInlineMarkdown(message.text)}
      </div>
    </div>
  );
}

/**
 * Deliberately minimal "markdown": turns **bold** spans into real <strong>
 * elements so Nova's replies (e.g. "**Product:** ...") don't show literal
 * asterisks. Everything else is left as plain text — no HTML injection risk
 * since this builds React nodes directly rather than using
 * dangerouslySetInnerHTML.
 */
function renderInlineMarkdown(text) {
  if (typeof text !== 'string') return text;
  const segments = text.split(/(\*\*[^*]+\*\*)/g);
  return segments.map((segment, i) => {
    if (segment.startsWith('**') && segment.endsWith('**') && segment.length > 4) {
      return (
        <strong key={i} className="font-semibold text-ink">
          {segment.slice(2, -2)}
        </strong>
      );
    }
    return segment ? <span key={i}>{segment}</span> : null;
  });
}

function TypingIndicator() {
  return (
    <div className="flex justify-start">
      <div className="flex items-center gap-1.5 rounded-2xl rounded-bl-sm border border-hairline bg-panel-elevated px-4 py-3">
        {[0, 1, 2].map((i) => (
          <span
            key={i}
            className="h-1.5 w-1.5 animate-bounce rounded-full bg-ink-faint"
            style={{ animationDelay: `${i * 0.15}s` }}
          />
        ))}
      </div>
    </div>
  );
}
