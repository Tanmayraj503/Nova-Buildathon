import Razorpay from 'razorpay';
import 'dotenv/config';

if (!process.env.RAZORPAY_KEY_ID || !process.env.RAZORPAY_KEY_SECRET) {
  console.warn(
    '⚠️  RAZORPAY_KEY_ID / RAZORPAY_KEY_SECRET are not set. ' +
    'Set them in .env (Sandbox/Test mode keys from the Razorpay Dashboard) before creating orders.'
  );
}

const razorpay = new Razorpay({
  key_id: process.env.RAZORPAY_KEY_ID,
  key_secret: process.env.RAZORPAY_KEY_SECRET,
});

export default razorpay;
