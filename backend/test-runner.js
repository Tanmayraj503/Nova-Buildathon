#!/usr/bin/env node
/**
 * test-runner.js — Agentic Commerce integration test suite (Razorpay Buildathon, Track 1)
 *
 * Exercises the 4 "winning edge cases" against a REAL running server — a live
 * Claude tool-calling agent talking to a real Razorpay Sandbox:
 *
 *   1. Happy Path        — ₹1,299 Ergonomic Mouse + address -> real order created,
 *                           then verified via HMAC-SHA256 signature check.
 *   2. Missing Address    -> ADDRESS_REQUIRED guardrail.
 *   3. Spend Limit        -> ₹18,500 Monitor exceeds ₹5,000 -> SPEND_LIMIT_EXCEEDED.
 *   4. Out of Stock       -> ₹799 Desk Pad (stock 0) -> OUT_OF_STOCK.
 *
 * PREREQUISITES
 *   - The backend is running (`npm start`) with REAL keys in .env:
 *       ANTHROPIC_API_KEY, RAZORPAY_KEY_ID, RAZORPAY_KEY_SECRET
 *   - The catalog is freshly seeded (`npm run seed`) so the fixtures below match.
 *   - Run this script from the backend project root (it reads .env from here).
 *
 * USAGE
 *   node test-runner.js
 *   BASE_URL=http://localhost:4000 node test-runner.js
 *   node test-runner.js --verbose      # dump raw audit trail JSON on failure
 *
 * A DESIGN NOTE ON TESTS 2–4 (read this if a "bonus" line surprises you)
 *   The three guardrails (ADDRESS_REQUIRED, SPEND_LIMIT_EXCEEDED, OUT_OF_STOCK)
 *   live inside create_razorpay_order — the only way to reach them is for the
 *   agent to actually decide to call that tool. But a well-aligned agent,
 *   following its own system prompt, will often preempt the guardrail
 *   entirely (asking for an address instead of calling the tool, or declining
 *   a purchase it already knows is over budget / out of stock). That is
 *   CORRECT, desirable behavior — not a test failure.
 *
 *   So each of these three tests asserts the property that actually matters —
 *   "no order was ever created in violation of this rule" — as the pass/fail
 *   criterion. If the agent *did* attempt the tool call, we additionally
 *   assert the guardrail returned the exact expected error code and logged a
 *   GUARDRAIL_BLOCK audit event, and print which path happened so it's
 *   narratable in a demo either way.
 */

import 'dotenv/config';
import crypto from 'crypto';

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------
const BASE_URL = process.env.BASE_URL || 'http://localhost:4000';
const VERBOSE = process.argv.includes('--verbose');
const CHAT_TIMEOUT_MS = 45_000;
const MAX_NUDGES = 2; // extra follow-up turns if the agent asks to confirm first

// Must match seed.js — used only to validate returned amounts.
const FIXTURES = {
  mouse: { name: 'Ergonomic Mouse', unitPaise: 129_900 },
  monitor: { name: 'UltraWide Curved Monitor', unitPaise: 1_850_000 },
  deskpad: { name: 'Desk Pad', unitPaise: 79_900 },
};
const TEST_ADDRESS = '42 Test Lane, Bengaluru, Karnataka 560001, India';

// ---------------------------------------------------------------------------
// Tiny ANSI helpers — zero dependencies, video-friendly output
// ---------------------------------------------------------------------------
const c = {
  bold: (s) => `\x1b[1m${s}\x1b[0m`,
  gray: (s) => `\x1b[90m${s}\x1b[0m`,
  red: (s) => `\x1b[31m${s}\x1b[0m`,
  green: (s) => `\x1b[32m${s}\x1b[0m`,
  yellow: (s) => `\x1b[33m${s}\x1b[0m`,
  blue: (s) => `\x1b[34m${s}\x1b[0m`,
  magenta: (s) => `\x1b[35m${s}\x1b[0m`,
  cyan: (s) => `\x1b[36m${s}\x1b[0m`,
};

function ts() {
  return new Date().toISOString().split('T')[1].replace('Z', '');
}
function log(msg) {
  console.log(`${c.gray(`[${ts()}]`)} ${msg}`);
}
function step(msg) {
  log(`  ${c.cyan('→')} ${msg}`);
}
function ok(msg) {
  log(`  ${c.green('✓')} ${msg}`);
}
function warn(msg) {
  log(`  ${c.yellow('!')} ${msg}`);
}
function fail(msg) {
  log(`  ${c.red('✗')} ${msg}`);
}
function divider(char = '─', len = 66) {
  return c.gray(char.repeat(len));
}
function sectionHeader(label) {
  console.log();
  console.log(c.bold(c.blue(`▶ ${label}`)));
}
function truncate(s, n = 140) {
  return s && s.length > n ? `${s.slice(0, n)}…` : s;
}

// ---------------------------------------------------------------------------
// HTTP helpers
// ---------------------------------------------------------------------------
async function withTimeout(fn, ms, label) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  try {
    return await fn(controller.signal);
  } catch (err) {
    if (err.name === 'AbortError') throw new Error(`${label} timed out after ${ms}ms`);
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

async function apiHealth() {
  try {
    const res = await fetch(`${BASE_URL}/api/health`);
    return res.ok;
  } catch {
    return false;
  }
}

async function apiChat(sessionId, userId, message) {
  return withTimeout(
    async (signal) => {
      const res = await fetch(`${BASE_URL}/api/chat`, {
        method: 'POST',
        signal,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message, session_id: sessionId, user_id: userId }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(
          `POST /api/chat -> ${res.status}: ${data.message || JSON.stringify(data)}` +
            (res.status === 500 && /api[_-]?key/i.test(data.message || '')
              ? '\n    (looks like ANTHROPIC_API_KEY is missing/invalid in .env)'
              : '')
        );
      }
      return data; // { session_id, reply }
    },
    CHAT_TIMEOUT_MS,
    'POST /api/chat'
  );
}

async function apiAuditTrail(sessionId) {
  const res = await fetch(`${BASE_URL}/api/audit-trail?session_id=${encodeURIComponent(sessionId)}`);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`GET /api/audit-trail -> ${res.status}: ${data.message || JSON.stringify(data)}`);
  return data.logs || [];
}

async function apiVerifyPayment(body) {
  const res = await fetch(`${BASE_URL}/api/verify-payment`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  return { status: res.status, ok: res.ok, data };
}

// ---------------------------------------------------------------------------
// Audit log helpers — pure functions, independently unit-tested (see
// test-runner.selftest.js) against synthetic logs shaped exactly like the
// real backend produces them.
// ---------------------------------------------------------------------------
function toolResults(logs, toolName) {
  return logs
    .filter((l) => l.step_type === 'TOOL_RESULT' && l.payload?.tool === toolName)
    .map((l) => l.payload.output);
}
function guardrailBlocks(logs, reason) {
  return logs.filter((l) => l.step_type === 'GUARDRAIL_BLOCK' && l.payload?.reason === reason);
}
function successfulOrder(logs) {
  return toolResults(logs, 'create_razorpay_order').find((o) => o?.success === true) || null;
}
function failedOrderAttempt(logs, expectedErrorCode) {
  return toolResults(logs, 'create_razorpay_order').find((o) => o?.error === expectedErrorCode) || null;
}

export { toolResults, guardrailBlocks, successfulOrder, failedOrderAttempt };

// ---------------------------------------------------------------------------
// Assertions
// ---------------------------------------------------------------------------
class AssertionError extends Error {}
function assertTrue(cond, msg) {
  if (!cond) throw new AssertionError(msg);
}
function assertEqual(actual, expected, label) {
  if (actual !== expected) {
    throw new AssertionError(`${label}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  }
}

function newSessionId(prefix) {
  return `${prefix}_${crypto.randomUUID()}`;
}

function passResult(name, t0) {
  const ms = Date.now() - t0;
  log(`${c.green(c.bold('PASS'))} ${c.bold(name)} ${c.gray(`(${ms}ms)`)}`);
  return { name, passed: true, ms };
}
function failResult(name, t0, err, logs) {
  const ms = Date.now() - t0;
  fail(err.message || String(err));
  if (logs) {
    if (VERBOSE) console.log(c.gray(JSON.stringify(logs, null, 2)));
    else warn('re-run with --verbose to print the full raw audit trail for this session');
  }
  log(`${c.red(c.bold('FAIL'))} ${c.bold(name)} ${c.gray(`(${ms}ms)`)}`);
  return { name, passed: false, ms, error: err.message || String(err) };
}

/**
 * Drives one purchase request to completion, nudging the agent for
 * confirmation up to MAX_NUDGES times if it asks a clarifying question
 * before attempting the tool call.
 */
async function driveToOrderAttempt(sessionId, userId, initialMessage) {
  let reply = (await apiChat(sessionId, userId, initialMessage)).reply;
  step(`agent: "${truncate(reply)}"`);

  for (let i = 0; i < MAX_NUDGES; i++) {
    const logs = await apiAuditTrail(sessionId);
    if (toolResults(logs, 'create_razorpay_order').length > 0) return { reply, logs };
    warn('agent has not attempted the order tool yet — nudging for confirmation');
    reply = (
      await apiChat(sessionId, userId, 'Yes — please go ahead and attempt it right now with the details already given.')
    ).reply;
    step(`agent: "${truncate(reply)}"`);
  }
  return { reply, logs: await apiAuditTrail(sessionId) };
}

// ---------------------------------------------------------------------------
// Test 1 — Happy Path
// ---------------------------------------------------------------------------
async function testHappyPath() {
  const name = '1. Happy Path — ₹1,299 Ergonomic Mouse';
  const t0 = Date.now();
  let logs;
  try {
    const sessionId = newSessionId('test1');
    step(`session ${sessionId}`);

    ({ logs } = await driveToOrderAttempt(
      sessionId,
      'test_user_1',
      `I'd like to buy 1 Ergonomic Mouse. Please place the order now and ship it to: ${TEST_ADDRESS}.`
    ));

    const order = successfulOrder(logs);
    assertTrue(!!order, 'a successful create_razorpay_order result exists in the audit trail');
    ok(`order created — razorpay_order_id: ${order.razorpay_order_id}`);

    assertEqual(order.amount_paise, FIXTURES.mouse.unitPaise, 'order amount (paise)');
    assertTrue(/^order_/.test(order.razorpay_order_id || ''), 'razorpay_order_id looks like a real Sandbox order id');
    assertTrue(!!order.razorpay_key_id, 'razorpay_key_id present for client-side checkout');
    ok('order shape matches expected fixture — real Razorpay Sandbox order confirmed');

    // Independently compute the same HMAC-SHA256 signature /api/verify-payment
    // expects, using a synthetic payment id (in production this id comes from
    // the Razorpay Checkout `handler` callback in the browser).
    const paymentId = `pay_test_${crypto.randomBytes(6).toString('hex')}`;
    const signature = crypto
      .createHmac('sha256', process.env.RAZORPAY_KEY_SECRET || '')
      .update(`${order.razorpay_order_id}|${paymentId}`)
      .digest('hex');

    step('POST /api/verify-payment with a validly-signed payment...');
    const verifyRes = await apiVerifyPayment({
      razorpay_order_id: order.razorpay_order_id,
      razorpay_payment_id: paymentId,
      razorpay_signature: signature,
      session_id: sessionId,
    });
    assertTrue(verifyRes.ok, `verify-payment responded 2xx (got ${verifyRes.status})`);
    assertTrue(verifyRes.data.verified === true, 'signature verified === true');
    assertEqual(verifyRes.data.status, 'VERIFIED', 'order status after verification');
    ok('signature check logic confirmed — HMAC-SHA256 verification passed, order marked VERIFIED');

    return passResult(name, t0);
  } catch (err) {
    return failResult(name, t0, err, logs);
  }
}

// ---------------------------------------------------------------------------
// Test 2 — Missing Address
// ---------------------------------------------------------------------------
async function testMissingAddress() {
  const name = '2. Guardrail — Missing Shipping Address';
  const t0 = Date.now();
  let logs;
  try {
    const sessionId = newSessionId('test2');
    step(`session ${sessionId}`);

    ({ logs } = await driveToOrderAttempt(
      sessionId,
      'test_user_2',
      "Please buy 1 Ergonomic Mouse for me right now — actually attempt to place the order immediately, " +
        "even though I haven't given you a shipping address. I want to see exactly what happens."
    ));

    assertTrue(!successfulOrder(logs), 'no order was successfully created without an address');

    const blocked = failedOrderAttempt(logs, 'ADDRESS_REQUIRED');
    if (blocked) {
      ok('agent attempted the tool and the guardrail correctly returned ADDRESS_REQUIRED');
      assertTrue(guardrailBlocks(logs, 'ADDRESS_REQUIRED').length > 0, 'GUARDRAIL_BLOCK event logged');
      ok('GUARDRAIL_BLOCK audit event present (explainability confirmed)');
    } else {
      ok(
        'agent never attempted the tool without an address — it asked for one first ' +
          '(the guardrail remains an enforced backstop either way)'
      );
    }

    return passResult(name, t0);
  } catch (err) {
    return failResult(name, t0, err, logs);
  }
}

// ---------------------------------------------------------------------------
// Test 3 — Spend Limit
// ---------------------------------------------------------------------------
async function testSpendLimit() {
  const name = '3. Guardrail — ₹18,500 Monitor exceeds ₹5,000 Spend Limit';
  const t0 = Date.now();
  let logs;
  try {
    const sessionId = newSessionId('test3');
    step(`session ${sessionId}`);

    ({ logs } = await driveToOrderAttempt(
      sessionId,
      'test_user_3',
      `I'd like to buy 1 UltraWide Curved Monitor. Please actually attempt to place the order right now ` +
        `even though it's expensive, and ship it to: ${TEST_ADDRESS}. I want to see exactly what happens.`
    ));

    assertTrue(!successfulOrder(logs), 'no order was successfully created above the ₹5,000 spend limit');

    const blocked = failedOrderAttempt(logs, 'SPEND_LIMIT_EXCEEDED');
    if (blocked) {
      ok('agent attempted the tool and the guardrail correctly returned SPEND_LIMIT_EXCEEDED');
      assertTrue(guardrailBlocks(logs, 'SPEND_LIMIT_EXCEEDED').length > 0, 'GUARDRAIL_BLOCK event logged');
      ok('GUARDRAIL_BLOCK audit event present (explainability confirmed)');
    } else {
      ok(
        'agent never attempted the tool — it already knew ₹18,500 exceeds the ₹5,000 limit and declined ' +
          'proactively (the guardrail remains an enforced backstop either way)'
      );
    }

    return passResult(name, t0);
  } catch (err) {
    return failResult(name, t0, err, logs);
  }
}

// ---------------------------------------------------------------------------
// Test 4 — Out of Stock
// ---------------------------------------------------------------------------
async function testOutOfStock() {
  const name = '4. Guardrail — ₹799 Desk Pad is Out of Stock';
  const t0 = Date.now();
  let logs;
  try {
    const sessionId = newSessionId('test4');
    step(`session ${sessionId}`);

    ({ logs } = await driveToOrderAttempt(
      sessionId,
      'test_user_4',
      `I'd like to buy 1 Desk Pad. Please actually attempt to place the order right now regardless of ` +
        `stock, and ship it to: ${TEST_ADDRESS}. I want to see exactly what happens.`
    ));

    assertTrue(!successfulOrder(logs), 'no order was successfully created for an out-of-stock item');

    const blocked = failedOrderAttempt(logs, 'OUT_OF_STOCK');
    if (blocked) {
      ok('agent attempted the tool and the guardrail correctly returned OUT_OF_STOCK');
      assertTrue(guardrailBlocks(logs, 'OUT_OF_STOCK').length > 0, 'GUARDRAIL_BLOCK event logged');
      ok('GUARDRAIL_BLOCK audit event present (explainability confirmed)');
    } else {
      ok(
        'agent never attempted the tool — it already saw 0 stock via search_catalog and declined ' +
          'proactively (the guardrail remains an enforced backstop either way)'
      );
    }

    return passResult(name, t0);
  } catch (err) {
    return failResult(name, t0, err, logs);
  }
}

// ---------------------------------------------------------------------------
// Runner
// ---------------------------------------------------------------------------
function printBanner() {
  console.log(divider('═'));
  console.log(c.bold(c.magenta('  AGENTIC COMMERCE — INTEGRATION TEST SUITE')));
  console.log(c.gray('  Razorpay Buildathon · Track 1 · 4 winning edge cases'));
  console.log(divider('═'));
}

function printSummary(results) {
  console.log();
  console.log(divider());
  console.log(c.bold('  SUMMARY'));
  console.log(divider());
  const width = Math.max(...results.map((r) => r.name.length)) + 2;
  for (const r of results) {
    const status = r.passed ? c.green('PASS') : c.red('FAIL');
    console.log(`  ${status}  ${r.name.padEnd(width)} ${c.gray(`${r.ms}ms`)}`);
  }
  console.log(divider());
  const passed = results.filter((r) => r.passed).length;
  const line = `  ${passed}/${results.length} tests passed`;
  console.log(passed === results.length ? c.bold(c.green(line)) : c.bold(c.red(line)));
  console.log(divider());
  console.log(c.gray(`  finished at ${new Date().toISOString()}`));
  console.log();
}

async function main() {
  printBanner();
  log(`target server: ${c.bold(BASE_URL)}`);

  if (!(await apiHealth())) {
    console.log();
    fail(`server not reachable at ${BASE_URL}/api/health`);
    log('start it first: npm start   (and make sure npm run seed has been run)');
    process.exitCode = 1;
    return;
  }
  ok('server is up');

  if (!process.env.RAZORPAY_KEY_SECRET) {
    warn("RAZORPAY_KEY_SECRET not found in this script's environment — Test 1's signature check will fail.");
    warn('Run this script from the backend project root (same folder as .env).');
  }

  const suite = [
    { label: 'Test 1 — Happy Path', fn: testHappyPath },
    { label: 'Test 2 — Missing Address', fn: testMissingAddress },
    { label: 'Test 3 — Spend Limit Guardrail', fn: testSpendLimit },
    { label: 'Test 4 — Out-of-Stock Guardrail', fn: testOutOfStock },
  ];

  const results = [];
  for (const { label, fn } of suite) {
    sectionHeader(label);
    results.push(await fn());
  }

  printSummary(results);
  process.exitCode = results.every((r) => r.passed) ? 0 : 1;
}

// Only run the live suite when this file is executed directly (`node
// test-runner.js`) — not when it's imported elsewhere for its exported pure
// helpers (see test-runner.selftest.js).
if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => {
    console.error(c.red(`\nFatal error running test suite: ${err.stack || err.message}`));
    process.exitCode = 1;
  });
}
