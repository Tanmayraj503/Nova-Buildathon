import { useEffect, useMemo, useRef, useState } from 'react';
import PanelHeader from './PanelHeader';
import AuditEventCard from './AuditEventCard';
import { classifyLog, CATEGORIES, CATEGORY_STYLES } from '../utils/auditCategory';

const ALL_CATEGORY_KEYS = Object.keys(CATEGORIES);

export default function AuditPanel({ logs, error }) {
  const [activeFilters, setActiveFilters] = useState(() => new Set(ALL_CATEGORY_KEYS));
  const scrollRef = useRef(null);

  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' });
  }, [logs]);

  const filteredLogs = useMemo(
    () => logs.filter((log) => activeFilters.has(classifyLog(log).category)),
    [logs, activeFilters]
  );

  function toggleFilter(key) {
    setActiveFilters((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next.size ? next : new Set(ALL_CATEGORY_KEYS); // never allow an empty filter
    });
  }

  return (
    <section className="flex min-h-0 flex-col bg-panel">
      <PanelHeader
        icon="🔍"
        title="Explainable AI Audit Trail"
        subtitle={`${logs.length} event${logs.length === 1 ? '' : 's'} this session`}
        topBarClassName=""
        topBarStyle={{
          backgroundImage:
            'linear-gradient(90deg, var(--color-signal-user), var(--color-signal-agent), var(--color-signal-tool), var(--color-signal-pay), var(--color-signal-error))',
        }}
        right={
          <span className="flex items-center gap-1.5 text-[11px] font-mono text-signal-pay">
            <span className="animate-live-pulse h-1.5 w-1.5 rounded-full bg-signal-pay" />
            live · 2s
          </span>
        }
      />

      <div className="flex flex-wrap gap-1.5 border-b border-hairline px-4 py-2.5">
        {ALL_CATEGORY_KEYS.map((key) => {
          const meta = CATEGORIES[key];
          const style = CATEGORY_STYLES[key];
          const active = activeFilters.has(key);
          return (
            <button
              key={key}
              type="button"
              onClick={() => toggleFilter(key)}
              className={`rounded-full border px-2.5 py-1 text-[10.5px] font-medium transition-colors ${
                active ? `${style.border} ${style.bg} ${style.text}` : 'border-hairline text-ink-faint'
              }`}
            >
              {meta.label}
            </button>
          );
        })}
      </div>

      {error && (
        <div className="mx-4 mt-2 rounded-lg border border-signal-error/40 bg-signal-error/10 px-3 py-2 text-[11px] text-signal-error">
          Couldn't refresh the audit trail: {error}
        </div>
      )}

      <div ref={scrollRef} className="flex-1 space-y-2 overflow-y-auto px-4 py-3">
        {filteredLogs.length === 0 ? (
          <EmptyState hasLogs={logs.length > 0} />
        ) : (
          filteredLogs.map((log) => <AuditEventCard key={log.id} log={log} />)
        )}
      </div>
    </section>
  );
}

function EmptyState({ hasLogs }) {
  return (
    <div className="flex flex-col items-center justify-center rounded-2xl border border-dashed border-hairline px-6 py-14 text-center">
      <span className="text-2xl" aria-hidden="true">
        📡
      </span>
      <p className="mt-3 text-[13px] font-medium text-ink-muted">
        {hasLogs ? 'No events match the selected filters' : 'Waiting for activity'}
      </p>
      <p className="mt-1 max-w-[220px] text-[11.5px] leading-relaxed text-ink-faint">
        {hasLogs
          ? 'Toggle a category above to see it again.'
          : 'Every step the agent takes — reasoning, tool calls, guardrails, payments — will stream in here in real time.'}
      </p>
    </div>
  );
}
