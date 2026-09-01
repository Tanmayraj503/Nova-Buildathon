# Agentic Commerce — Razorpay Buildathon (Track 1)

A Claude-powered shopping agent that browses a product catalog, collects a shipping
address, and creates **real Razorpay Sandbox orders** through tool calling — with
hard server-side guardrails (spend limit, stock, address) and a full audit trail
for explainability.

## Stack

- Node.js (ESM) + Express
- SQLite via `better-sqlite3`
- `@anthropic-ai/sdk` (`claude-3-5-sonnet-20240620`) for agent + tool calling
- `razorpay` SDK for real Sandbox order creation + HMAC-SHA256 payment verification

## Setup

```bash
npm install
cp .env.example .env   # then fill in your keys
npm run seed            # creates buildathon.db and seeds 4 products
npm start                # http://localhost:4000
```

`.env` requires:

| Variable               | Where to get it                                                |
|-------------------------|------------------------------------------------------------------|
| `ANTHROPIC_API_KEY`     | console.anthropic.com                                            |
| `RAZORPAY_KEY_ID`       | Razorpay Dashboard → Settings → API Keys (**Test/Sandbox mode**) |
| `RAZORPAY_KEY_SECRET`   | same as above                                                     |

## Seeded catalog

| id | Product                   | Price   | Stock | Tests                          |
|----|----------------------------|---------|-------|----------------------------------|
| 1  | Mechanical RGB Keyboard    | ₹2,499  | 15    | normal purchase flow             |
| 2  | Ergonomic Mouse            | ₹1,299  | 25    | normal purchase flow             |
| 3  | UltraWide Curved Monitor   | ₹18,500 | 5     | **SPEND_LIMIT_EXCEEDED** (> ₹5,000) |
| 4  | Desk Pad                   | ₹799    | 0     | **OUT_OF_STOCK**                 |

## API

### `POST /api/chat`
```json
{ "message": "I'd like a mechanical keyboard", "session_id": "optional-uuid", "user_id": "optional" }
```
Returns `{ session_id, reply }`. Reuse the returned `session_id` on subsequent
calls to continue the same conversation — history is kept server-side in memory.

The agent has two tools:
- **`search_catalog(query?)`** — read-only product lookup, always used instead of
  guessing prices/stock.
- **`create_razorpay_order(product_id, quantity, shipping_address, user_id)`** —
  the system prompt instructs Claude to only call this after the user has
  **explicitly typed a shipping address in chat**. The tool itself re-enforces
  this and two other guardrails server-side (Claude cannot bypass them):

  | Condition                          | Error code             |
  |-------------------------------------|--------------------------|
  | No shipping address supplied        | `ADDRESS_REQUIRED`       |
  | Order total > ₹5,000 (500,000 paise)| `SPEND_LIMIT_EXCEEDED`   |
  | `stock < quantity`                  | `OUT_OF_STOCK`           |

  On success it calls the real `razorpay.orders.create()` Sandbox API,
  persists the order (`status = 'CREATED'`), and atomically decrements stock.

### `GET /api/audit-trail?session_id=X`
Returns every step (`USER_MESSAGE`, `AGENT_RESPONSE`, `TOOL_CALL`, `TOOL_RESULT`,
`GUARDRAIL_BLOCK`, `PAYMENT_VERIFICATION`, ...) logged during a session, in
chronological order — the explainability trail for what the agent did and why.

### `POST /api/verify-payment`
```json
{
  "razorpay_order_id": "order_xxx",
  "razorpay_payment_id": "pay_xxx",
  "razorpay_signature": "hex...",
  "session_id": "optional — links this event into the chat's audit trail"
}
```
Recomputes `HMAC-SHA256(order_id + "|" + payment_id, key_secret)` and compares
it (constant-time) against the signature returned by Razorpay Checkout on the
client. Sets the order's `status` to `VERIFIED` or `FAILED`; on failure, the
stock that was reserved at order-creation time is restored.

## Testing

`test-runner.js` is a zero-dependency integration test suite that exercises
the 4 core edge cases against a **live** server — a real Claude agent talking
to a real Razorpay Sandbox:

```bash
npm start                # in one terminal, with real keys in .env
npm test                 # in another terminal
```

| # | Test | What it proves |
|---|------|-----------------|
| 1 | Happy path — ₹1,299 Ergonomic Mouse | Real order created via `create_razorpay_order`, then independently verified with a correctly-computed HMAC-SHA256 signature via `/api/verify-payment` |
| 2 | Missing address | No order is ever created without an address — either the agent asks first, or the `ADDRESS_REQUIRED` guardrail blocks it |
| 3 | Spend limit | No order above ₹5,000 is ever created — either the agent declines proactively, or `SPEND_LIMIT_EXCEEDED` blocks it |
| 4 | Out of stock | No order for the (0-stock) Desk Pad is ever created — either the agent declines proactively, or `OUT_OF_STOCK` blocks it |

Output is colored, timestamped, and ends with a pass/fail summary table —
built for screen-recording in a demo video. Add `--verbose` to dump the raw
audit trail JSON for any failing test.

**Why tests 2–4 check two different outcomes:** the three guardrails only run
*inside* `create_razorpay_order`, which only a live agent decides to call. A
well-aligned agent often avoids calling a tool it already knows (from its own
system prompt, or from a prior `search_catalog` call) will fail — asking for
an address instead of attempting the order, for instance. That's correct,
desirable behavior, not a bug. So each test's real pass condition is "no
invalid order was ever created"; if the agent *did* attempt the tool, the
test additionally asserts the exact guardrail error code and audit event.

`test-runner.selftest.js` (`npm run test:selftest`) unit-tests the pure
log-parsing helpers that back those assertions, against synthetic audit-log
fixtures — useful for verifying the test logic itself without needing live
API keys.



- **Guardrails live in the tool handler, not the prompt.** The system prompt
  tells Claude the rules, but `create_razorpay_order` (`agent/toolHandlers.js`)
  enforces them in code regardless of what the model decides — prompt
  injection or a model mistake cannot place an over-limit, out-of-stock, or
  address-less order.
- **Stock is reserved at order creation, not at verification**, and restored
  on a `FAILED` verification — this prevents a race where two chats both see
  "in stock" and both create Sandbox orders for the last unit.
- **Every tool call, tool result, guardrail block, and payment verification is
  written to `audit_logs`** with a JSON payload, keyed by `session_id`, so the
  full reasoning/action trail for any order is reconstructable via
  `/api/audit-trail`.
- Chat history is kept in an in-memory `Map` (`routes/chat.js`) for simplicity;
  swap for Redis/a DB table if you need multi-instance deployment.

## Project structure

```
db.js                   SQLite connection + schema (products, orders, audit_logs)
seed.js                 Seeds the 4 demo products
server.js                Express app entrypoint
lib/
  razorpay.js            Razorpay SDK client
  audit.js                logAudit() / getAuditTrail() helpers
agent/
  tools.js                Anthropic tool_use schema (search_catalog, create_razorpay_order)
  toolHandlers.js          Tool implementations + guardrails
  agent.js                 Claude tool-calling orchestration loop
routes/
  chat.js                  POST /api/chat
  auditTrail.js             GET /api/audit-trail
  verifyPayment.js          POST /api/verify-payment
```
