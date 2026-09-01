import { Router } from 'express';
import { getAuditTrail } from '../lib/audit.js';

const router = Router();

router.get('/audit-trail', (req, res) => {
  const { session_id } = req.query;

  if (!session_id || typeof session_id !== 'string') {
    return res.status(400).json({ error: 'INVALID_REQUEST', message: 'session_id query param is required.' });
  }

  const logs = getAuditTrail(session_id);
  res.json({ session_id, count: logs.length, logs });
});

export default router;
