import Razorpay from 'razorpay';
import 'dotenv/config';

if (!process.env.RAZORPAY_KEY_ID || !process.env.RAZORPAY_KEY_SECRET) {
  console.warn(
    '⚠️  RAZORPAY_KEY_ID / RAZORPAY_KEY_SECRET are not set. ' +
    'Set them in .env (Sandbox/Test mode keys from the Razorpay Dashboard) before creating orders.'
  );
}

export const razorpayConfig = {
  keyId: process.env.RAZORPAY_KEY_ID?.trim(),
  keySecret: process.env.RAZORPAY_KEY_SECRET?.trim(),
};

export function assertTestMode() {
  if (!razorpayConfig.keyId?.startsWith('rzp_test_') || !razorpayConfig.keySecret) {
    throw new Error('Configure matching Razorpay Test Mode keys on the server before checking out.');
  }
}

const razorpay = new Razorpay({
  key_id: razorpayConfig.keyId || 'unconfigured',
  key_secret: razorpayConfig.keySecret,
});
// Bound upstream calls so a stalled sandbox cannot leave checkout waiting forever.
razorpay.api.rq.defaults.timeout = 15000;

export default razorpay;
