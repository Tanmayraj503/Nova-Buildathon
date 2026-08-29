// In dev, Vite's proxy (see vite.config.js) forwards /api/* to the backend on
// :4000, so relative paths work with zero CORS setup. For a production build
// served from a different origin than the backend, set VITE_API_BASE_URL.
const API_BASE = import.meta.env.VITE_API_BASE_URL ?? '';

async function safeJson(res) {
  try {
    return await res.json();
  } catch {
    return null;
  }
}

export async function sendChatMessage({ message, sessionId, userId }) {
  const res = await fetch(`${API_BASE}/api/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ message, session_id: sessionId, user_id: userId }),
  });
  const data = await safeJson(res);
  if (!res.ok) throw new Error(data?.message || `Chat request failed (${res.status})`);
  return data; // { session_id, reply }
}

export async function fetchAuditTrail(sessionId) {
  if (!sessionId) return { session_id: null, count: 0, logs: [] };
  const res = await fetch(`${API_BASE}/api/audit-trail?session_id=${encodeURIComponent(sessionId)}`);
  const data = await safeJson(res);
  if (!res.ok) throw new Error(data?.message || `Audit trail request failed (${res.status})`);
  return data; // { session_id, count, logs }
}

export async function verifyPayment({ razorpayOrderId, razorpayPaymentId, razorpaySignature, sessionId }) {
  const res = await fetch(`${API_BASE}/api/verify-payment`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      razorpay_order_id: razorpayOrderId,
      razorpay_payment_id: razorpayPaymentId,
      razorpay_signature: razorpaySignature,
      session_id: sessionId,
    }),
  });
  const data = await safeJson(res);
  if (!res.ok) throw new Error(data?.message || `Payment verification failed (${res.status})`);
  return data; // { verified, status, order_id, razorpay_order_id }
}
