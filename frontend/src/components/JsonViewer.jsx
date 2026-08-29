import { useState } from 'react';

/** Expandable, pretty-printed JSON block — lets judges inspect raw tool I/O. */
export default function JsonViewer({ data, label = 'payload' }) {
  const [open, setOpen] = useState(false);
  const pretty = safeStringify(data);

  return (
    <div className="mt-2">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-1.5 text-[11px] font-mono text-ink-faint hover:text-ink-muted transition-colors"
        aria-expanded={open}
      >
        <span className={`inline-block transition-transform duration-150 ${open ? 'rotate-90' : ''}`}>▸</span>
        {open ? `hide ${label}` : `view ${label}`}
      </button>
      {open && (
        <pre className="mt-1.5 max-h-64 overflow-auto whitespace-pre-wrap break-words rounded-lg border border-seam bg-canvas/70 p-2.5 text-[11px] leading-relaxed font-mono text-ink-muted">
          {pretty}
        </pre>
      )}
    </div>
  );
}

function safeStringify(data) {
  try {
    return JSON.stringify(data, null, 2);
  } catch {
    return String(data);
  }
}
