const CHECKOUT_URL = 'https://checkout.razorpay.com/v1/checkout.js';
let scriptPromise;
let activeCheckout = false;

export function loadRazorpay() {
  if (window.Razorpay) return Promise.resolve();
  if (scriptPromise) return scriptPromise;
  scriptPromise = new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = CHECKOUT_URL;
    script.async = true;
    const finish = (error) => {
      clearTimeout(timer);
      script.onload = script.onerror = null;
      if (error) {
        script.remove();
        reject(error);
      } else resolve();
    };
    const timer = setTimeout(() => finish(new Error('Razorpay took too long to load. Check your connection and try again.')), 15000);
    script.onload = () => finish(window.Razorpay ? null : new Error('Razorpay could not start. Please try again.'));
    script.onerror = () => finish(new Error('Razorpay could not load. Check your connection and try again.'));
    document.head.appendChild(script);
  }).catch((error) => {
    scriptPromise = undefined;
    throw error;
  });
  return scriptPromise;
}

export function buildCheckoutOptions({ keyId, amountPaise, razorpayOrderId, currency, productName }) {
  if (!keyId?.startsWith('rzp_test_')) throw new Error('Checkout requires a Razorpay Test Mode key.');
  if (!/^order_[a-zA-Z0-9]+$/.test(razorpayOrderId || '') || !Number.isSafeInteger(amountPaise) || amountPaise <= 0 || currency !== 'INR') {
    throw new Error('Invalid checkout details. Please create a new order.');
  }
  return {
    key: keyId, amount: amountPaise, currency, order_id: razorpayOrderId,
    name: 'Agentic Commerce', description: productName,
    theme: { color: '#f5b942' },
    // Netbanking opens Razorpay's mock bank page with Success/Failure buttons.
    // Keep Cards available as the other sandbox payment method.
    config: { display: {
      blocks: { sandbox: { name: 'Test payment methods', instruments: [{ method: 'netbanking' }, { method: 'card' }] } },
      sequence: ['block.sandbox'], preferences: { show_default_blocks: false },
    } },
    retry: { enabled: false },
  };
}

// One terminal result per popup, even when failure/success and dismiss fire
// together. Close a failed popup before allowing a fresh payment attempt.
export async function openRazorpayCheckout(details, { signal } = {}) {
  if (activeCheckout) throw new Error('A checkout is already open. Complete or close it first.');
  activeCheckout = true;
  try {
    const options = buildCheckoutOptions(details);
    await loadRazorpay();
    if (signal?.aborted) return { dismissed: true };
    return await new Promise((resolve, reject) => {
      let settled = false;
      let checkout;
      const finish = (value, error, close = false) => {
        if (settled) return;
        settled = true;
        signal?.removeEventListener('abort', abort);
        if (close) {
          try { checkout?.close(); } catch { /* Already closed by the gateway. */ }
        }
        if (error) reject(error);
        else resolve(value);
      };
      const abort = () => finish({ dismissed: true }, null, true);
      signal?.addEventListener('abort', abort, { once: true });
      try {
        checkout = new window.Razorpay({
          ...options,
          handler: (response) => {
            if (response?.razorpay_order_id !== details.razorpayOrderId || !response.razorpay_payment_id || !response.razorpay_signature) {
              finish(null, new Error('The payment response was incomplete. Check payment status before trying again.'), true);
            } else finish({ response });
          },
          modal: { confirm_close: true, ondismiss: () => finish({ dismissed: true }) },
        });
        checkout.on('payment.failed', ({ error } = {}) => {
          const reason = error?.description || 'The test payment was declined.';
          finish(null, new Error(`${reason} You can retry this order using Netbanking or Cards.`), true);
        });
        checkout.open();
      } catch (error) { finish(null, error, true); }
    });
  } finally {
    activeCheckout = false;
  }
}
