// Skema database D1. Dijalankan otomatis saat request pertama (CREATE IF NOT EXISTS),
// jadi tidak perlu menjalankan migrasi manual.
export const SCHEMA = [
  `CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT)`,
  `CREATE TABLE IF NOT EXISTS tables_ (
     id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, active INTEGER NOT NULL DEFAULT 1, sort INTEGER NOT NULL DEFAULT 0)`,
  `CREATE TABLE IF NOT EXISTS users (
     id INTEGER PRIMARY KEY AUTOINCREMENT, username TEXT UNIQUE NOT NULL, name TEXT NOT NULL,
     role TEXT NOT NULL CHECK (role IN ('superadmin','admin','kasir')),
     pass_hash TEXT NOT NULL, salt TEXT NOT NULL, active INTEGER NOT NULL DEFAULT 1, created_at INTEGER NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS sessions (token TEXT PRIMARY KEY, user_id INTEGER NOT NULL, expires INTEGER NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS bookings (
     id INTEGER PRIMARY KEY AUTOINCREMENT, code TEXT UNIQUE NOT NULL,
     customer_name TEXT NOT NULL, phone TEXT NOT NULL, table_id INTEGER NOT NULL,
     start_ts INTEGER NOT NULL, end_ts INTEGER NOT NULL, hours INTEGER NOT NULL, total INTEGER NOT NULL,
     status TEXT NOT NULL, source TEXT NOT NULL, paid INTEGER NOT NULL DEFAULT 0, order_id INTEGER,
     note TEXT, expires_at INTEGER, reschedule_count INTEGER NOT NULL DEFAULT 0,
     created_at INTEGER NOT NULL, created_by INTEGER)`,
  `CREATE INDEX IF NOT EXISTS idx_bookings_time ON bookings(table_id, start_ts)`,
  `CREATE TABLE IF NOT EXISTS table_sessions (
     id INTEGER PRIMARY KEY AUTOINCREMENT, table_id INTEGER NOT NULL, booking_id INTEGER,
     customer_name TEXT, started_at INTEGER NOT NULL, ended_at INTEGER,
     status TEXT NOT NULL DEFAULT 'open', billed_hours INTEGER, amount INTEGER, order_id INTEGER, started_by INTEGER)`,
  `CREATE TABLE IF NOT EXISTS menu_items (
     id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, category TEXT NOT NULL DEFAULT 'Minuman',
     price INTEGER NOT NULL, active INTEGER NOT NULL DEFAULT 1)`,
  `CREATE TABLE IF NOT EXISTS orders (
     id INTEGER PRIMARY KEY AUTOINCREMENT, no TEXT, table_session_id INTEGER, booking_id INTEGER,
     customer_name TEXT, subtotal INTEGER NOT NULL DEFAULT 0, discount INTEGER NOT NULL DEFAULT 0,
     total INTEGER NOT NULL DEFAULT 0, payment_method TEXT, status TEXT NOT NULL DEFAULT 'open',
     cashier_id INTEGER, created_at INTEGER NOT NULL, paid_at INTEGER,
     void_reason TEXT, voided_by INTEGER, voided_at INTEGER)`,
  `CREATE INDEX IF NOT EXISTS idx_orders_paid ON orders(status, paid_at)`,
  `CREATE TABLE IF NOT EXISTS order_items (
     id INTEGER PRIMARY KEY AUTOINCREMENT, order_id INTEGER NOT NULL, item_type TEXT NOT NULL,
     ref_id INTEGER, name TEXT NOT NULL, category TEXT, qty INTEGER NOT NULL, price INTEGER NOT NULL, total INTEGER NOT NULL)`,
  `CREATE INDEX IF NOT EXISTS idx_items_order ON order_items(order_id)`,
  `CREATE TABLE IF NOT EXISTS audit_log (
     id INTEGER PRIMARY KEY AUTOINCREMENT, ts INTEGER NOT NULL, user_id INTEGER, user_name TEXT,
     action TEXT NOT NULL, entity TEXT, entity_id TEXT, detail TEXT)`,
  `CREATE TABLE IF NOT EXISTS rooms (
     code TEXT PRIMARY KEY, name TEXT, players TEXT NOT NULL, config TEXT NOT NULL,
     status TEXT NOT NULL DEFAULT 'active', created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS rounds (
     id INTEGER PRIMARY KEY AUTOINCREMENT, room_code TEXT NOT NULL, type TEXT NOT NULL,
     winner INTEGER, from_player INTEGER, tai INTEGER, deltas TEXT NOT NULL, note TEXT, created_at INTEGER NOT NULL)`,
  `CREATE INDEX IF NOT EXISTS idx_rounds_room ON rounds(room_code)`,
  // Nilai awal
  `INSERT OR IGNORE INTO settings(key,value) VALUES
     ('business_name','Zi Mo Mahjong'),
     ('tagline','Mahjong lounge · buka 24 jam'),
     ('address','Apartemen B Residence, Ground Floor, BSD'),
     ('maps_url',''),
     ('whatsapp','628xxxxxxxxxx'),
     ('instagram','zimo_mahjong'),
     ('price_per_hour','50000'),
     ('package_hours','3'),
     ('package_price','0'),
     ('grace_minutes','5'),
     ('hold_minutes','60'),
     ('max_booking_hours','8'),
     ('max_days_ahead','30'),
     ('payment_info','Transfer BCA 1234567890 a.n. Zi Mo Mahjong\nAtau scan QRIS di kasir / minta via WhatsApp'),
     ('receipt_footer','Terima kasih sudah bermain di Zi Mo Mahjong!')`,
  `INSERT INTO tables_(name, sort) SELECT 'Meja 1',1 WHERE NOT EXISTS (SELECT 1 FROM tables_)`,
  `INSERT INTO tables_(name, sort) SELECT 'Meja 2',2 WHERE (SELECT COUNT(*) FROM tables_)=1`,
  `INSERT INTO tables_(name, sort) SELECT 'Meja 3',3 WHERE (SELECT COUNT(*) FROM tables_)=2`,
  `INSERT INTO menu_items(name,category,price) SELECT * FROM (
     SELECT 'Es Teh Manis','Minuman',8000 UNION ALL SELECT 'Kopi Susu','Minuman',18000 UNION ALL
     SELECT 'Air Mineral','Minuman',6000 UNION ALL SELECT 'Kentang Goreng','Makanan',20000 UNION ALL
     SELECT 'Mie Goreng','Makanan',22000) WHERE NOT EXISTS (SELECT 1 FROM menu_items)`,
];
