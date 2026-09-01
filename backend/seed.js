import db from './db.js';

const PRODUCTS = [
  {
    name: 'Mechanical RGB Keyboard',
    description: 'Hot-swappable mechanical keyboard with per-key RGB lighting and tactile switches.',
    price_inr: 249900, // ₹2,499.00 in paise
    stock: 15,
    category: 'Peripherals',
  },
  {
    name: 'Ergonomic Mouse',
    description: 'Vertical ergonomic mouse designed to reduce wrist strain during long sessions.',
    price_inr: 129900, // ₹1,299.00
    stock: 25,
    category: 'Peripherals',
  },
  {
    name: 'Wireless ANC Headphones',
    description: 'Over-ear wireless headphones featuring Active Noise Cancellation (ANC), 30-hour battery life, fast charging, and dual-device multipoint pairing. Premium memory foam earcups designed for all-day comfort.',
    price_inr: 49990, 
    stock: 2,
    category: 'Audio',
  },
  {
    name: 'UltraWide Curved Monitor',
    description: '34" curved ultrawide QHD monitor — great for productivity and gaming.',
    price_inr: 1850000, // ₹18,500.00 — deliberately above the ₹5,000 spend limit
    stock: 5,
    category: 'Displays',
  },
  {
    name: 'Desk Pad',
    description: 'Large felt + PU leather desk pad, water-resistant, non-slip base.',
    price_inr: 79900, // ₹799.00
    stock: 0, // deliberately out of stock
    category: 'Accessories',
  },
];

function seed() {
  const wipeOrders = db.prepare('DELETE FROM orders');
  const wipeProducts = db.prepare('DELETE FROM products');
  const insert = db.prepare(`
    INSERT INTO products (name, description, price_inr, stock, category)
    VALUES (@name, @description, @price_inr, @stock, @category)
  `);

  const run = db.transaction((products) => {
    // orders.product_id has a FOREIGN KEY REFERENCES products(id), so any
    // orders placed during testing must be cleared first — reseeding is
    // meant to reset to a fresh demo catalog, and stale orders pointing at
    // about-to-be-deleted (or about-to-be-reused) product ids wouldn't be
    // meaningful to keep around anyway.
    wipeOrders.run();
    db.prepare("DELETE FROM sqlite_sequence WHERE name = 'orders'").run();

    wipeProducts.run();
    // Reset autoincrement counter so seeded IDs are stable/predictable (1-5).
    db.prepare("DELETE FROM sqlite_sequence WHERE name = 'products'").run();
    for (const p of products) insert.run(p);
  });

  run(PRODUCTS);

  console.log('✅ Seeded products table (existing test orders were cleared to allow this):');
  for (const row of db.prepare('SELECT id, name, price_inr, stock FROM products').all()) {
    console.log(
      `   #${row.id} ${row.name.padEnd(26)} ₹${(row.price_inr / 100).toLocaleString('en-IN')}`.padEnd(60) +
      `stock: ${row.stock}`
    );
  }
}

seed();
