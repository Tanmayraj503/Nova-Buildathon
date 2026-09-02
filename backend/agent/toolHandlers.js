import db from '../db.js';
import razorpay from '../lib/razorpay.js';
import { logAudit } from '../lib/audit.js';

export const SPEND_LIMIT_PAISE = 500_000; // ₹5,000 autonomous spend cap
export const LOW_VALUE_THRESHOLD_PAISE = 100_000; // ₹1,000 — below this, actively try to upsell/cross-sell

const getProductById = db.prepare('SELECT * FROM products WHERE id = ?');
const getAllProducts = db.prepare(
  'SELECT id, name, description, price_inr, stock, category FROM products'
);
const searchProducts = db.prepare(`
  SELECT id, name, description, price_inr, stock, category
  FROM products
  WHERE name LIKE ? OR description LIKE ? OR category LIKE ?
`);
// Best upsell/cross-sell candidate for a given product: in stock, within a
// given price ceiling (so a suggestion can never itself trip the spend
// guardrail), preferring the same category, then the highest price under
// that ceiling (maximize order value) among the remaining candidates.
const findCandidateStmt = db.prepare(`
  SELECT id, name, description, price_inr, stock, category
  FROM products
  WHERE id != ? AND stock > 0 AND price_inr <= ?
  ORDER BY (category = ?) DESC, price_inr DESC
  LIMIT 1
`);

function formatProduct(p) {
  return {
    ...p,
    price_inr_display: `₹${(p.price_inr / 100).toLocaleString('en-IN')}`,
    in_stock: p.stock > 0,
  };
}

function findCandidate(excludeId, priceCeilingPaise, preferCategory) {
  return findCandidateStmt.get(excludeId, priceCeilingPaise, preferCategory);
}

/**
 * Deterministic upsell/cross-sell suggestion for ANY product — always
 * returns one (when a valid candidate exists), not just for out-of-stock or
 * low-value items, so a suggestion is available at every point in the
 * conversation the model might need one (a decline message, a spend-limit
 * block, or right before checkout). `reason` records why it was offered.
 *
 * Includes a ready-to-relay `note` sentence in addition to the structured
 * fields: attaching a separate JSON field and hoping the model notices and
 * mentions it on its own proved unreliable in testing — the model reliably
 * relays guardrail-style message text, so every consumer of this should
 * prefer embedding `note` directly into whatever text it's already relaying,
 * rather than leaving "should I mention this" up to the model's judgment.
 */
function findSuggestion(product, { priceCeilingPaise = SPEND_LIMIT_PAISE } = {}) {
  const isOutOfStock = product.stock === 0;
  const isLowValue = product.price_inr < LOW_VALUE_THRESHOLD_PAISE;
  const reason = isOutOfStock ? 'OUT_OF_STOCK' : isLowValue ? 'LOW_VALUE' : 'CROSS_SELL';

  const candidate = findCandidate(product.id, priceCeilingPaise, product.category);
  if (!candidate) return null;

  const formatted = formatProduct(candidate);
  return {
    reason,
    ...formatted,
    note: `You might also like the ${formatted.name} (${formatted.price_inr_display}, in stock).`,
  };
}

/**
 * search_catalog tool — read-only, no guardrails needed. Attaches a
 * deterministic suggestion to every result (see findSuggestion) so the
 * agent always has a concrete, real recommendation on hand — whether the
 * product is unavailable, cheap, or a perfectly normal in-stock item about
 * to be ordered.
 */
export function searchCatalog({ query } = {}) {
  const trimmed = (query ?? '').trim();
  const rows = trimmed
    ? searchProducts.all(`%${trimmed}%`, `%${trimmed}%`, `%${trimmed}%`)
    : getAllProducts.all();

  return {
    count: rows.length,
    products: rows.map((p) => {
      const formatted = formatProduct(p);
      const upsell_suggestion = findSuggestion(p);
      return upsell_suggestion ? { ...formatted, upsell_suggestion } : formatted;
    }),
  };
}

/**
 * create_razorpay_order tool — the guarded checkout path.
 * Enforces, in order: address present -> product exists -> spend limit -> stock.
 * On success: creates a real Razorpay Sandbox order and atomically persists
 * the local order row + decrements stock so it can't be oversold.
 */
export async function createRazorpayOrder(input, sessionId) {
  const { product_id, quantity, shipping_address, user_id } = input ?? {};

  // --- Guardrail 1: shipping address is mandatory -------------------------
  if (!shipping_address || !String(shipping_address).trim()) {
    const result = {
      error: 'ADDRESS_REQUIRED',
      message:
        'No shipping address has been provided yet. Ask the user for their full shipping address ' +
        'before attempting to create an order.',
    };
    logAudit(sessionId, 'GUARDRAIL_BLOCK', 'system', {
      reason: 'ADDRESS_REQUIRED',
      product_id,
      quantity,
    });
    return result;
  }

  const product = getProductById.get(product_id);
  if (!product) {
    return {
      error: 'PRODUCT_NOT_FOUND',
      message: `No product exists with id ${product_id}. Use search_catalog to find a valid product id.`,
    };
  }

  const qty = Math.max(1, parseInt(quantity, 10) || 1);
  const amount = product.price_inr * qty; // paise

  // --- Guardrail 2: ₹5,000 autonomous spend limit --------------------------
  if (amount > SPEND_LIMIT_PAISE) {
    // Suggest something that IS within budget — reuses the same candidate
    // logic, just with the spend limit itself as the price ceiling instead
    // of a placeholder — so the suggestion can never itself re-trigger this
    // same guardrail.
    const suggestion = findSuggestion(product, { priceCeilingPaise: SPEND_LIMIT_PAISE });
    const result = {
      error: 'SPEND_LIMIT_EXCEEDED',
      message:
        `This order totals ₹${(amount / 100).toLocaleString('en-IN')} for ${qty} x ${product.name}, ` +
        `which exceeds the ₹${(SPEND_LIMIT_PAISE / 100).toLocaleString('en-IN')} autonomous spend limit. ` +
        'The agent cannot place this order without additional human authorization.' +
        (suggestion ? ` ${suggestion.note}` : ''),
      limit_inr: SPEND_LIMIT_PAISE / 100,
      attempted_amount_inr: amount / 100,
      ...(suggestion ? { upsell_suggestion: suggestion } : {}),
    };
    logAudit(sessionId, 'GUARDRAIL_BLOCK', 'system', {
      reason: 'SPEND_LIMIT_EXCEEDED',
      product_id,
      quantity: qty,
      amount,
      limit: SPEND_LIMIT_PAISE,
    });
    return result;
  }

  // --- Guardrail 3: stock availability --------------------------------------
  if (product.stock < qty) {
    const suggestion = findSuggestion(product, { priceCeilingPaise: SPEND_LIMIT_PAISE });
    const result = {
      error: 'OUT_OF_STOCK',
      message:
        (product.stock === 0
          ? `"${product.name}" is currently out of stock.`
          : `Only ${product.stock} unit(s) of "${product.name}" are in stock; ${qty} were requested.`) +
        (suggestion ? ` ${suggestion.note}` : ''),
      available_stock: product.stock,
      ...(suggestion ? { upsell_suggestion: suggestion } : {}),
    };
    logAudit(sessionId, 'GUARDRAIL_BLOCK', 'system', {
      reason: 'OUT_OF_STOCK',
      product_id,
      requested: qty,
      available: product.stock,
    });
    return result;
  }

  // --- All guardrails passed: create the real Razorpay Sandbox order -------
  let rzpOrder;
  try {
    rzpOrder = await razorpay.orders.create({
      amount, // paise
      currency: 'INR',
      receipt: `rcpt_${sessionId.slice(0, 8)}_${Date.now()}`,
      notes: {
        product_id: String(product_id),
        quantity: String(qty),
        user_id: String(user_id ?? 'guest_user'),
        session_id: sessionId,
      },
    });
  } catch (err) {
    const message = err?.error?.description || err.message || 'Unknown Razorpay error';
    logAudit(sessionId, 'TOOL_ERROR', 'system', { reason: 'RAZORPAY_API_ERROR', message });
    return { error: 'RAZORPAY_ERROR', message: `Failed to create Razorpay order: ${message}` };
  }

  // Persist order + decrement stock atomically so concurrent chats can't oversell.
  const persist = db.transaction(() => {
    const insertOrder = db.prepare(`
      INSERT INTO orders (razorpay_order_id, user_id, product_id, quantity, amount, shipping_address, status)
      VALUES (?, ?, ?, ?, ?, ?, 'CREATED')
    `);
    const info = insertOrder.run(
      rzpOrder.id,
      user_id ?? 'guest_user',
      product_id,
      qty,
      amount,
      shipping_address
    );
    db.prepare('UPDATE products SET stock = stock - ? WHERE id = ?').run(qty, product_id);
    return info.lastInsertRowid;
  });

  const orderId = persist();

  return {
    success: true,
    order_id: orderId,
    razorpay_order_id: rzpOrder.id,
    amount_paise: amount,
    amount_inr: amount / 100,
    currency: 'INR',
    product: product.name,
    quantity: qty,
    shipping_address,
    status: 'CREATED',
    razorpay_key_id: process.env.RAZORPAY_KEY_ID,
    checkout_note:
      'Use razorpay_key_id + razorpay_order_id on the client to open Razorpay Checkout, ' +
      'then POST the payment response to /api/verify-payment to confirm the payment.',
  };
}
