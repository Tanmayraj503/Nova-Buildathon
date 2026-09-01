import express from 'express';
import cors from 'cors';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import 'dotenv/config';

import './db.js'; // ensures schema exists on boot

import chatRouter from './routes/chat.js';
import auditTrailRouter from './routes/auditTrail.js';
import verifyPaymentRouter from './routes/verifyPayment.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// ../frontend/dist — the built React app, produced by `npm run build` in the
// frontend workspace (or `npm run build` at the monorepo root).
const FRONTEND_DIST = path.join(__dirname, '..', 'frontend', 'dist');
const isFrontendBuilt = fs.existsSync(path.join(FRONTEND_DIST, 'index.html'));

const app = express();

app.use(cors());
app.use(express.json());

app.get('/api/health', (req, res) => res.json({ ok: true, service: 'agentic-commerce-backend' }));

app.use('/api', chatRouter);
app.use('/api', auditTrailRouter);
app.use('/api', verifyPaymentRouter);

// Fallback 404 for unmatched /api routes
app.use('/api', (req, res) => {
  res.status(404).json({ error: 'NOT_FOUND', message: `No route for ${req.method} ${req.originalUrl}` });
});

// Serve the built React app from the same origin/port as the API — no CORS,
// no second server, one URL to share with judges. Falls back gracefully to
// an instructional message if the frontend hasn't been built yet, so the
// backend still runs standalone during development.
if (isFrontendBuilt) {
  app.use(express.static(FRONTEND_DIST));
  // SPA fallback for any non-API GET request (safe even without client-side
  // routing today; future-proofs the app if routing is added later).
  app.get(/^(?!\/api).*/, (req, res) => {
    res.sendFile(path.join(FRONTEND_DIST, 'index.html'));
  });
} else {
  app.get('/', (req, res) => {
    res.status(200).send(
      'Agentic Commerce backend is running, but no frontend build was found.\n' +
        'Run `npm run build` (from the monorepo root, or inside /frontend) and restart the server — ' +
        'or run the frontend dev server separately with `npm run dev` and visit it directly.'
    );
  });
}

app.use((err, req, res, next) => {
  console.error('Unhandled error:', err);
  res.status(500).json({ error: 'INTERNAL_ERROR', message: err.message });
});

const PORT = process.env.PORT || 4000;
app.listen(PORT, () => {
  console.log(`🚀 Agentic Commerce server running on http://localhost:${PORT}`);
  console.log(`   POST /api/chat`);
  console.log(`   GET  /api/audit-trail?session_id=...`);
  console.log(`   POST /api/verify-payment`);
  console.log(
    isFrontendBuilt
      ? `   ✔ serving frontend build from ${FRONTEND_DIST}`
      : `   ⚠ frontend build not found — run \`npm run build\` to serve the UI from this same server`
  );
});
