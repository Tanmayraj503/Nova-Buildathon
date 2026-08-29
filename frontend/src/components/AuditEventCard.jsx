import JsonViewer from './JsonViewer';
import { classifyLog, CATEGORIES, CATEGORY_STYLES } from '../utils/auditCategory';
import { formatTime } from '../utils/format';

export default function AuditEventCard({ log }) {
  const { category, summary } = classifyLog(log);
  const meta = CATEGORIES[category];
  const style = CATEGORY_STYLES[category];

  return (
    <div className={`animate-row-in rounded-xl border ${style.border} ${style.bg} px-3.5 py-3`}>
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <span className={`h-1.5 w-1.5 flex-shrink-0 rounded-full ${style.dot}`} aria-hidden="true" />
          <span className={`font-mono text-[10px] font-semibold uppercase tracking-wider ${style.text}`}>
            {meta.label}
          </span>
        </div>
        <span className="font-mono text-[10px] text-ink-faint">{formatTime(log.timestamp)}</span>
      </div>

      <p className="mt-1.5 break-words text-[12px] leading-relaxed text-ink">{summary}</p>
      <p className="mt-1 break-words font-mono text-[10px] text-ink-faint">
        {log.step_type} · actor: {log.actor}
      </p>

      <JsonViewer data={log.payload} label="raw payload" />
    </div>
  );
}
