import crypto from 'node:crypto';

export class PaymentError extends Error {
  constructor(code, message, statusCode = 400) {
    super(message);
    this.code = code;
    this.statusCode = statusCode;
  }
}

const validId = (value, prefix) => typeof value === 'string' && new RegExp(`^${prefix}_[a-zA-Z0-9]{1,80}$`).test(value);

// Inject the gateway and storage to test the lifecycle without real payments.
export function createPaymentService({ db, razorpay, keyId, keySecret, logAudit }) {
  const inFlight = new Map();
  const findOrder = db.prepare(`SELECT orders.*, products.name AS product FROM orders
    JOIN products ON products.id = orders.product_id WHERE razorpay_order_id = ?`);

  function getOrder(input) {
    if (!keyId?.startsWith('rzp_test_') || !keySecret) {
      throw new PaymentError('TEST_MODE_REQUIRED', 'Configure matching Razorpay Test Mode keys on the server.', 503);
    }
    if (!validId(input.razorpay_order_id, 'order') || typeof input.session_id !== 'string' || !input.session_id.trim()) {
      throw new PaymentError('INVALID_REQUEST', 'A valid order ID and checkout session are required.');
    }
    const order = findOrder.get(input.razorpay_order_id);
    if (!order) throw new PaymentError('ORDER_NOT_FOUND', 'This order was not found. Ask Nova to create a new order.', 404);
    // Older orders omitted session_id; use their original audit event for ownership.
    const ownsLegacyOrder = !order.session_id && db.prepare(`SELECT 1 FROM audit_logs
      WHERE session_id = ? AND step_type = 'TOOL_RESULT'
      AND json_extract(payload, '$.output.razorpay_order_id') = ?`).get(input.session_id, order.razorpay_order_id);
    if (order.session_id !== input.session_id && !ownsLegacyOrder) {
      throw new PaymentError('ORDER_NOT_FOUND', 'This order does not belong to this session.', 404);
    }
    if (order.razorpay_key_id && order.razorpay_key_id !== keyId) {
      throw new PaymentError('KEY_MISMATCH', 'The test keys changed after this order was created. Ask Nova for a new order.', 409);
    }
    if (order.status === 'FAILED') {
      throw new PaymentError('ORDER_CLOSED', 'This old order was closed and its stock released. Ask Nova for a new order.', 409);
    }
    return order;
  }

  function result(order, status = order.status) {
    return { verified: status === 'VERIFIED', status, order_id: order.id,
      razorpay_order_id: order.razorpay_order_id, razorpay_payment_id: order.razorpay_payment_id };
  }

  function checkPayment(order, payment) {
    if (!validId(payment?.id, 'pay') || payment.order_id !== order.razorpay_order_id ||
        Number(payment.amount) !== order.amount || payment.currency !== 'INR') {
      throw new PaymentError('PAYMENT_MISMATCH', 'The payment details do not match this order.', 409);
    }
  }

  async function confirm(order, payment, sessionId) {
    checkPayment(order, payment);
    if (payment.status === 'authorized') {
      try {
        payment = await razorpay.payments.capture(payment.id, order.amount, 'INR');
      } catch (err) {
        // Auto-capture can win the race, or its response can be lost.
        payment = await razorpay.payments.fetch(payment.id);
        if (payment.status !== 'captured') throw err;
      }
      checkPayment(order, payment);
    }
    if (payment.status !== 'captured') return result(order, 'PAYMENT_PENDING');
    return db.transaction(() => {
      const changed = db.prepare(`UPDATE orders SET status = 'VERIFIED', razorpay_payment_id = ?
        WHERE id = ? AND status = 'CREATED'`).run(payment.id, order.id);
      if (changed.changes) {
        logAudit(order.session_id || sessionId, 'PAYMENT_VERIFICATION', 'system', {
          razorpay_order_id: order.razorpay_order_id, razorpay_payment_id: payment.id,
          verified: true, status: 'VERIFIED', payment_status: 'captured',
        });
      }
      return result(findOrder.get(order.razorpay_order_id));
    })();
  }

  async function reconcile(order, sessionId) {
    if (order.status === 'VERIFIED') return result(order);
    const remote = await razorpay.orders.fetch(order.razorpay_order_id);
    if (remote.id !== order.razorpay_order_id || Number(remote.amount) !== order.amount || remote.currency !== 'INR') {
      throw new PaymentError('ORDER_MISMATCH', 'Razorpay order details do not match the saved purchase.', 409);
    }
    const { items = [] } = await razorpay.orders.fetchPayments(order.razorpay_order_id);
    const payment = items.find((p) => p.status === 'captured') || items.find((p) => p.status === 'authorized');
    if (payment) return confirm(order, payment, sessionId);
    if (remote.status === 'paid') return result(order, 'PAYMENT_PENDING');
    // A created payment has not been authorized. Failed browser redirects can
    // leave it in this state; allow retry on the SAME order. Razorpay allows
    // only one captured payment per order, including late authorizations.
    return result(order, 'READY');
  }

  // Serialize callbacks/status checks so capture and success logging happen once.
  async function locked(input, action) {
    const order = getOrder(input);
    const id = order.razorpay_order_id;
    const previous = inFlight.get(id) || Promise.resolve();
    const task = previous.catch(() => {}).then(() => action(getOrder(input)));
    inFlight.set(id, task);
    try { return await task; }
    finally { if (inFlight.get(id) === task) inFlight.delete(id); }
  }

  return {
    prepare: (input) => locked(input, async (order) => {
      const state = await reconcile(order, input.session_id);
      if (state.status !== 'READY') return state;
      return { ...state, checkout: { keyId, razorpayOrderId: order.razorpay_order_id,
        amountPaise: order.amount, currency: 'INR', productName: order.product } };
    }),
    status: (input) => locked(input, (order) => reconcile(order, input.session_id)),
    verify: (input) => locked(input, async (order) => {
      if (!validId(input.razorpay_payment_id, 'pay') || typeof input.razorpay_signature !== 'string' ||
          !/^[a-f0-9]{64}$/i.test(input.razorpay_signature)) {
        throw new PaymentError('INVALID_SIGNATURE', 'The payment response is incomplete. Check payment status to recover it.');
      }
      const expected = crypto.createHmac('sha256', keySecret)
        .update(`${order.razorpay_order_id}|${input.razorpay_payment_id}`).digest();
      if (!crypto.timingSafeEqual(expected, Buffer.from(input.razorpay_signature, 'hex'))) {
        // Invalid client input cannot cancel an order or restore reserved stock.
        throw new PaymentError('INVALID_SIGNATURE', 'Payment signature could not be verified. Check payment status to recover it.');
      }
      if (order.status === 'VERIFIED') {
        if (order.razorpay_payment_id !== input.razorpay_payment_id) {
          throw new PaymentError('PAYMENT_MISMATCH', 'This order was already paid with a different payment.', 409);
        }
        return result(order);
      }
      const payment = await razorpay.payments.fetch(input.razorpay_payment_id);
      if (payment.id !== input.razorpay_payment_id) throw new PaymentError('PAYMENT_MISMATCH', 'Unexpected payment returned by Razorpay.', 409);
      return confirm(order, payment, input.session_id);
    }),
  };
}
