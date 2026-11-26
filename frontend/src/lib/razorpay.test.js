import test from 'node:test';
import assert from 'node:assert/strict';
import { buildCheckoutOptions, openRazorpayCheckout, loadRazorpay } from './razorpay.js';

const details = { keyId: 'rzp_test_key', amountPaise: 129900, razorpayOrderId: 'order_abc', currency: 'INR', productName: 'Mouse' };
const response = { razorpay_order_id: 'order_abc', razorpay_payment_id: 'pay_abc', razorpay_signature: 'a'.repeat(64) };

test('sandbox options reject live/invalid details and use documented method configuration', () => {
  const options = buildCheckoutOptions(details);
  assert.equal(options.method, undefined);
  assert.deepEqual(options.config.display.blocks.sandbox.instruments, [{ method: 'netbanking' }, { method: 'card' }]);
  assert.throws(() => buildCheckoutOptions({ ...details, keyId: 'rzp_live_key' }), /Test Mode/);
  assert.throws(() => buildCheckoutOptions({ ...details, amountPaise: -1 }), /Invalid/);
});

function gateway(t, onOpen) {
  const instances = [];
  const oldWindow = globalThis.window;
  globalThis.window = { Razorpay: class {
    constructor(options) { this.options = options; this.closed = false; instances.push(this); }
    on(event, handler) { this.failed = handler; }
    open() { onOpen?.(this); }
    close() { this.closed = true; this.options.modal.ondismiss(); }
  } };
  t.after(() => { globalThis.window = oldWindow; });
  return instances;
}

test('success wins over duplicate success, dismissal and late failure events', async (t) => {
  gateway(t, (r) => {
    r.options.handler(response);
    r.options.modal.ondismiss();
    r.failed({ error: { description: 'late failure' } });
  });
  assert.deepEqual(await openRazorpayCheckout(details), { response });
});

test('failed popup closes before retry, and cancellation resolves once', async (t) => {
  const instances = gateway(t, (r) => r.failed({ error: { description: 'declined' } }));
  await assert.rejects(openRazorpayCheckout(details), /declined/);
  assert.equal(instances[0].closed, true);
  window.Razorpay.prototype.open = function () { this.options.modal.ondismiss(); };
  assert.deepEqual(await openRazorpayCheckout(details), { dismissed: true });
});

test('concurrent opens are blocked; session abort closes the active popup', async (t) => {
  const instances = gateway(t);
  const controller = new AbortController();
  const first = openRazorpayCheckout(details, { signal: controller.signal });
  await assert.rejects(openRazorpayCheckout(details), /already open/);
  controller.abort();
  assert.deepEqual(await first, { dismissed: true });
  assert.equal(instances[0].closed, true);
});

test('constructor/open exceptions and wrong-order callbacks do not leave checkout locked', async (t) => {
  gateway(t, () => { throw new Error('open failed'); });
  await assert.rejects(openRazorpayCheckout(details), /open failed/);
  window.Razorpay.prototype.open = function () { this.options.handler({ ...response, razorpay_order_id: 'order_other' }); };
  await assert.rejects(openRazorpayCheckout(details), /incomplete/);
  window.Razorpay.prototype.open = function () { this.options.handler(response); };
  assert.deepEqual(await openRazorpayCheckout(details), { response });
});

test('script load failure can retry, and concurrent loaders share one script', async (t) => {
  const oldWindow = globalThis.window, oldDocument = globalThis.document;
  const scripts = [];
  globalThis.window = {};
  globalThis.document = { createElement: () => ({ remove() {} }), head: { appendChild: (s) => scripts.push(s) } };
  t.after(() => { globalThis.window = oldWindow; globalThis.document = oldDocument; });
  const first = loadRazorpay();
  assert.equal(loadRazorpay(), first);
  scripts[0].onerror();
  await assert.rejects(first, /could not load/);
  const next = loadRazorpay();
  window.Razorpay = class {};
  scripts[1].onload();
  await next;
  assert.equal(scripts.length, 2);
});
