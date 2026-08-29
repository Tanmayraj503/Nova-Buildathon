import { useState } from 'react';
import { shortId } from '../utils/format';

export default function Header({ sessionId, onNewSession }) {
  const [copied, setCopied] = useState(false);

  async function copySessionId() {
    try {
      await navigator.clipboard.writeText(sessionId);
      setCopied(true);
      setTimeout(() => setCopied(false), 1400);
    } catch {
      // clipboard permissions can fail silently in some hosting contexts — non-critical
    }
  }

  return (
    <header className="flex flex-shrink-0 items-center justify-between border-b border-hairline bg-panel px-4 py-2.5 sm:px-5">
      <div className="flex items-center gap-2.5">
        <svg width="22" height="22" viewBox="0 0 32 32" fill="none" aria-hidden="true">
          <rect width="32" height="32" rx="7" fill="var(--color-canvas)" />
          <path
            d="M9 22V10l14 12V10"
            stroke="var(--color-authorize)"
            strokeWidth="2.4"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
        <div className="leading-tight">
          <p className="font-display text-[15px] font-semibold tracking-tight text-ink">
            Nova <span className="font-normal text-ink-faint">/ Agentic Commerce</span>
          </p>
          <p className="hidden text-[10.5px] text-ink-faint sm:block">
            
          </p>
        </div>
      </div>

      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={copySessionId}
          title="Copy session ID"
          className="hidden items-center gap-1.5 rounded-full border border-hairline bg-panel-elevated px-2.5 py-1 font-mono text-[10.5px] text-ink-muted transition-colors hover:text-ink sm:flex"
        >
          <span className="h-1.5 w-1.5 rounded-full bg-signal-pay" />
          session:{shortId(sessionId, 10)}
          <span className="text-ink-faint">{copied ? '✓' : '⧉'}</span>
        </button>
        <button
          type="button"
          onClick={onNewSession}
          className="rounded-full border border-hairline px-3 py-1 text-[11px] font-medium text-ink-muted transition-colors hover:border-signal-user/50 hover:text-ink"
        >
          New session
        </button>
      </div>
    </header>
  );
}
