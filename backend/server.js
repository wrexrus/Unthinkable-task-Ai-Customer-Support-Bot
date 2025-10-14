require('dotenv').config();
const express = require('express');
const bodyParser = require('body-parser');
const cors = require('cors');
const { v4: uuidv4 } = require('uuid');
const db = require('./db'); 
const dbw = require('./db_wrapper');
const { searchFaqs } = require('./faq_retriever');
const generateResponse = require('./llm_service'); 
const { LRUCache } = require('lru-cache');

const app = express();
app.use(cors());
app.use(bodyParser.json());

const PORT = process.env.PORT || 4000;
const contextCache = new LRUCache({ max: 10000, ttl: 1000 * 60 * 60 }); 

function logEvent(sessionId, level, message, meta = null) {
  try {
    return dbw.addLog(sessionId, level, message, meta);
  } catch (err) {
    console.error('Failed to write log:', err);
  }
}

function wrapAsync(fn) {
  return function (req, res, next) {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
}


app.post('/api/session', wrapAsync(async (req, res) => {
  const sessionId = uuidv4();
  const userId = req.body.user_id || null;
  dbw.createSession(sessionId, userId);
  logEvent(sessionId, 'info', 'session_created', { userId });
  res.json({ session_id: sessionId, created_at: new Date().toISOString() });
}));

app.post('/api/session/:sessionId/message', wrapAsync(async (req, res) => {
  const { sessionId } = req.params;
  const { text } = req.body;
  if (!text) return res.status(400).json({ error: 'Missing text field' });

  dbw.createSession(sessionId); 
  logEvent(sessionId, 'info', 'received_user_message', { textSnippet: text.slice(0, 200) });

  dbw.addMessage(sessionId, 'user', text);

  let context = contextCache.get(sessionId);
  if (!context) {
    context = dbw.getRecentMessages(sessionId, 8);
    contextCache.set(sessionId, context);
  }

  const faqHits = searchFaqs(text, 3);
  logEvent(sessionId, 'debug', 'faq_search_completed', { query: text.slice(0,200), hits: faqHits.map(h => ({id:h.id,score:h.score})) });

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

  dbw.addMessage(sessionId, 'assistant', assistantText);

  context.push({ role: 'user', content: text });
  context.push({ role: 'assistant', content: assistantText });
  if (context.length > 12) context.splice(0, context.length - 12);
  contextCache.set(sessionId, context);

  dbw.touchSession(sessionId);

  return res.json({ role: 'assistant', text: assistantText, faqs: faqHits.map(f => ({ id: f.id, score: f.score })) });
}));

app.get('/api/session/:sessionId/history', wrapAsync(async (req, res) => {
  const { sessionId } = req.params;
  const rows = dbw.getMessages(sessionId, 1000);
  res.json({ messages: rows });
}));

app.post('/api/session/:sessionId/escalate', wrapAsync(async (req, res) => {
  const { sessionId } = req.params;
  const { reason, notes } = req.body;
  const escId = dbw.createEscalation(sessionId, reason || 'manual', notes || '');
  logEvent(sessionId, 'info', 'manual_escalation', { escId, reason });
  res.json({ escalation_id: escId, status: 'queued' });
}));

app.get('/api/escalations', wrapAsync(async (req, res) => {
  const rows = dbw.listEscalations(200);
  res.json(rows);
}));

app.get('/api/session/:sessionId/logs', wrapAsync(async (req, res) => {
  const { sessionId } = req.params;
  const rows = dbw.getLogs(sessionId, 1000);
  res.json({ logs: rows });
}));

app.get('/api/admin/sessions', wrapAsync(async (req, res) => {
  const rows = dbw.listSessions(200);
  res.json({ sessions: rows });
}));

app.get('/api/admin/session/:sessionId', wrapAsync(async (req, res) => {
  const { sessionId } = req.params;
  const session = dbw.getSession(sessionId);
  if (!session) return res.status(404).json({ error: 'session not found' });
  const messages = dbw.getMessages(sessionId, 1000);
  const logs = dbw.getLogs(sessionId, 1000);
  const escalations = dbw.getEscalationsForSession(sessionId);
  res.json({ session, messages, logs, escalations });
}));

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

  dbw.updateSessionSummary(sessionId, (summaryText || '').slice(0, 2000));

  logEvent(sessionId, 'info', 'summary_generated', { snippet: (summaryText || '').slice(0,200) });
  res.json({ summary: summaryText });
}));

app.post('/api/session/:sessionId/next_actions', wrapAsync(async (req, res) => {
  const { sessionId } = req.params;
  let context = contextCache.get(sessionId);
  if (!context) {
    context = dbw.getRecentMessages(sessionId, 12);
    contextCache.set(sessionId, context);
  }

  const lastUser = [...context].reverse().find(m => m.role === 'user');
  const lastText = lastUser ? lastUser.content : (req.body.prompt || '');
  const faqHits = lastText ? searchFaqs(lastText, 3) : [];

  const fn = generateResponse.generateNextActions || generateResponse.generateNextActions;
  if (!fn) {
    const fallback = { actions: ['No next-actions generator available'], reason: 'missing' };
    dbw.addLog(sessionId, 'warn', 'next_actions_missing', { requestedBy: 'api' });
    return res.json(fallback);
  }

  const { actions, reason } = await fn({ faqHits, contextMessages: context, userMessage: lastText });

  dbw.addLog(sessionId, 'info', 'next_actions_generated', { reason, sample: actions.slice(0,3) });

  res.json({ actions, reason });
}));



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
