import { formatINR, shortId } from '../utils/format';
import { QUICK_AUTHORIZE_THRESHOLD_PAISE } from '../utils/orders';

/**
 * Styled as an authorization document — a torn boarding-pass stub — because
 * that's literally what this is: a real financial instrument that requires
 * a human signature before value moves. The perforation between the order
 * details and the action stub is the one deliberate visual risk on this
 * page; everything else stays quiet so this card reads as "the moment that
 * matters."
 */
export default function OrderAuthorizationCard({ order, onQuickAuthorize, onReviewApprove }) {
  const isQuickPath = order.amountPaise <= QUICK_AUTHORIZE_THRESHOLD_PAISE;
  const isBusy = order.status === 'PROCESSING' || order.status === 'VERIFYING';

  return (
    <div className="animate-card-issue relative overflow-hidden rounded-2xl border border-authorize/30 bg-panel-elevated shadow-[0_0_0_1px_rgba(245,185,66,0.06),0_20px_40px_-20px_rgba(245,185,66,0.25)]">
      {/* Corner stamp — outlined/unstamped until a decision is made. */}
      <div className="pointer-events-none absolute right-4 top-4 rotate-[-8deg] rounded-md border-2 border-dashed border-authorize/50 px-2 py-1 font-mono text-[10px] font-semibold uppercase tracking-[0.15em] text-authorize/70">
        Auth Required
      </div>

      {/* --- Stub 1: order details --- */}
      <div className="px-5 pt-5">
        <p className="font-mono text-[10px] font-semibold uppercase tracking-[0.2em] text-authorize">
          Order Authorization
        </p>
        <h3 className="mt-1 max-w-[75%] font-display text-lg font-semibold leading-snug text-ink">
          {order.product}
        </h3>
        <p className="mt-0.5 text-[12px] text-ink-muted">Qty {order.quantity}</p>

        <div className="mt-4 flex items-end justify-between border-t border-dashed border-seam pt-4">
          <span className="font-mono text-[10px] uppercase tracking-[0.2em] text-ink-faint">Total Amount</span>
          <span className="font-mono text-3xl font-bold text-ink">{formatINR(order.amountPaise)}</span>
        </div>

        <div className="mt-4">
          <p className="font-mono text-[10px] uppercase tracking-[0.2em] text-ink-faint">Delivery Address</p>
          <p className="mt-1.5 break-words rounded-lg border border-seam bg-canvas/60 p-3 text-[12px] leading-relaxed text-ink-muted">
            {order.shippingAddress}
          </p>
        </div>

        <p className="mt-3 font-mono text-[10px] text-ink-faint">
          razorpay_order_id: {shortId(order.razorpayOrderId, 20)}
        </p>
      </div>

      {/* --- Perforation --- */}
      <div className="relative my-5">
        <div className="border-t border-dashed border-hairline" />
        <span className="absolute left-[-10px] top-1/2 h-5 w-5 -translate-y-1/2 rounded-full bg-panel" />
        <span className="absolute right-[-10px] top-1/2 h-5 w-5 -translate-y-1/2 rounded-full bg-panel" />
      </div>

      {/* --- Stub 2: action --- */}
      <div className="px-5 pb-5">
        <div
          className="mb-4 h-6 w-full opacity-30"
          style={{
            backgroundImage:
              'repeating-linear-gradient(90deg, var(--color-ink-faint) 0 2px, transparent 2px 6px)',
          }}
          aria-hidden="true"
        />

        {isQuickPath ? (
          <>
            <button
              type="button"
              disabled={isBusy}
              onClick={onQuickAuthorize}
              className="flex w-full items-center justify-center gap-2 rounded-xl bg-signal-pay px-4 py-3 text-[13px] font-semibold text-canvas transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {isBusy ? <Spinner /> : <span aria-hidden="true">⚡</span>}
              {statusLabel(order.status, 'Quick Authorize (Auto-Pay Bounded)')}
            </button>
            <p className="mt-2 text-center text-[11px] text-ink-faint">
              ≤ ₹500 — fast-tracked, single tap to open Razorpay Checkout.
            </p>
          </>
        ) : (
          <>
            <button
              type="button"
              disabled={isBusy}
              onClick={onReviewApprove}
              className="flex w-full items-center justify-center gap-2 rounded-xl bg-authorize px-4 py-3 text-[13px] font-semibold text-canvas transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {isBusy ? <Spinner /> : <span aria-hidden="true">🛡️</span>}
              {statusLabel(order.status, 'Review & Approve via Razorpay')}
            </button>
            <p className="mt-2 text-center text-[11px] text-ink-faint">
              Over ₹500 — requires an explicit review step before payment.
            </p>
          </>
        )}
      </div>
    </div>
  );
}

function statusLabel(status, defaultLabel) {
  if (status === 'PROCESSING') return 'Waiting for Razorpay Checkout…';
  if (status === 'VERIFYING') return 'Verifying signature…';
  return defaultLabel;
}

function Spinner() {
  return (
    <svg className="h-3.5 w-3.5 animate-spin" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
      <path className="opacity-90" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z" />
    </svg>
  );
}
