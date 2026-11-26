import { useCallback, useEffect, useRef, useState } from 'react';
import { prepareCheckout, verifyPayment, checkPaymentStatus } from '../lib/api';
import { openRazorpayCheckout } from '../lib/razorpay';

export function useCheckout(sessionId) {
  const [localStatus, setLocalStatus] = useState({});
  const [checkoutError, setCheckoutError] = useState(null);
  const running = useRef(false);
  const lifecycle = useRef(null);

  useEffect(() => {
    const controller = new AbortController();
    lifecycle.current = controller;
    return () => controller.abort();
  }, []);

  const run = useCallback(async (order, statusOnly = false) => {
    if (running.current) return;
    running.current = true;
    const signal = lifecycle.current.signal;
    const update = (status) => {
      if (!signal.aborted) setLocalStatus((prev) => ({ ...prev, [order.razorpayOrderId]: status }));
    };
    const showError = (message) => {
      if (!signal.aborted) setCheckoutError(message);
    };
    const input = { razorpayOrderId: order.razorpayOrderId, sessionId };
    let opened = false;
    showError(null);
    update(statusOnly ? 'VERIFYING' : 'PROCESSING');
    try {
      let state = statusOnly ? await checkPaymentStatus(input) : await prepareCheckout(input);
      if (signal.aborted) return;
      if (!statusOnly && state.status === 'READY') {
        opened = true;
        const outcome = await openRazorpayCheckout(state.checkout, { signal });
        if (signal.aborted) return;
        update('VERIFYING');
        state = outcome.response
          ? await verifyPayment({ ...input, razorpayPaymentId: outcome.response.razorpay_payment_id,
              razorpaySignature: outcome.response.razorpay_signature })
          : await checkPaymentStatus(input);
      }
      update(state.verified && state.status === 'VERIFIED' ? 'VERIFIED'
        : state.status === 'READY' ? 'PENDING_AUTH' : 'PAYMENT_PENDING');
    } catch (error) {
      if (signal.aborted) return;
      // Once the popup was attempted, recover the server's state before
      // offering another payment. A lost callback is not a failed payment.
      if (opened) {
        try {
          const state = await checkPaymentStatus(input);
          if (state.verified && state.status === 'VERIFIED') { update('VERIFIED'); return; }
          update(state.status === 'READY' ? 'PENDING_AUTH' : 'PAYMENT_PENDING');
        } catch { update('PAYMENT_PENDING'); }
      } else {
        update(['ORDER_CLOSED', 'KEY_MISMATCH', 'ORDER_NOT_FOUND'].includes(error.code)
          ? 'FAILED' : statusOnly ? 'PAYMENT_PENDING' : 'PENDING_AUTH');
      }
      showError(error.message);
    } finally { running.current = false; }
  }, [sessionId]);

  return { localStatus, checkoutError, runCheckout: run, checkStatus: (order) => run(order, true) };
}
