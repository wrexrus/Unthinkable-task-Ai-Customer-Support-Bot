require('dotenv').config();
const express = require('express');
const bodyParser = require('body-parser');
const cors = require('cors');
const { v4: uuidv4 } = require('uuid');
const db = require('./db');
const { searchFaqs } = require('./faq_retriever');
const generateResponse = require('./llm_service');
const { LRUCache } = require('lru-cache');


const app = express();
app.use(cors());
app.use(bodyParser.json());

const PORT = process.env.PORT || 4000;

const contextCache = new LRUCache({ max: 10000, ttl: 1000 * 60 * 60 });

function saveSession(sessionId, userId = null) {
  const stmt = db.prepare("INSERT OR IGNORE INTO sessions (id, user_id, last_active) VALUES (?, ?, datetime('now'))");
  stmt.run(sessionId, userId);
}

function saveMessage(id, sessionId, role, content) {
  const stmt = db.prepare('INSERT INTO messages (id, session_id, role, content) VALUES (?, ?, ?, ?)');
  stmt.run(id, sessionId, role, content);
}

function updateLastActive(sessionId) {
  const stmt = db.prepare("UPDATE sessions SET last_active = datetime('now') WHERE id = ?");
  stmt.run(sessionId);
}

app.post('/api/session', (req, res) => {
  const sessionId = uuidv4();
  const userId = req.body.user_id || null;
  saveSession(sessionId, userId);
  res.json({ session_id: sessionId, created_at: new Date().toISOString() });
});

// Endpoint: post message (user -> assistant)
app.post('/api/session/:sessionId/message', async (req, res) => {
  const { sessionId } = req.params;
  const { text } = req.body;
  if (!text) return res.status(400).json({ error: 'Missing text field' });

  saveSession(sessionId);

  const userMsgId = uuidv4();
  saveMessage(userMsgId, sessionId, 'user', text);

  let context = contextCache.get(sessionId);
  if (!context) {
    const rows = db.prepare('SELECT role, content, created_at FROM messages WHERE session_id = ? ORDER BY created_at DESC LIMIT 8').all(sessionId);
    context = rows.reverse().map(r => ({ role: r.role, content: r.content }));
    contextCache.set(sessionId, context);
  }

  const faqHits = searchFaqs(text, 3);
  console.log('DEBUG: userText=', text);
  console.log('DEBUG: faqHits=', JSON.stringify(faqHits, null, 2));

  const { text: assistantText, shouldEscalate } = await generateResponse({ faqHits, contextMessages: context, userMessage: text });

  console.log('DEBUG: assistantText=', assistantText);
  console.log('DEBUG: shouldEscalate=', shouldEscalate);

  if (shouldEscalate) {
    const escId = uuidv4();
    const stmt = db.prepare('INSERT INTO escalations (id, session_id, reason, status, notes) VALUES (?, ?, ?, ?, ?)');
    stmt.run(escId, sessionId, 'auto_escalation', 'queued', assistantText);
    const aid = uuidv4();
    saveMessage(aid, sessionId, 'assistant', assistantText);
    context.push({ role: 'user', content: text });
    context.push({ role: 'assistant', content: assistantText });
    if (context.length > 12) context.splice(0, context.length - 12);
    contextCache.set(sessionId, context);
    updateLastActive(sessionId);
    return res.json({ role: 'assistant', text: assistantText, escalation: { id: escId, status: 'queued' } });
  }

  const assistantId = uuidv4();
  saveMessage(assistantId, sessionId, 'assistant', assistantText);

  context.push({ role: 'user', content: text });
  context.push({ role: 'assistant', content: assistantText });
  if (context.length > 12) context.splice(0, context.length - 12);
  contextCache.set(sessionId, context);

  updateLastActive(sessionId);

  return res.json({ role: 'assistant', text: assistantText, faqs: faqHits.map(f => ({ id: f.id, score: f.score })) });
});

app.get('/api/session/:sessionId/history', (req, res) => {
  const { sessionId } = req.params;
  const rows = db.prepare('SELECT id, role, content, created_at FROM messages WHERE session_id = ? ORDER BY created_at ASC').all(sessionId);
  res.json({ messages: rows });
});

app.post('/api/session/:sessionId/escalate', (req, res) => {
  const { sessionId } = req.params;
  const { reason, notes } = req.body;
  const escId = uuidv4();
  const stmt = db.prepare('INSERT INTO escalations (id, session_id, reason, status, notes) VALUES (?, ?, ?, ?, ?)');
  stmt.run(escId, sessionId, reason || 'manual', 'queued', notes || '');
  return res.json({ escalation_id: escId, status: 'queued' });
});

    app.get('/api/escalations', (req, res) => {
  const rows = db.prepare('SELECT * FROM escalations ORDER BY created_at DESC LIMIT 200').all();
  res.json(rows);
});

app.listen(PORT, () => {
  console.log(`Server listening on http://localhost:${PORT}`);
});
