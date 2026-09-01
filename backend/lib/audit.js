import db from '../db.js';

const insertLog = db.prepare(`
  INSERT INTO audit_logs (session_id, step_type, actor, payload)
  VALUES (?, ?, ?, ?)
`);

const selectLogs = db.prepare(`
  SELECT id, session_id, step_type, actor, payload, timestamp
  FROM audit_logs
  WHERE session_id = ?
  ORDER BY id ASC
`);

/**
 * Append one explainability event to the audit trail.
 * @param {string} sessionId
 * @param {'USER_MESSAGE'|'AGENT_RESPONSE'|'TOOL_CALL'|'TOOL_RESULT'|'GUARDRAIL_BLOCK'|'TOOL_ERROR'|'PAYMENT_VERIFICATION'} stepType
 * @param {'user'|'agent'|'system'} actor
 * @param {object} payload - JSON-serializable detail for this step
 */
export function logAudit(sessionId, stepType, actor, payload) {
  insertLog.run(sessionId, stepType, actor, JSON.stringify(payload ?? {}));
}

/**
 * Fetch the full chronological audit trail for a session.
 */
export function getAuditTrail(sessionId) {
  return selectLogs.all(sessionId).map((row) => ({
    ...row,
    payload: safeParse(row.payload),
  }));
}

function safeParse(text) {
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}
