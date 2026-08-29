import { useCallback, useMemo, useState } from 'react';
import PanelHeader from './PanelHeader';
import PaymentBadge from './PaymentBadge';
import OrderAuthorizationCard from './OrderAuthorizationCard';
import ReviewModal from './ReviewModal';
import { verifyPayment } from '../lib/api';
import { openRazorpayCheckout } from '../lib/razorpay';
import { deriveOrdersFromAuditLogs, getVerificationStatus } from '../utils/orders';
import { formatINR } from '../utils/format';

const PENDING_STATES = new Set(['PENDING_AUTH', 'PROCESSING', 'VERIFYING']);

export default function HitlPanel({ auditLogs, sessionId }) {
  const [localStatus, setLocalStatus] = useState({}); // razorpayOrderId -> status override
  const [reviewOrder, setReviewOrder] = useState(null);
  const [checkoutError, setCheckoutError] = useState(null);

  const orders = useMemo(() => deriveOrdersFromAuditLogs(auditLogs), [auditLogs]);

  const resolvedOrders = useMemo(
    () =>
      orders.map((o) => {
        const auditStatus = getVerificationStatus(o.razorpayOrderId, auditLogs);
        const status = localStatus[o.razorpayOrderId] ?? auditStatus ?? 'PENDING_AUTH';
        return { ...o, status };
      }),
    [orders, auditLogs, localStatus]
  );

  const pendingOrder = [...resolvedOrders].reverse().find((o) => PENDING_STATES.has(o.status));
  const historyOrders = resolvedOrders.filter((o) => o.razorpayOrderId !== pendingOrder?.razorpayOrderId);

  const setStatus = useCallback((razorpayOrderId, status) => {
    setLocalStatus((prev) => ({ ...prev, [razorpayOrderId]: status }));
  }, []);

  const runCheckout = useCallback(
    (order) => {
      setCheckoutError(null);
      setStatus(order.razorpayOrderId, 'PROCESSING');

      openRazorpayCheckout({
        keyId: order.razorpayKeyId,
        amountPaise: order.amountPaise,
        razorpayOrderId: order.razorpayOrderId,
        productName: order.product,
        shippingAddress: order.shippingAddress,
        onSuccess: async (response) => {
          setStatus(order.razorpayOrderId, 'VERIFYING');
          try {
            const result = await verifyPayment({
              razorpayOrderId: response.razorpay_order_id,
              razorpayPaymentId: response.razorpay_payment_id,
              razorpaySignature: response.razorpay_signature,
              sessionId,
            });
            setStatus(order.razorpayOrderId, result.status);
          } catch (err) {
            setCheckoutError(err.message);
            setStatus(order.razorpayOrderId, 'FAILED');
          }
        },
        onDismiss: () => setStatus(order.razorpayOrderId, 'PENDING_AUTH'),
        onError: (message) => {
          setCheckoutError(message);
          setStatus(order.razorpayOrderId, 'PENDING_AUTH');
        },
      });
    },
    [sessionId, setStatus]
  );

  return (
    <section className="flex min-h-0 flex-col bg-panel">
      <PanelHeader
        icon="🛡️"
        title="Human-in-the-Loop Approval"
        subtitle="Authorize agent-initiated payments"
        topBarClassName="bg-authorize"
      />

      <div className="flex-1 space-y-4 overflow-y-auto px-4 py-4">
        {checkoutError && (
          <div className="break-words rounded-lg border border-signal-error/40 bg-signal-error/10 px-3 py-2 text-[12px] text-signal-error">
            {checkoutError}
          </div>
        )}

        {pendingOrder ? (
          <OrderAuthorizationCard
            order={pendingOrder}
            onQuickAuthorize={() => runCheckout(pendingOrder)}
            onReviewApprove={() => setReviewOrder(pendingOrder)}
          />
        ) : (
          <EmptyState />
        )}

        {historyOrders.length > 0 && (
          <div className="pt-1">
            <p className="mb-2 font-mono text-[10px] font-semibold uppercase tracking-[0.2em] text-ink-faint">
              Order History
            </p>
            <div className="space-y-2">
              {[...historyOrders].reverse().map((o) => (
                <HistoryOrderCard key={o.razorpayOrderId} order={o} />
              ))}
            </div>
          </div>
        )}
      </div>

      {reviewOrder && (
        <ReviewModal
          order={reviewOrder}
          onConfirm={() => {
            runCheckout(reviewOrder);
            setReviewOrder(null);
          }}
          onCancel={() => setReviewOrder(null)}
        />
      )}
    </section>
  );
}

function HistoryOrderCard({ order }) {
  return (
    <div className="flex items-center justify-between gap-3 rounded-xl border border-hairline bg-panel-elevated px-3.5 py-3">
      <div className="min-w-0">
        <p className="truncate text-[12.5px] font-medium text-ink">
          {order.quantity} × {order.product}
        </p>
        <p className="font-mono text-[11px] text-ink-faint">{formatINR(order.amountPaise)}</p>
      </div>
      <PaymentBadge status={order.status} />
    </div>
  );
}

function EmptyState() {
  return (
    <div className="flex flex-col items-center justify-center rounded-2xl border border-dashed border-hairline px-6 py-14 text-center">
      <span className="text-2xl" aria-hidden="true">
        🧾
      </span>
      <p className="mt-3 text-[13px] font-medium text-ink-muted">No pending authorizations</p>
      <p className="mt-1 max-w-[220px] text-[11.5px] leading-relaxed text-ink-faint">
        Ask Nova to buy something in the chat panel — an authorization card will appear here the moment an
        order is created.
      </p>
    </div>
  );
}
