const fs = require('fs');
const path = require('path');
const sqlite3 = require('sqlite3').verbose();

const dataDir = path.join(__dirname, '../../data');
if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true });
}

const dbPath = path.join(dataDir, 'database.sqlite');
const db = new sqlite3.Database(dbPath);

function run(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.run(sql, params, function onRun(err) {
      if (err) return reject(err);
      return resolve({ id: this.lastID, changes: this.changes });
    });
  });
}

function get(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.get(sql, params, (err, row) => {
      if (err) return reject(err);
      return resolve(row);
    });
  });
}

function all(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.all(sql, params, (err, rows) => {
      if (err) return reject(err);
      return resolve(rows);
    });
  });
}

async function initDatabase() {
  await run(`CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    number TEXT UNIQUE NOT NULL,
    name TEXT,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT DEFAULT CURRENT_TIMESTAMP
  )`);

  await run(`CREATE TABLE IF NOT EXISTS saldo (
    user_id INTEGER PRIMARY KEY,
    balance REAL DEFAULT 0 CHECK (balance >= 0),
    updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY(user_id) REFERENCES users(id)
  )`);

  await run(`CREATE TABLE IF NOT EXISTS pedidos (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    hero_order_id TEXT,
    service_key TEXT NOT NULL,
    phone_number TEXT,
    sms_code TEXT,
    status TEXT DEFAULT 'pending',
    amount REAL NOT NULL,
    refund_applied INTEGER DEFAULT 0,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
    completed_at TEXT,
    FOREIGN KEY(user_id) REFERENCES users(id)
  )`);

  await run(`CREATE TABLE IF NOT EXISTS recargas (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    txid TEXT UNIQUE,
    amount REAL NOT NULL,
    pix_code TEXT,
    status TEXT DEFAULT 'pending',
    created_at TEXT DEFAULT CURRENT_TIMESTAMP,
    paid_at TEXT,
    FOREIGN KEY(user_id) REFERENCES users(id)
  )`);

  await run(`CREATE TABLE IF NOT EXISTS mensagens (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER,
    direction TEXT NOT NULL,
    message_text TEXT,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY(user_id) REFERENCES users(id)
  )`);
}

async function ensureUser(number, name = '') {
  await run(
    `INSERT INTO users(number, name) VALUES(?, ?)
     ON CONFLICT(number) DO UPDATE SET name = excluded.name, updated_at = CURRENT_TIMESTAMP`,
    [number, name]
  );

  const user = await get('SELECT * FROM users WHERE number = ?', [number]);
  await run('INSERT OR IGNORE INTO saldo(user_id, balance) VALUES(?, 0)', [user.id]);
  return user;
}

async function getUserWithBalance(number) {
  return get(
    `SELECT u.*, COALESCE(s.balance, 0) as balance
     FROM users u
     LEFT JOIN saldo s ON s.user_id = u.id
     WHERE u.number = ?`,
    [number]
  );
}

async function updateBalance(userId, delta) {
  const current = await get('SELECT balance FROM saldo WHERE user_id = ?', [userId]);
  const nextBalance = Number((current?.balance || 0) + delta);
  if (nextBalance < 0) {
    throw new Error('Saldo insuficiente. Operação cancelada para evitar saldo negativo.');
  }

  await run('UPDATE saldo SET balance = ?, updated_at = CURRENT_TIMESTAMP WHERE user_id = ?', [
    nextBalance,
    userId,
  ]);

  return nextBalance;
}

module.exports = {
  db,
  run,
  get,
  all,
  initDatabase,
  ensureUser,
  getUserWithBalance,
  updateBalance,
};
