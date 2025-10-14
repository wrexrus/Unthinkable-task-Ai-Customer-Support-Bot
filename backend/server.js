// backend/server.js
require('dotenv').config();
const express = require('express');
const bodyParser = require('body-parser');
const cors = require('cors');
const { v4: uuidv4 } = require('uuid');
const db = require('./db'); // keeps DB initialized
const dbw = require('./db_wrapper'); // wrapper we just added
const { searchFaqs } = require('./faq_retriever');
const generateResponse = require('./llm_service'); // must export a function
const { LRUCache } = require('lru-cache');

const app = express();
app.use(cors());
app.use(bodyParser.json());

const PORT = process.env.PORT || 4000;
const contextCache = new LRUCache({ max: 10000, ttl: 1000 * 60 * 60 }); // 1 hour TTL

// ---------- Logging helper (persistent) ----------
function logEvent(sessionId, level, message, meta = null) {
  try {
    return dbw.addLog(sessionId, level, message, meta);
  } catch (err) {
    console.error('Failed to write log:', err);
  }
}

// ---------- Async wrapper to catch errors in async routes ----------
function wrapAsync(fn) {
  return function (req, res, next) {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
}

// ---------- Public API routes ----------

// Create session
app.post('/api/session', wrapAsync(async (req, res) => {
  const sessionId = uuidv4();
  const userId = req.body.user_id || null;
  dbw.createSession(sessionId, userId);
  logEvent(sessionId, 'info', 'session_created', { userId });
  res.json({ session_id: sessionId, created_at: new Date().toISOString() });
}));

// Post a message (user -> assistant)
app.post('/api/session/:sessionId/message', wrapAsync(async (req, res) => {
  const { sessionId } = req.params;
  const { text } = req.body;
  if (!text) return res.status(400).json({ error: 'Missing text field' });

  dbw.createSession(sessionId); // ensure session exists
  logEvent(sessionId, 'info', 'received_user_message', { textSnippet: text.slice(0, 200) });

  dbw.addMessage(sessionId, 'user', text);

  // load short-term context from cache or DB
  let context = contextCache.get(sessionId);
  if (!context) {
    context = dbw.getRecentMessages(sessionId, 8);
    contextCache.set(sessionId, context);
  }

  // FAQ retrieval (top 3)
  const faqHits = searchFaqs(text, 3);
  logEvent(sessionId, 'debug', 'faq_search_completed', { query: text.slice(0,200), hits: faqHits.map(h => ({id:h.id,score:h.score})) });

  // generate assistant response (Gemini if configured; otherwise mock fallback)
  const { text: assistantText, shouldEscalate } = await generateResponse({ faqHits, contextMessages: context, userMessage: text });

  logEvent(sessionId, 'info', 'assistant_generated', { snippet: (assistantText || '').slice(0,200), escalate: !!shouldEscalate });

  if (shouldEscalate) {
    const escId = dbw.createEscalation(sessionId, 'auto_escalation', assistantText);
    dbw.addMessage(sessionId, 'assistant', assistantText);
    // update context cache
    context.push({ role: 'user', content: text });
    context.push({ role: 'assistant', content: assistantText });
    if (context.length > 12) context.splice(0, context.length - 12);
    contextCache.set(sessionId, context);
    dbw.touchSession(sessionId);
    logEvent(sessionId, 'warn', 'escalation_created', { escalationId: escId });
    return res.json({ role: 'assistant', text: assistantText, escalation: { id: escId, status: 'queued' } });
  }

  // persist assistant message
  dbw.addMessage(sessionId, 'assistant', assistantText);

  // update context cache
  context.push({ role: 'user', content: text });
  context.push({ role: 'assistant', content: assistantText });
  if (context.length > 12) context.splice(0, context.length - 12);
  contextCache.set(sessionId, context);

  dbw.touchSession(sessionId);

  return res.json({ role: 'assistant', text: assistantText, faqs: faqHits.map(f => ({ id: f.id, score: f.score })) });
}));

// Get session history
app.get('/api/session/:sessionId/history', wrapAsync(async (req, res) => {
  const { sessionId } = req.params;
  const rows = dbw.getMessages(sessionId, 1000);
  res.json({ messages: rows });
}));

// Manual escalate (admin or simulated human)
app.post('/api/session/:sessionId/escalate', wrapAsync(async (req, res) => {
  const { sessionId } = req.params;
  const { reason, notes } = req.body;
  const escId = dbw.createEscalation(sessionId, reason || 'manual', notes || '');
  logEvent(sessionId, 'info', 'manual_escalation', { escId, reason });
  res.json({ escalation_id: escId, status: 'queued' });
}));

// List escalations
app.get('/api/escalations', wrapAsync(async (req, res) => {
  const rows = dbw.listEscalations(200);
  res.json(rows);
}));

// Fetch logs for a session (admin/debug)
app.get('/api/session/:sessionId/logs', wrapAsync(async (req, res) => {
  const { sessionId } = req.params;
  const rows = dbw.getLogs(sessionId, 1000);
  res.json({ logs: rows });
}));

// ---------- Admin endpoints ----------

// List sessions
app.get('/api/admin/sessions', wrapAsync(async (req, res) => {
  const rows = dbw.listSessions(200);
  res.json({ sessions: rows });
}));

// Get session details (messages, logs, escalations)
app.get('/api/admin/session/:sessionId', wrapAsync(async (req, res) => {
  const { sessionId } = req.params;
  const session = dbw.getSession(sessionId);
  if (!session) return res.status(404).json({ error: 'session not found' });
  const messages = dbw.getMessages(sessionId, 1000);
  const logs = dbw.getLogs(sessionId, 1000);
  const escalations = dbw.getEscalationsForSession(sessionId);
  res.json({ session, messages, logs, escalations });
}));

// Generate & persist a 1-2 sentence summary for a session
app.post('/api/session/:sessionId/summary', wrapAsync(async (req, res) => {
  const { sessionId } = req.params;
  const rows = dbw.getMessages(sessionId, 2000);
  if (!rows || rows.length === 0) return res.status(404).json({ error: 'no messages to summarize' });

  const textForSummary = rows.map(r => `${r.role}: ${r.content}`).join('\n');
  const summarizationRequest = {
    faqHits: [],
    contextMessages: [],
    userMessage: `Please write a concise 1-2 sentence summary of the conversation below:\n\n${textForSummary}`
  };

  const { text: summaryText } = await generateResponse(summarizationRequest);

  // persist the summary
  dbw.updateSessionSummary(sessionId, (summaryText || '').slice(0, 2000));

  logEvent(sessionId, 'info', 'summary_generated', { snippet: (summaryText || '').slice(0,200) });
  res.json({ summary: summaryText });
}));

// ---------- JSON error handler (must be last) ----------
app.use((err, req, res, next) => {
  console.error('Unhandled error:', err?.stack || err);
  try {
    const sid = req.params?.sessionId || req.body?.session_id || null;
    logEvent(sid, 'error', 'unhandled_exception', { message: err?.message });
  } catch (e) { /* ignore logging error */ }

  const status = err.status || 500;
  res.status(status).json({
    error: { message: err.message || 'Internal Server Error', status }
  });
});

app.listen(PORT, () => {
  console.log(`Server listening on http://localhost:${PORT}`);
});
