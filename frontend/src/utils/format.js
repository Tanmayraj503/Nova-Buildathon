/** Format an integer paise amount as a rupee string, e.g. 249900 -> "₹2,499". */
export function formatINR(paise) {
  if (typeof paise !== 'number' || Number.isNaN(paise)) return '₹—';
  const rupees = paise / 100;
  const hasFraction = Math.round(rupees * 100) % 100 !== 0;
  return `₹${rupees.toLocaleString('en-IN', {
    minimumFractionDigits: hasFraction ? 2 : 0,
    maximumFractionDigits: 2,
  })}`;
}

/**
 * The backend stores timestamps as SQLite `datetime('now')` output, which is
 * a naive UTC string like "2026-08-27 18:36:22". Treat it as UTC explicitly
 * so it displays correctly converted to the viewer's local time.
 */
export function formatTime(ts) {
  if (!ts) return '';
  const iso = ts.includes('T') ? ts : `${ts.replace(' ', 'T')}Z`;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return ts;
  return d.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

export function truncate(str, n = 160) {
  if (!str) return '';
  const s = String(str);
  return s.length > n ? `${s.slice(0, n)}…` : s;
}

export function shortId(id, visible = 8) {
  if (!id) return '';
  return id.length > visible ? `${id.slice(0, visible)}…` : id;
}
