/**
 * Opens the standard Razorpay Checkout popup (loaded via the <script> tag in
 * index.html) for a previously-created Sandbox order. All amount/currency
 * validation ultimately happens server-side against the real order — this
 * is just the client-side trigger + callback wiring.
 */
export function openRazorpayCheckout({
  keyId,
  amountPaise,
  razorpayOrderId,
  productName,
  shippingAddress,
  onSuccess,
  onDismiss,
  onError,
}) {
  if (typeof window === 'undefined' || !window.Razorpay) {
    onError?.('Razorpay Checkout script failed to load — check your connection and refresh.');
    return;
  }
  if (!keyId) {
    onError?.('Missing Razorpay key — the backend did not return a razorpay_key_id for this order.');
    return;
  }

  const options = {
    key: keyId,
    amount: amountPaise,
    currency: 'INR',
    name: 'Agentic Commerce',
    description: productName,
    order_id: razorpayOrderId,
    notes: { shipping_address: shippingAddress ?? '' },
    theme: { color: '#f5b942' },
    // Explicitly enable UPI alongside the account's other configured
    // methods (card/netbanking/wallet stay on unless set to false here).
    // In Razorpay Test Mode, use the UPI ID success@razorpay to simulate a
    // successful payment, or failure@razorpay to simulate a failed one.
    method: { upi: true },
    handler: (response) => onSuccess?.(response),
    modal: {
      ondismiss: () => onDismiss?.(),
    },
  };

  const checkout = new window.Razorpay(options);
  checkout.on('payment.failed', (response) => {
    onError?.(response?.error?.description || 'Payment failed.');
  });
  checkout.open();
}
