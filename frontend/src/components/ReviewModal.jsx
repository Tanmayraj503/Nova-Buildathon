import { useEffect } from 'react';
import { formatINR } from '../utils/format';

export default function ReviewModal({ order, onConfirm, onCancel }) {
  useEffect(() => {
    function onKeyDown(e) {
      if (e.key === 'Escape') onCancel();
    }
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [onCancel]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-canvas/80 p-4 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-labelledby="review-modal-title"
    >
      <div className="w-full max-w-sm rounded-2xl border border-authorize/40 bg-panel-elevated p-5 shadow-2xl">
        <p className="font-mono text-[10px] font-semibold uppercase tracking-[0.2em] text-authorize">
          Human Review Required
        </p>
        <h3 id="review-modal-title" className="mt-1 font-display text-lg font-semibold text-ink">
          Confirm this payment
        </h3>
        <p className="mt-1.5 text-[12px] leading-relaxed text-ink-muted">
          This order exceeds the ₹500 auto-pay threshold, so it needs your explicit confirmation before
          Razorpay Checkout opens.
        </p>

        <dl className="mt-4 space-y-2 rounded-lg border border-seam bg-canvas/60 p-3 text-[12px]">
          <Row label="Item" value={`${order.quantity} × ${order.product}`} />
          <Row label="Amount" value={formatINR(order.amountPaise)} strong />
          <Row label="Deliver to" value={order.shippingAddress} wrap />
        </dl>

        <div className="mt-5 flex gap-2">
          <button
            type="button"
            onClick={onCancel}
            className="flex-1 rounded-xl border border-hairline px-4 py-2.5 text-[13px] font-medium text-ink-muted transition-colors hover:text-ink"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={onConfirm}
            className="flex-1 rounded-xl bg-authorize px-4 py-2.5 text-[13px] font-semibold text-canvas transition-opacity hover:opacity-90"
          >
            Confirm &amp; Pay
          </button>
        </div>
      </div>
    </div>
  );
}

function Row({ label, value, strong, wrap }) {
  return (
    <div className="flex items-start justify-between gap-3">
      <dt className="flex-shrink-0 font-mono text-[10px] uppercase tracking-wider text-ink-faint">{label}</dt>
      <dd
        className={`text-right ${wrap ? 'whitespace-pre-wrap' : ''} ${
          strong ? 'font-mono text-base font-bold text-ink' : 'text-ink-muted'
        }`}
      >
        {value}
      </dd>
    </div>
  );
}
