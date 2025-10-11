const Database = require('better-sqlite3');
const path = require('path');

const dbPath = path.join(__dirname, '..', 'data', 'data.db');
const db = new Database(dbPath);

db.pragma('journal_mode = WAL');

db.exec(`
CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY,
  user_id TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  last_active TEXT,
  summary TEXT
);

CREATE TABLE IF NOT EXISTS messages (
  id TEXT PRIMARY KEY,
  session_id TEXT,
  role TEXT,
  content TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS escalations (
  id TEXT PRIMARY KEY,
  session_id TEXT,
  reason TEXT,
  status TEXT,
  notes TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);
`);

module.exports = db;
