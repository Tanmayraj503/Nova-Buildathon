import { Router } from 'express';
import db from '../db.js';
import razorpay, { razorpayConfig } from '../lib/razorpay.js';
import { logAudit } from '../lib/audit.js';
import { createPaymentService, PaymentError } from '../lib/payments.js';

const router = Router();
const payments = createPaymentService({ db, razorpay, ...razorpayConfig, logAudit });

for (const [path, action] of [
  ['/checkout-session', payments.prepare],
  ['/verify-payment', payments.verify],
  ['/payment-status', payments.status],
]) {
  router.post(path, async (req, res) => {
    res.set('Cache-Control', 'no-store');
    try {
      res.json(await action(req.body ?? {}));
    } catch (err) {
      if (err instanceof PaymentError) {
        return res.status(err.statusCode).json({ error: err.code, message: err.message });
      }
      const upstream = err?.error?.description;
      res.status(502).json({ error: 'RAZORPAY_UNAVAILABLE',
        message: upstream ? `Razorpay: ${upstream}` : 'Razorpay could not confirm the payment yet. Check payment status before trying again.' });
    }
  });
}

export default router;
