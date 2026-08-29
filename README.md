# Agentic Commerce — Razorpay Buildathon (Track 1)

A Claude-powered shopping agent that browses a product catalog, collects a
shipping address, and creates **real Razorpay Sandbox orders** through tool
calling — with hard server-side guardrails (₹5,000 spend limit, stock,
address), a three-panel dashboard with a human-in-the-loop payment
authorization gate, and a live, explainable audit trail.

This is a monorepo: `backend/` (Express + SQLite + Claude tool-calling +
Razorpay Sandbox) and `frontend/` (React 18 + Tailwind v4 + Vite), wired
together with npm workspaces.

```
agentic-commerce/
├── backend/     Express API, SQLite, the Claude agent + guardrails, test-runner.js
└── frontend/    React dashboard — chat, HITL approval, live audit trail
```

Each subfolder has its own README with implementation detail. This one is
the quick-start.

## 1. Install

```bash
npm install               # installs both workspaces from the root
```

## 2. Configure real keys

The backend needs **real** API keys — nothing here works with placeholders.

```bash
cp backend/.env.example backend/.env
```

Fill in `backend/.env`:

| Variable | Where to get it |
|---|---|
| `ANTHROPIC_API_KEY` | console.anthropic.com |
| `RAZORPAY_KEY_ID` | Razorpay Dashboard → Settings → API Keys (**Test/Sandbox mode**) |
| `RAZORPAY_KEY_SECRET` | same as above |

## 3. Seed the catalog

```bash
npm run seed
```

Seeds 4 products, including two deliberate edge cases: the ₹18,500 monitor
(over the ₹5,000 spend limit) and the ₹799 Desk Pad (0 stock).

## 4. Run it

**Option A — single server (recommended for judging / the demo video).**
Builds the frontend and serves it from the same Express server as the API —
one process, one port, one URL:

```bash
npm run demo
# → http://localhost:4000
```

**Option B — development mode.** Two servers with hot reload (Vite dev
server on :5173 proxies `/api/*` to the backend on :4000):

```bash
npm run dev
# → http://localhost:5173
```

## 5. Test it

```bash
npm start          # in one terminal (Option A or B above)
npm test            # in another — runs the 4 core edge-case integration tests
```

Runs against the **live** server: a real order + signature verification
(happy path), then the three guardrails (missing address, over spend limit,
out of stock). Colored, timestamped output built for screen-recording. See
`backend/README.md` for what each test actually asserts and why — the
guardrail tests check a slightly more nuanced condition than "the tool
returned an error code," because a well-aligned agent often declines a bad
purchase without ever calling the tool.

```bash
npm run test:selftest   # unit-tests the test suite's own assertion logic — no live keys needed
```

## Seeded catalog

| Product | Price | Stock | Exercises |
|---|---|---|---|
| Mechanical RGB Keyboard | ₹2,499 | 15 | normal purchase |
| Ergonomic Mouse | ₹1,299 | 25 | normal purchase, quick-authorize (≤ ₹500 is the *other* threshold — this one lands in the "review" path) |
| UltraWide Curved Monitor | ₹18,500 | 5 | `SPEND_LIMIT_EXCEEDED` |
| Desk Pad | ₹799 | 0 | `OUT_OF_STOCK` |

## Architecture at a glance

- **Guardrails live in code, not the prompt.** `backend/agent/toolHandlers.js`
  enforces the address/spend-limit/stock rules regardless of what the model
  decides — the system prompt states the rules, but can't be relied on alone.
- **One source of truth for orders.** `/api/chat` only returns text. The
  frontend's HITL panel derives pending orders from the same polled
  `/api/audit-trail` feed the explainability panel already shows — every
  successful `create_razorpay_order` call is a `TOOL_RESULT` audit event with
  the full order payload.
- **Same-origin in production.** With the frontend built and served by the
  backend (`npm run demo`), all `/api/*` calls are same-origin — no CORS
  configuration needed for the deployed/demo build.

## Troubleshooting

- **`Cannot find module 'better-sqlite3'` or similar native-module errors** —
  run `npm install` from the repo root again; workspaces hoist most
  dependencies but native builds are sensitive to the Node version used.
- **Frontend loads but chat/orders don't work** — check `backend/.env` has
  real (not placeholder) keys, and that you're hitting the port the backend
  printed on boot.
- **`npm run demo` shows an old UI after code changes** — it's serving the
  built `frontend/dist`; re-run `npm run build` (or `npm run demo` again) to
  pick up changes. Use `npm run dev` while actively developing.
