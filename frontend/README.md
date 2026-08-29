# Agentic Commerce — Frontend (Razorpay Buildathon, Track 1)

A three-panel dashboard for the agentic commerce backend: a chat interface, a
human-in-the-loop payment authorization gate, and a live explainable-AI audit
trail — built with React 18 + Tailwind CSS v4 + Vite.

## Setup

Requires the backend (`razorpay-agentic-commerce`) running on `:4000` first.

```bash
npm install
npm run dev     # http://localhost:5173
```

In dev, Vite proxies `/api/*` to `http://localhost:4000` (see `vite.config.js`),
so no CORS setup or env vars are needed locally. For a production build served
from a different origin than the backend, set `VITE_API_BASE_URL` (see
`.env.example`).

```bash
npm run build    # outputs to dist/
npm run preview  # serve the production build locally
```

## Layout

| Panel | Component | Talks to |
|---|---|---|
| Left — chat | `ChatPanel` | `POST /api/chat` |
| Middle — HITL approval | `HitlPanel`, `OrderAuthorizationCard`, `ReviewModal` | derives orders from the audit feed, then `window.Razorpay` + `POST /api/verify-payment` |
| Right — audit trail | `AuditPanel`, `AuditEventCard`, `JsonViewer` | `GET /api/audit-trail?session_id=X`, polled every 2s |

### How the middle panel gets its order data

`/api/chat` only returns `{ session_id, reply }` — plain text. Rather than
inventing a second, redundant "structured order" API, the HITL panel reads
the **same** polled audit trail the right panel already displays: every
successful `create_razorpay_order` call is logged as a `TOOL_RESULT` event
with the full order payload (`utils/orders.js` → `deriveOrdersFromAuditLogs`).
One source of truth, two views — and it also means the audit trail is a
faithful, literal record of everything the UI acted on.

### Friction threshold

`utils/orders.js` exports `QUICK_AUTHORIZE_THRESHOLD_PAISE = 50_000` (₹500).
- **≤ ₹500** → `OrderAuthorizationCard` shows a single-tap **"Quick Authorize
  (Auto-Pay Bounded)"** button that opens Razorpay Checkout directly.
- **> ₹500** → the button reads **"Review & Approve via Razorpay"** and opens
  `ReviewModal` first — an explicit in-app confirmation step — before
  Checkout opens.

### Payment status

`window.Razorpay`'s `handler` callback receives `razorpay_payment_id` and
`razorpay_signature`, which are POSTed to `/api/verify-payment` along with
the `session_id`. The returned `status` (`VERIFIED` / `FAILED`) drives the
`PaymentBadge`. Status is also cross-checked against `PAYMENT_VERIFICATION`
events in the polled audit trail, so a page refresh mid-flow doesn't lose
state.

### Audit trail categories

The backend logs raw `step_type`s (`USER_MESSAGE`, `AGENT_RESPONSE`,
`TOOL_CALL`, `TOOL_RESULT`, `GUARDRAIL_BLOCK`, `TOOL_ERROR`,
`PAYMENT_VERIFICATION`). `utils/auditCategory.js` maps each to one of the
five requested judge-facing categories and colors:

| Category | Color | Backend sources |
|---|---|---|
| User Input | blue | `USER_MESSAGE` |
| Agent Reasoning | violet | `AGENT_RESPONSE` |
| Tool Call | amber | `TOOL_CALL`, non-order `TOOL_RESULT` |
| Razorpay API | emerald | successful order `TOOL_RESULT`, `PAYMENT_VERIFICATION` |
| Guardrail / Error | red | `GUARDRAIL_BLOCK`, `TOOL_ERROR`, failed order `TOOL_RESULT` |

Each event card has an expandable raw JSON payload viewer (`JsonViewer`) for
judges to inspect exact tool inputs/outputs.

## Design system

- **Palette**: a cool navy-slate canvas (not pure black) with five functional
  signal colors tied 1:1 to the audit categories above, plus a separate gold
  "authorize" accent reserved only for the HITL panel's signature moment.
- **Type**: Space Grotesk (wordmark/eyebrows), Inter (UI/body), JetBrains Mono
  (money, IDs, timestamps, JSON — anything ledger-like).
- **Signature element**: the `OrderAuthorizationCard` is styled as a torn
  boarding-pass / authorization document — a perforated divider between the
  order details and the approve action — because that's literally what it
  is: a real financial instrument requiring a human signature before value
  moves.
- All custom design tokens live in `src/index.css` under `@theme` (Tailwind
  v4), generating first-class utilities like `bg-canvas`, `text-signal-agent`,
  `border-authorize/40`, `font-mono`.

## Project structure

```
index.html                    fonts, Razorpay Checkout script, root div
src/
  main.jsx                     entrypoint
  App.jsx                       session state, wires the 3 panels together
  index.css                     Tailwind v4 import + design tokens + animations
  components/
    Header.jsx                   top app bar (wordmark, session id, reset)
    PanelHeader.jsx               shared sticky header for each panel
    ChatPanel.jsx                 left panel
    HitlPanel.jsx                 middle panel orchestrator
    OrderAuthorizationCard.jsx     the boarding-pass approval card
    ReviewModal.jsx                mandatory review step for orders > ₹500
    PaymentBadge.jsx               status pill (verified/failed/pending)
    AuditPanel.jsx                 right panel: filters + live list
    AuditEventCard.jsx             single timeline entry
    JsonViewer.jsx                 expandable raw payload viewer
  hooks/
    useAuditTrail.js               2s polling hook for /api/audit-trail
  lib/
    api.js                         fetch wrappers (chat, audit-trail, verify-payment)
    razorpay.js                    window.Razorpay Checkout wrapper
  utils/
    format.js                      formatINR, formatTime, truncate, shortId
    auditCategory.js                maps backend step_types -> 5 categories
    orders.js                       derives orders from the audit log feed
```
