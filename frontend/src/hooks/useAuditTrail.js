import { useCallback, useEffect, useRef, useState } from 'react';
import { fetchAuditTrail } from '../lib/api';

/**
 * Polls the audit trail for `sessionId` every `intervalMs` (default 2s).
 * Both the HITL panel and the audit timeline panel consume this same feed —
 * one poll, two views — so pending orders and their eventual verification
 * status stay in sync without duplicate requests.
 */
export function useAuditTrail(sessionId, intervalMs = 2000) {
  const [logs, setLogs] = useState([]);
  const [error, setError] = useState(null);
  const [lastPolledAt, setLastPolledAt] = useState(null);
  const timerRef = useRef(null);

  const poll = useCallback(async () => {
    if (!sessionId) return;
    try {
      const data = await fetchAuditTrail(sessionId);
      setLogs(data.logs ?? []);
      setError(null);
    } catch (err) {
      setError(err.message);
    } finally {
      setLastPolledAt(Date.now());
    }
  }, [sessionId]);

  useEffect(() => {
    setLogs([]);
    poll();
    timerRef.current = setInterval(poll, intervalMs);
    return () => clearInterval(timerRef.current);
  }, [poll, intervalMs]);

  return { logs, error, lastPolledAt, refresh: poll };
}
