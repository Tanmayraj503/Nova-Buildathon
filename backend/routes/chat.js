import { Router } from 'express';
import { randomUUID } from 'crypto';
import { runAgent } from '../agent/agent.js';
import { logAudit } from '../lib/audit.js';

const router = Router();

// In-memory conversation store, keyed by session_id.
// Good enough for a buildathon demo; swap for Redis/DB-backed storage for production.
const sessions = new Map();

router.post('/chat', async (req, res) => {
  try {
    const { message, session_id, user_id } = req.body ?? {};

    if (!message || typeof message !== 'string' || !message.trim()) {
      return res.status(400).json({ error: 'INVALID_REQUEST', message: '"message" (string) is required.' });
    }

    const sessionId = session_id || randomUUID();
    const userId = user_id || 'guest_user';

    const history = sessions.get(sessionId) || [];
    logAudit(sessionId, 'USER_MESSAGE', 'user', { text: message, user_id: userId });

    const updatedHistory = [...history, { role: 'user', parts: [{ text: message }] }];
    const { reply, conversation } = await runAgent({ sessionId, userId, messages: updatedHistory });

    sessions.set(sessionId, conversation);

    res.json({ session_id: sessionId, reply });
  } catch (err) {
    console.error('POST /api/chat failed:', err);
    res.status(500).json({ error: 'INTERNAL_ERROR', message: err.message });
  }
});

export default router;
