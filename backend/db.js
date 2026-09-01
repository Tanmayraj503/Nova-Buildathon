import Database from 'better-sqlite3';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DB_PATH = path.join(__dirname, 'buildathon.db');

const db = new Database(DB_PATH);

// WAL improves concurrent read/write behavior for a chat-style workload.
db.pragma('journal_mode = WAL');
// Required so FOREIGN KEY (product_id) REFERENCES products(id) is actually enforced.
db.pragma('foreign_keys = ON');

db.exec(`
  CREATE TABLE IF NOT EXISTS products (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    name         TEXT    NOT NULL,
    description  TEXT,
    price_inr    INTEGER NOT NULL,           -- stored in paise (1 INR = 100 paise)
    stock        INTEGER NOT NULL DEFAULT 0,
    category     TEXT
  );

  CREATE TABLE IF NOT EXISTS orders (
    id                 INTEGER PRIMARY KEY AUTOINCREMENT,
    razorpay_order_id  TEXT UNIQUE,
    user_id            TEXT    NOT NULL,
    product_id         INTEGER NOT NULL,
    quantity           INTEGER NOT NULL,
    amount             INTEGER NOT NULL,     -- paise, quantity * price_inr at time of order
    shipping_address   TEXT    NOT NULL,
    status             TEXT    NOT NULL DEFAULT 'CREATED',  -- CREATED | VERIFIED | FAILED
    created_at         TEXT    NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY (product_id) REFERENCES products(id)
  );

  CREATE TABLE IF NOT EXISTS audit_logs (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    session_id  TEXT    NOT NULL,
    step_type   TEXT    NOT NULL,            -- USER_MESSAGE | AGENT_RESPONSE | TOOL_CALL | TOOL_RESULT | GUARDRAIL_BLOCK | TOOL_ERROR | PAYMENT_VERIFICATION
    actor       TEXT    NOT NULL,            -- user | agent | system
    payload     TEXT,                        -- JSON-encoded free-form detail
    timestamp   TEXT    NOT NULL DEFAULT (datetime('now'))
  );

  CREATE INDEX IF NOT EXISTS idx_audit_session ON audit_logs(session_id);
  CREATE INDEX IF NOT EXISTS idx_orders_rzp_id ON orders(razorpay_order_id);
`);

export default db;
