import { GoogleGenAI } from '@google/genai';
import 'dotenv/config';
import { tools } from './tools.js';
import { searchCatalog, createRazorpayOrder } from './toolHandlers.js';
import { logAudit } from '../lib/audit.js';

// Ordered by preference. The agent starts at index 0 and only ever moves
// forward — never back — when the currently active model's quota is
// exhausted. currentModelIndex is module-level (shared across all sessions
// in this process) because Gemini free-tier quota is scoped to the API
// key/project, not to an individual chat session, so once one model is
// known to be exhausted there's no point re-trying it for a different user.
// gemini-3.7-flash was tried and dropped — it repeatedly hit quota/deadline
// issues on the free tier, so the chain now starts at 3.6-flash instead.
const MODEL_FALLBACK_CHAIN = ['gemini-3.6-flash', 'gemini-3.5-flash', 'gemini-3.5-flash-lite'];
let currentModelIndex = 0;

const MAX_AGENT_TURNS = 6; // safety cap on tool-use round trips per user message
const MODEL_TIMEOUT_MS = 20_000; // bound each model attempt so a hung/unresponsive endpoint fails fast into fallback

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

const SYSTEM_PROMPT = `
You are Nova, an agentic shopping assistant for a Razorpay-powered commerce demo store.

Your job:
- Help the user find products using the search_catalog tool. Never invent prices, stock, or product
  details — always look them up.
- When the user wants to buy something, confirm the exact product and quantity with them.
- CRITICAL RULE: You must ALWAYS collect an explicit shipping address, typed out by the user in this
  conversation, before calling create_razorpay_order. Never assume, guess, reuse from a previous
  unrelated context, or infer an address. If you do not yet have one, ask for it directly and wait
  for the user's reply before calling the tool.
- Only call create_razorpay_order once you have: a specific product_id, a quantity, an explicit
  shipping address from the user, and a user_id.
- create_razorpay_order enforces hard guardrails you cannot override: a ₹5,000 total spend limit per
  order, stock availability, and the address requirement above. If it returns an error
  (ADDRESS_REQUIRED, SPEND_LIMIT_EXCEEDED, OUT_OF_STOCK, PRODUCT_NOT_FOUND, or RAZORPAY_ERROR),
  explain clearly and politely to the user what went wrong and what they could do instead
  (e.g. suggest a cheaper alternative, a lower quantity, or a different in-stock product). Do not
  retry the same call with the same inputs.
- After a successful order, tell the user their order was created and that they'll be redirected to
  complete payment via Razorpay Checkout; do not claim the payment itself is complete — that is
  confirmed separately once /api/verify-payment validates the signature.
- Be concise, transparent about prices (always in INR), and never fabricate order or payment status.
- Format replies in plain text only — no markdown asterisks, bullets, or headers.
`.trim();

/**
 * True for errors worth cascading to the next model in the fallback chain:
 * quota/rate-limit responses (429 / RESOURCE_EXHAUSTED), server-side
 * timeouts (504 / DEADLINE_EXCEEDED — Google's backend gave up before
 * finishing, as opposed to a client-side abort), an overloaded model
 * (503 / UNAVAILABLE), and client-side request timeouts (AbortError). Any
 * of these mean "this model isn't responding usefully right now," which a
 * different model can often fix. Anything else (bad request, auth failure,
 * etc.) won't be fixed by switching models, so it's excluded and left to
 * fail fast instead.
 */
function isRetryableModelError(err) {
  if ([429, 503, 504].includes(err?.status)) return true;
  if (err?.name === 'AbortError') return true; // fetch-level timeout/abort
  const message = typeof err?.message === 'string' ? err.message : '';
  return /RESOURCE_EXHAUSTED|DEADLINE_EXCEEDED|UNAVAILABLE|timed?\s*out/i.test(message);
}

/** Short label for the audit trail / logs describing *why* a model was skipped. */
function describeRetryReason(err) {
  const message = typeof err?.message === 'string' ? err.message : '';
  if (err?.status === 429 || /RESOURCE_EXHAUSTED/i.test(message)) return 'QUOTA_EXCEEDED';
  if (err?.status === 504 || /DEADLINE_EXCEEDED/i.test(message)) return 'DEADLINE_EXCEEDED';
  if (err?.status === 503 || /UNAVAILABLE/i.test(message)) return 'MODEL_UNAVAILABLE';
  if (err?.name === 'AbortError' || /timed?\s*out/i.test(message)) return 'TIMEOUT';
  return 'UNKNOWN';
}

/**
 * Calls generateContent with the currently active model, bounded by
 * MODEL_TIMEOUT_MS. On a retryable error (quota exhausted or a timeout),
 * permanently advances currentModelIndex to the next model in
 * MODEL_FALLBACK_CHAIN (logging the switch to the audit trail) and retries —
 * cascading through the chain until one responds or every model has been
 * tried. Any other error is re-thrown immediately without switching models.
 */
async function generateContentWithFallback({ sessionId, contents }) {
  for (;;) {
    const model = MODEL_FALLBACK_CHAIN[currentModelIndex];
    try {
      return await ai.models.generateContent({
        model,
        contents,
        config: {
          systemInstruction: SYSTEM_PROMPT,
          tools: [{ functionDeclarations: tools }],
          httpOptions: { timeout: MODEL_TIMEOUT_MS },
        },
      });
    } catch (err) {
      const hasNextModel = currentModelIndex < MODEL_FALLBACK_CHAIN.length - 1;
      if (isRetryableModelError(err) && hasNextModel) {
        const fromModel = model;
        const reason = describeRetryReason(err);
        currentModelIndex += 1;
        const toModel = MODEL_FALLBACK_CHAIN[currentModelIndex];
        console.warn(`${reason} on ${fromModel} — switching to ${toModel}`);
        logAudit(sessionId, 'MODEL_FALLBACK', 'system', { from: fromModel, to: toModel, reason });
        continue; // immediately retry the same request on the next model
      }
      throw err; // not recoverable by switching models — let the caller handle it
    }
  }
}

/**
 * Runs one turn of the agent loop for a user message: sends the conversation
 * to Gemini (with automatic quota-based model fallback), executes any
 * requested function calls, feeds results back, and repeats until Gemini
 * produces a final text reply (or the turn cap is hit).
 *
 * @param {object} params
 * @param {string} params.sessionId
 * @param {string} params.userId
 * @param {Array} params.messages - full conversation so far (Gemini `contents`
 *   shape: [{ role: 'user'|'model', parts: [...] }]), ending with the new user turn
 */
export async function runAgent({ sessionId, userId, messages }) {
  let conversation = [...messages];

  for (let turn = 0; turn < MAX_AGENT_TURNS; turn++) {
    let response;
    try {
      response = await generateContentWithFallback({ sessionId, contents: conversation });
    } catch (err) {
      // Never let a raw provider error (often a large JSON blob) reach the
      // chat UI as if it were Nova's reply — always resolve to a short,
      // human-readable message instead.
      console.error('Gemini request failed after exhausting the model fallback chain:', err);
      logAudit(sessionId, 'AGENT_ERROR', 'system', { message: err?.message ?? String(err), status: err?.status ?? null });
      const reason = describeRetryReason(err);
      const REASON_MESSAGES = {
        QUOTA_EXCEEDED: 'All available Gemini models are currently rate-limited — please wait a minute and try again.',
        DEADLINE_EXCEEDED: 'The AI service is taking too long to respond right now — please try again in a moment.',
        MODEL_UNAVAILABLE: 'The AI service is temporarily overloaded — please try again in a moment.',
        TIMEOUT: 'The AI service is taking too long to respond right now — please try again in a moment.',
      };
      return {
        reply: REASON_MESSAGES[reason] ?? 'Something went wrong while I was thinking — please try again in a moment.',
        conversation,
      };
    }

    const parts = response.candidates?.[0]?.content?.parts ?? [];
    const functionCalls = parts.filter((p) => p.functionCall).map((p) => p.functionCall);

    logAudit(sessionId, 'AGENT_RESPONSE', 'agent', {
      finish_reason: response.candidates?.[0]?.finishReason,
      parts,
    });

    conversation = [...conversation, { role: 'model', parts }];

    if (functionCalls.length === 0) {
      const text = parts.map((p) => p.text ?? '').join('');
      return { reply: text, conversation };
    }

    // Execute every functionCall part Gemini asked for, in order, and collect results.
    const functionResponseParts = [];
    for (const call of functionCalls) {
      logAudit(sessionId, 'TOOL_CALL', 'agent', { tool: call.name, input: call.args });

      let output;
      try {
        if (call.name === 'search_catalog') {
          output = searchCatalog(call.args);
        } else if (call.name === 'create_razorpay_order') {
          output = await createRazorpayOrder(
            { ...call.args, user_id: call.args?.user_id ?? userId },
            sessionId
          );
        } else {
          output = { error: 'UNKNOWN_TOOL', message: `No handler registered for tool "${call.name}".` };
        }
      } catch (err) {
        output = { error: 'TOOL_EXECUTION_ERROR', message: err.message };
        logAudit(sessionId, 'TOOL_ERROR', 'system', { tool: call.name, message: err.message });
      }

      logAudit(sessionId, 'TOOL_RESULT', 'system', { tool: call.name, output });

      functionResponseParts.push({
        functionResponse: {
          id: call.id, // present for models that support parallel function calling; harmless if undefined
          name: call.name,
          response: output,
        },
      });
    }

    conversation = [...conversation, { role: 'user', parts: functionResponseParts }];
  }

  // Turn cap hit without a final text reply — fail safe rather than loop forever.
  return {
    reply: "I've hit my reasoning limit on this request — could you rephrase or simplify it?",
    conversation,
  };
}
