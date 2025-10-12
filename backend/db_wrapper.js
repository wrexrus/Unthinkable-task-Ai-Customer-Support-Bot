
const db = require('./db');
const { v4: uuidv4 } = require('uuid');

module.exports = {
  // Sessions
  createSession(sessionId, userId = null) {
    const id = sessionId || uuidv4();
    const stmt = db.prepare("INSERT OR IGNORE INTO sessions (id, user_id, last_active) VALUES (?, ?, datetime('now'))");
    stmt.run(id, userId);
    return id;
  },

  getSession(sessionId) {
    return db.prepare('SELECT id, user_id, created_at, last_active, summary FROM sessions WHERE id = ?').get(sessionId);
  },

  listSessions(limit = 200) {
    return db.prepare('SELECT id, user_id, created_at, last_active, summary FROM sessions ORDER BY last_active DESC LIMIT ?').all(limit);
  },

  updateSessionSummary(sessionId, summaryText) {
    return db.prepare("UPDATE sessions SET summary = ?, last_active = datetime('now') WHERE id = ?").run(summaryText, sessionId);
  },

  touchSession(sessionId) {
    return db.prepare("UPDATE sessions SET last_active = datetime('now') WHERE id = ?").run(sessionId);
  },

  // Messages
  addMessage(sessionId, role, content) {
    const id = uuidv4();
    const stmt = db.prepare('INSERT INTO messages (id, session_id, role, content) VALUES (?, ?, ?, ?)');
    stmt.run(id, sessionId, role, content);
    return id;
  },

  getMessages(sessionId, limit = 1000) {
    return db.prepare('SELECT id, role, content, created_at FROM messages WHERE session_id = ? ORDER BY created_at ASC LIMIT ?').all(sessionId, limit);
  },

  getRecentMessages(sessionId, limit = 8) {
    const rows = db.prepare('SELECT role, content, created_at FROM messages WHERE session_id = ? ORDER BY created_at DESC LIMIT ?').all(sessionId, limit);
    return rows.reverse().map(r => ({ role: r.role, content: r.content, created_at: r.created_at }));
  },

  // Escalations
  createEscalation(sessionId, reason = 'manual', notes = '') {
    const id = uuidv4();
    const stmt = db.prepare('INSERT INTO escalations (id, session_id, reason, status, notes) VALUES (?, ?, ?, ?, ?)');
    stmt.run(id, sessionId, reason, 'queued', notes);
    return id;
  },

  listEscalations(limit = 200) {
    return db.prepare('SELECT id, session_id, reason, status, notes, created_at FROM escalations ORDER BY created_at DESC LIMIT ?').all(limit);
  },

  getEscalationsForSession(sessionId) {
    return db.prepare('SELECT id, reason, status, notes, created_at FROM escalations WHERE session_id = ? ORDER BY created_at ASC').all(sessionId);
  },

  // Logs
  addLog(sessionId, level, message, meta = null) {
    const id = uuidv4();
    const stmt = db.prepare('INSERT INTO logs (id, session_id, level, message, meta) VALUES (?, ?, ?, ?, ?)');
    stmt.run(id, sessionId || null, level || 'info', message || '', meta ? JSON.stringify(meta) : null);
    return id;
  },

  getLogs(sessionId, limit = 1000) {
    return db.prepare('SELECT id, level, message, meta, created_at FROM logs WHERE session_id = ? ORDER BY created_at ASC LIMIT ?').all(sessionId, limit);
  }
};
