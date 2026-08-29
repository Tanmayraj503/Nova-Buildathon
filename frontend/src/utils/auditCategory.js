import { formatINR, truncate } from './format';

/**
 * The backend (see /api/audit-trail) logs raw step_types: USER_MESSAGE,
 * AGENT_RESPONSE, TOOL_CALL, TOOL_RESULT, GUARDRAIL_BLOCK, TOOL_ERROR,
 * PAYMENT_VERIFICATION. This maps each logged event to one of the five
 * judge-facing categories, each with a fixed color identity:
 *   USER_INPUT (blue) · AGENT_REASONING (violet) · TOOL_CALL (amber) ·
 *   RAZORPAY_API (emerald) · ERROR (red)
 */
export const CATEGORIES = {
  USER_INPUT: { label: 'User Input', color: 'signal-user', order: 0 },
  AGENT_REASONING: { label: 'Agent Reasoning', color: 'signal-agent', order: 1 },
  TOOL_CALL: { label: 'Tool Call', color: 'signal-tool', order: 2 },
  RAZORPAY_API: { label: 'Razorpay API', color: 'signal-pay', order: 3 },
  ERROR: { label: 'Guardrail / Error', color: 'signal-error', order: 4 },
};

// Written as literal class strings (not template-built) so Tailwind's v4
// source scanner reliably detects and generates them.
export const CATEGORY_STYLES = {
  USER_INPUT: {
    dot: 'bg-signal-user',
    text: 'text-signal-user',
    border: 'border-signal-user/40',
    bg: 'bg-signal-user/10',
  },
  AGENT_REASONING: {
    dot: 'bg-signal-agent',
    text: 'text-signal-agent',
    border: 'border-signal-agent/40',
    bg: 'bg-signal-agent/10',
  },
  TOOL_CALL: {
    dot: 'bg-signal-tool',
    text: 'text-signal-tool',
    border: 'border-signal-tool/40',
    bg: 'bg-signal-tool/10',
  },
  RAZORPAY_API: {
    dot: 'bg-signal-pay',
    text: 'text-signal-pay',
    border: 'border-signal-pay/40',
    bg: 'bg-signal-pay/10',
  },
  ERROR: {
    dot: 'bg-signal-error',
    text: 'text-signal-error',
    border: 'border-signal-error/40',
    bg: 'bg-signal-error/10',
  },
};

function isRazorpayToolResult(payload) {
  return payload?.tool === 'create_razorpay_order';
}

/** Classify a raw audit_logs row into { category, summary }. */
export function classifyLog(log) {
  const { step_type: stepType, payload, actor } = log;

  switch (stepType) {
    case 'USER_MESSAGE':
      return { category: 'USER_INPUT', summary: `"${truncate(payload?.text, 120)}"` };

    case 'AGENT_RESPONSE': {
      const parts = Array.isArray(payload?.parts) ? payload.parts : [];
      const textPart = parts.find((p) => typeof p?.text === 'string' && p.text.length > 0);
      const functionCallParts = parts.filter((p) => p?.functionCall);
      if (textPart?.text) return { category: 'AGENT_REASONING', summary: truncate(textPart.text, 140) };
      if (functionCallParts.length) {
        return {
          category: 'AGENT_REASONING',
          summary: `Decided to call ${functionCallParts.map((p) => p.functionCall.name).join(', ')}`,
        };
      }
      return { category: 'AGENT_REASONING', summary: `finish_reason: ${payload?.finish_reason ?? 'unknown'}` };
    }

    case 'TOOL_CALL':
      return {
        category: 'TOOL_CALL',
        summary: `${payload?.tool}(${truncate(JSON.stringify(payload?.input ?? {}), 100)})`,
      };

    case 'TOOL_RESULT': {
      if (isRazorpayToolResult(payload)) {
        const out = payload.output ?? {};
        const summary = out.success
          ? `Order created — ${out.quantity}× ${out.product} for ${formatINR(out.amount_paise)}`
          : `${out.error}: ${truncate(out.message, 100)}`;
        return { category: out.success ? 'RAZORPAY_API' : 'ERROR', summary };
      }
      return {
        category: 'TOOL_CALL',
        summary: `${payload?.tool} → ${truncate(JSON.stringify(payload?.output ?? {}), 100)}`,
      };
    }

    case 'GUARDRAIL_BLOCK':
      return {
        category: 'ERROR',
        summary: `Blocked by guardrail: ${payload?.reason ?? 'unknown'}`,
      };

    case 'TOOL_ERROR':
      return { category: 'ERROR', summary: truncate(payload?.message, 140) };

    case 'MODEL_FALLBACK':
      return {
        category: 'AGENT_REASONING',
        summary: `Switched model: ${payload?.from ?? '?'} → ${payload?.to ?? '?'} (${payload?.reason ?? 'unknown reason'})`,
      };

    case 'AGENT_ERROR':
      return { category: 'ERROR', summary: truncate(payload?.message, 140) };

    case 'PAYMENT_VERIFICATION':
      return {
        category: 'RAZORPAY_API',
        summary: `Signature ${payload?.verified ? 'valid' : 'invalid'} → status: ${payload?.status}`,
      };

    default:
      return { category: actor === 'user' ? 'USER_INPUT' : 'AGENT_REASONING', summary: stepType };
  }
}
