#!/usr/bin/env node
/**
 * test-runner.selftest.js
 *
 * Unit tests for the pure log-parsing helpers exported from test-runner.js
 * (toolResults, guardrailBlocks, successfulOrder, failedOrderAttempt),
 * run against synthetic audit_logs fixtures shaped exactly like the real
 * backend produces them (see lib/audit.js + agent/toolHandlers.js).
 *
 * These helpers decide PASS/FAIL for every test in test-runner.js, so they're
 * worth verifying deterministically and independently of live LLM behavior,
 * which is inherently non-deterministic and can't be exercised in CI without
 * real API keys.
 *
 * Usage: node test-runner.selftest.js
 */

import assert from 'node:assert/strict';
import { toolResults, guardrailBlocks, successfulOrder, failedOrderAttempt } from './test-runner.js';

let passed = 0;
let failed = 0;

function test(name, fn) {
  try {
    fn();
    console.log(`  \x1b[32m✓\x1b[0m ${name}`);
    passed++;
  } catch (err) {
    console.log(`  \x1b[31m✗\x1b[0m ${name}`);
    console.log(`      ${err.message}`);
    failed++;
  }
}

// A search_catalog result mixed into every fixture below, to prove the
// helpers filter by tool name correctly rather than matching any TOOL_RESULT.
const searchLog = {
  id: 1,
  step_type: 'TOOL_RESULT',
  actor: 'system',
  timestamp: '2026-08-28 04:00:00',
  payload: { tool: 'search_catalog', output: { count: 1, products: [{ id: 2, name: 'Ergonomic Mouse' }] } },
};

console.log('\n\x1b[1mtest-runner.selftest.js\x1b[0m — pure log-parsing helper checks\n');

test('successfulOrder() finds a successful create_razorpay_order result', () => {
  const logs = [
    searchLog,
    {
      id: 2,
      step_type: 'TOOL_RESULT',
      actor: 'system',
      timestamp: '2026-08-28 04:00:01',
      payload: {
        tool: 'create_razorpay_order',
        output: {
          success: true,
          order_id: 1,
          razorpay_order_id: 'order_ABC123',
          amount_paise: 129900,
          product: 'Ergonomic Mouse',
          quantity: 1,
          razorpay_key_id: 'rzp_test_xxx',
        },
      },
    },
  ];
  const order = successfulOrder(logs);
  assert.ok(order, 'expected a successful order to be found');
  assert.equal(order.razorpay_order_id, 'order_ABC123');
  assert.equal(order.amount_paise, 129900);
});

test('successfulOrder() returns null when only search_catalog was called', () => {
  assert.equal(successfulOrder([searchLog]), null);
});

test('successfulOrder() returns null when create_razorpay_order failed', () => {
  const logs = [
    searchLog,
    {
      id: 2,
      step_type: 'TOOL_RESULT',
      actor: 'system',
      timestamp: '2026-08-28 04:00:01',
      payload: { tool: 'create_razorpay_order', output: { error: 'ADDRESS_REQUIRED', message: 'no address' } },
    },
  ];
  assert.equal(successfulOrder(logs), null);
});

test('failedOrderAttempt() finds ADDRESS_REQUIRED specifically (not other error codes)', () => {
  const logs = [
    {
      id: 2,
      step_type: 'TOOL_RESULT',
      actor: 'system',
      timestamp: '2026-08-28 04:00:01',
      payload: { tool: 'create_razorpay_order', output: { error: 'ADDRESS_REQUIRED', message: 'no address' } },
    },
  ];
  assert.ok(failedOrderAttempt(logs, 'ADDRESS_REQUIRED'));
  assert.equal(failedOrderAttempt(logs, 'SPEND_LIMIT_EXCEEDED'), null);
  assert.equal(failedOrderAttempt(logs, 'OUT_OF_STOCK'), null);
});

test('failedOrderAttempt() returns null when the tool was never called at all', () => {
  // Agent declined in plain text and never called create_razorpay_order —
  // the "agent asked first" path that's a PASS, not a failure, in test-runner.js.
  const logs = [
    {
      id: 1,
      step_type: 'AGENT_RESPONSE',
      actor: 'agent',
      timestamp: '2026-08-28 04:00:00',
      payload: { stop_reason: 'end_turn', content: [{ type: 'text', text: 'Could you share a shipping address?' }] },
    },
  ];
  assert.equal(failedOrderAttempt(logs, 'ADDRESS_REQUIRED'), null);
  assert.equal(successfulOrder(logs), null);
});

test('guardrailBlocks() finds SPEND_LIMIT_EXCEEDED events by reason', () => {
  const logs = [
    {
      id: 3,
      step_type: 'GUARDRAIL_BLOCK',
      actor: 'system',
      timestamp: '2026-08-28 04:00:02',
      payload: { reason: 'SPEND_LIMIT_EXCEEDED', product_id: 3, quantity: 1, amount: 1850000, limit: 500000 },
    },
  ];
  assert.equal(guardrailBlocks(logs, 'SPEND_LIMIT_EXCEEDED').length, 1);
  assert.equal(guardrailBlocks(logs, 'OUT_OF_STOCK').length, 0);
});

test('toolResults() only matches the requested tool name, case-sensitively', () => {
  const logs = [
    searchLog,
    {
      id: 2,
      step_type: 'TOOL_RESULT',
      actor: 'system',
      timestamp: '2026-08-28 04:00:01',
      payload: { tool: 'create_razorpay_order', output: { success: true, razorpay_order_id: 'order_X' } },
    },
  ];
  assert.equal(toolResults(logs, 'search_catalog').length, 1);
  assert.equal(toolResults(logs, 'create_razorpay_order').length, 1);
  assert.equal(toolResults(logs, 'CREATE_RAZORPAY_ORDER').length, 0);
  assert.equal(toolResults(logs, 'nonexistent_tool').length, 0);
});

test('full happy-path fixture (search -> order) resolves correctly end to end', () => {
  const logs = [
    { id: 1, step_type: 'USER_MESSAGE', actor: 'user', timestamp: 't', payload: { text: 'buy a mouse' } },
    searchLog,
    {
      id: 3,
      step_type: 'TOOL_RESULT',
      actor: 'system',
      timestamp: 't',
      payload: {
        tool: 'create_razorpay_order',
        output: { success: true, razorpay_order_id: 'order_HAPPY1', amount_paise: 129900, product: 'Ergonomic Mouse' },
      },
    },
  ];
  const order = successfulOrder(logs);
  assert.ok(order);
  assert.equal(order.razorpay_order_id, 'order_HAPPY1');
});

test('full guardrail fixture (spend limit blocked + audit event) resolves correctly end to end', () => {
  const logs = [
    {
      id: 1,
      step_type: 'GUARDRAIL_BLOCK',
      actor: 'system',
      timestamp: 't',
      payload: { reason: 'SPEND_LIMIT_EXCEEDED', amount: 1850000, limit: 500000 },
    },
    {
      id: 2,
      step_type: 'TOOL_RESULT',
      actor: 'system',
      timestamp: 't',
      payload: { tool: 'create_razorpay_order', output: { error: 'SPEND_LIMIT_EXCEEDED', message: 'too expensive' } },
    },
  ];
  assert.equal(successfulOrder(logs), null);
  assert.ok(failedOrderAttempt(logs, 'SPEND_LIMIT_EXCEEDED'));
  assert.equal(guardrailBlocks(logs, 'SPEND_LIMIT_EXCEEDED').length, 1);
});

console.log(`\n${passed} passed, ${failed} failed\n`);
process.exitCode = failed === 0 ? 0 : 1;
