/** Orders at or below this amount get the low-friction "Quick Authorize" path. */
export const QUICK_AUTHORIZE_THRESHOLD_PAISE = 50_000; // ₹500

/**
 * The backend doesn't return structured order data from /api/chat (only
 * text). Instead, every successful create_razorpay_order call is logged as
 * a TOOL_RESULT audit event with the full order payload — so the HITL panel
 * derives its order list from the same /api/audit-trail feed the right
 * panel already polls. One source of truth, two views.
 */
export function deriveOrdersFromAuditLogs(logs) {
  const orders = [];
  const seen = new Set();

  for (const log of logs) {
    if (log.step_type !== 'TOOL_RESULT') continue;
    if (log.payload?.tool !== 'create_razorpay_order') continue;

    const out = log.payload.output;
    if (!out?.success || !out.razorpay_order_id) continue;
    if (seen.has(out.razorpay_order_id)) continue;

    seen.add(out.razorpay_order_id);
    orders.push({
      razorpayOrderId: out.razorpay_order_id,
      localOrderId: out.order_id,
      product: out.product,
      quantity: out.quantity,
      amountPaise: out.amount_paise,
      shippingAddress: out.shipping_address,
      razorpayKeyId: out.razorpay_key_id,
      createdAt: log.timestamp,
    });
  }

  return orders; // logs arrive chronological (oldest first), so this is too
}

/** Look up the most recent PAYMENT_VERIFICATION result for an order, if any. */
export function getVerificationStatus(razorpayOrderId, logs) {
  for (let i = logs.length - 1; i >= 0; i--) {
    const log = logs[i];
    if (log.step_type === 'PAYMENT_VERIFICATION' && log.payload?.razorpay_order_id === razorpayOrderId) {
      return log.payload.status; // 'VERIFIED' | 'FAILED'
    }
  }
  return null;
}
