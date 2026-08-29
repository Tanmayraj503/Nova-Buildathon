const STATUS_STYLES = {
  PENDING_AUTH: {
    label: 'Awaiting Authorization',
    icon: '🔒',
    classes: 'bg-ink-faint/10 text-ink-muted border-hairline',
  },
  PROCESSING: {
    label: 'Opening Razorpay…',
    icon: '⏳',
    classes: 'bg-authorize/10 text-authorize border-authorize/40',
  },
  VERIFYING: {
    label: 'Verifying Signature…',
    icon: '⏳',
    classes: 'bg-signal-tool/10 text-signal-tool border-signal-tool/40',
  },
  VERIFIED: {
    label: 'Payment Verified',
    icon: '✅',
    classes: 'bg-signal-pay/10 text-signal-pay border-signal-pay/40',
  },
  FAILED: {
    label: 'Payment Failed',
    icon: '❌',
    classes: 'bg-signal-error/10 text-signal-error border-signal-error/40',
  },
};

export default function PaymentBadge({ status }) {
  const style = STATUS_STYLES[status] ?? STATUS_STYLES.PENDING_AUTH;
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-medium ${style.classes}`}
    >
      <span aria-hidden="true">{style.icon}</span>
      {style.label}
    </span>
  );
}
