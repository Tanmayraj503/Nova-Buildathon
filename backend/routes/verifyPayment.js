import { Router } from 'express';
import crypto from 'crypto';
import db from '../db.js';
import { logAudit } from '../lib/audit.js';

const router = Router();

const getOrderByRzpId = db.prepare('SELECT * FROM orders WHERE razorpay_order_id = ?');
const updateOrderStatus = db.prepare('UPDATE orders SET status = ? WHERE razorpay_order_id = ?');
const restoreStock = db.prepare('UPDATE products SET stock = stock + ? WHERE id = ?');

router.post('/verify-payment', (req, res) => {
  const {
    razorpay_order_id,
    razorpay_payment_id,
    razorpay_signature,
    session_id, // optional, lets this event show up in the same explainability trail as the chat
  } = req.body ?? {};

  if (!razorpay_order_id || !razorpay_payment_id || !razorpay_signature) {
    return res.status(400).json({
      error: 'INVALID_REQUEST',
      message: 'razorpay_order_id, razorpay_payment_id, and razorpay_signature are all required.',
    });
  }

  const order = getOrderByRzpId.get(razorpay_order_id);
  if (!order) {
    return res.status(404).json({ error: 'ORDER_NOT_FOUND', message: `No local order found for ${razorpay_order_id}.` });
  }

  if (!process.env.RAZORPAY_KEY_SECRET) {
    return res.status(500).json({ error: 'SERVER_MISCONFIGURED', message: 'RAZORPAY_KEY_SECRET is not set.' });
  }

  // Razorpay's documented signature scheme: HMAC-SHA256("<order_id>|<payment_id>", key_secret)
  const expectedSignature = crypto
    .createHmac('sha256', process.env.RAZORPAY_KEY_SECRET)
    .update(`${razorpay_order_id}|${razorpay_payment_id}`)
    .digest('hex');

  const isValid = safeCompare(expectedSignature, razorpay_signature);

  const newStatus = isValid ? 'VERIFIED' : 'FAILED';
  updateOrderStatus.run(newStatus, razorpay_order_id);

  // If verification failed, release the stock we provisionally reserved at order-creation time.
  if (!isValid) {
    restoreStock.run(order.quantity, order.product_id);
  }

  if (session_id) {
    logAudit(session_id, 'PAYMENT_VERIFICATION', 'system', {
      razorpay_order_id,
      razorpay_payment_id,
      verified: isValid,
      status: newStatus,
    });
  }

  res.json({
    verified: isValid,
    status: newStatus,
    order_id: order.id,
    razorpay_order_id,
  });
});

// Constant-time string comparison. crypto.timingSafeEqual requires equal-length
// buffers, so mismatched lengths (e.g. a malformed/forged signature) are
// rejected outright rather than being passed into it.
function safeCompare(a, b) {
  const bufA = Buffer.from(String(a), 'utf8');
  const bufB = Buffer.from(String(b), 'utf8');
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}

export default router;
