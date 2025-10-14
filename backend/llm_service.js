// backend/llm_service.js
// Enhanced entrypoint: handles real Gemini calls if GEMINI_API_KEY is present,
// otherwise falls back to a deterministic local mock. Critically, it
// recognizes summarization requests and produces a concise summary locally.

const axios = require('axios');

/** Build a plain prompt for Gemini (if used) */
function buildPrompt(faqHits = [], contextMessages = [], userMessage = '') {
  let prompt = 'You are a helpful customer-support assistant.\n\n';
  if (faqHits && faqHits.length > 0) {
    prompt += 'Retrieved FAQs (use these if relevant):\n';
    faqHits.forEach((hit, idx) => {
      prompt += `${idx + 1}) [${hit.id}] Q: ${hit.question}\nA: ${hit.answer}\n\n`;
    });
  }
  if (contextMessages && contextMessages.length > 0) {
    prompt += 'Context (recent messages):\n';
    contextMessages.forEach(m => {
      prompt += `[${m.role}] ${m.content}\n`;
    });
    prompt += '\n';
  }
  prompt += `User: ${userMessage}\nAssistant:`;
  return prompt;
}

/** Try a Gemini call (Vertex AI). Defensive parsing. */
async function generateResponseGemini({ faqHits = [], contextMessages = [], userMessage = '' }) {
  const prompt = buildPrompt(faqHits, contextMessages, userMessage);
  const url = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent';
  const token = process.env.GEMINI_API_KEY;
  if (!token) {
    console.warn("No GEMINI_API_KEY found — using mock responses");
    return {
      actions: [
        "Summarize conversation so far",
        "Offer next steps for user follow-up",
        "Provide a helpful suggestion based on context",
      ],
      reason: "No Gemini key configured",
    };
  }

  const resp = await axios.post(
    url,
    {
      instances: [{ content: prompt }],
      parameters: { temperature: 0.0, maxOutputTokens: 300 }
    },
    {
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      timeout: 20000
    }
  );

  // Defensive extraction of assistant text
  let assistantText = '';
  if (resp?.data?.predictions && resp.data.predictions[0]) {
    const p = resp.data.predictions[0];
    assistantText = p.content || p.text || (p.candidates && p.candidates[0] && p.candidates[0].content) || JSON.stringify(p);
  } else if (resp?.data?.candidates && resp.data.candidates[0]) {
    assistantText = resp.data.candidates[0].content || resp.data.candidates[0].message || JSON.stringify(resp.data.candidates[0]);
  } else {
    assistantText = JSON.stringify(resp.data).slice(0, 2000);
  }

  const shouldEscalate = /i don't know|dont know|not sure|escalat|human support|contact human/i.test(assistantText || '');
  return { text: assistantText.toString().trim(), shouldEscalate };
}

/** Local deterministic summarizer:
 * - If the userMessage contains "summarize" or "summary" or starts with "Please write a concise",
 *   we parse the message (which contains the conversation text) and produce 1-2 sentence summary.
 * - This is NOT an LLM — it's a straightforward heuristic designed for demos.
 */
function localSummarizeFromConversationText(fullText) {
  // Expect fullText to contain many lines like "user: ...", "assistant: ..."
  const lines = (fullText || '').split('\n').map(l => l.trim()).filter(Boolean);

  const userLines = [];
  const assistantLines = [];
  for (const ln of lines) {
    const low = ln.toLowerCase();
    if (low.startsWith('user:')) userLines.push(ln.slice(5).trim());
    else if (low.startsWith('assistant:')) assistantLines.push(ln.slice(10).trim());
    else {
      // also accept lines that look like "user: something" without exact case
      if (ln.toLowerCase().startsWith('u:')) userLines.push(ln.slice(2).trim());
      else if (ln.toLowerCase().startsWith('a:')) assistantLines.push(ln.slice(2).trim());
    }
  }

  // If no structured lines, fallback to chunking fullText
  if (userLines.length === 0 && assistantLines.length === 0) {
    const chunk = fullText.trim().split('\n').slice(0, 10).join(' ');
    const truncated = chunk.slice(0, 300);
    return `Conversation summary: ${truncated}...`;
  }

  // Derive a short "intent" phrase from first user line (or most frequent words)
  const firstUser = userLines[0] || userLines.join(' | ');
  // create short description (first 10-12 words)
  const userIntent = firstUser.split(/\s+/).slice(0, 12).join(' ');
  // pick most relevant assistant reply (first assistant line that looks substantive)
  const firstAssistant = assistantLines.find(a => a && a.length > 5) || assistantLines[0] || '';

  // Build a concise 1-2 sentence summary
  let summary = `User asked about: "${userIntent}".`;
  if (firstAssistant) {
    // shorten assistant response to first 20 words
    const shortAssist = firstAssistant.split(/\s+/).slice(0, 20).join(' ');
    summary += ` Assistant responded: "${shortAssist}${firstAssistant.split(/\s+/).length > 20 ? '...' : ''}".`;
  } else {
    summary += ' No assistant response recorded.';
  }

  // If the conversation contains escalation keywords, append note
  const convoText = (userLines.join(' ') + ' ' + assistantLines.join(' ')).toLowerCase();
  if (/\b(refund|legal|chargeback|sue|complain|escalat|human)\b/.test(convoText)) {
    summary += ' The conversation includes a request or keyword that may require human escalation.';
  }

  return summary;
}

/** Mock fallback: uses FAQ hits or asks clarifying Q when unsure.
 * - But if userMessage is a summarization request, returns summary via localSummarizeFromConversationText.
 */
function buildAssistantTextFromFaq(faqHits = []) {
  if (!faqHits || faqHits.length === 0) return null;
  const top = faqHits[0];
  if (typeof top.score === 'number' && top.score >= 0.45) {
    return `FAQ:${top.id} ${top.answer}`;
  }
  return `I found something related (${top.id}): ${top.answer} If that doesn't help, please provide more details or ask for human support.`;
}

function detectEscalation(userMessage = '', assistantText = '') {
  const kws = ['refund', 'chargeback', 'sue', 'legal', 'human', 'complain', 'escalate'];
  const msg = (userMessage || '').toLowerCase();
  const hasKw = kws.some(k => msg.includes(k));
  const lowConfidence = !assistantText || assistantText.toLowerCase().includes("i don't know") || assistantText.toLowerCase().includes("not sure");
  return hasKw || lowConfidence;
}

async function generateResponse({ faqHits = [], contextMessages = [], userMessage = '' }) {
  // --- 1) Recognize summarization requests ---
  const low = (userMessage || '').toLowerCase();
  if (low.includes('summar') || low.startsWith('please write a concise') || low.includes('please summarize')) {
    // If server passed full conversation text in userMessage, use that.
    const summary = localSummarizeFromConversationText(userMessage);
    return { text: summary, shouldEscalate: false };
  }

  // --- 2) If GEMINI configured, try calling it ---
  if (process.env.GEMINI_API_KEY) {
    try {
      return await generateResponseGemini({ faqHits, contextMessages, userMessage });
    } catch (err) {
      console.warn('Gemini call failed; falling back to mock. Error:', err?.message || err);
      // continue to fallback
    }
  }

  // --- 3) Fallback/mock path ---
  const fromFaq = buildAssistantTextFromFaq(faqHits);
  if (fromFaq) {
    const shouldEscalate = detectEscalation(userMessage, fromFaq);
    return { text: fromFaq, shouldEscalate };
  }

  // 4) No FAQ found: ask a clarifying question (and escalate if needed)
  const clarifying = 'Can you please provide more details about the issue (account type, product, or exact error)?';
  const shouldEsc = detectEscalation(userMessage, null);
  return { text: clarifying, shouldEscalate: shouldEsc };
}


async function generateNextActions({ faqHits = [], contextMessages = [], userMessage = '' }) {
  // Build a short prompt for action suggestions
  const convoText = (contextMessages || []).map(m => `${m.role}: ${m.content}`).join('\n') + `\nUser: ${userMessage || ''}`;
  const actionPrompt = `You are a customer-support assistant. Given the conversation below, produce a short ordered list (3-6 items) of concrete next actions for support staff or the user. Keep each item short (<= 20 words). Use bullet points. Conversation:\n\n${convoText}\n\nACTIONS:`;

  // Try Gemini if available
  if (process.env.GEMINI_API_KEY) {
    try {
      // Reuse generateResponseGemini style call but with actionPrompt
      const url = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent';
      const resp = await axios.post(
        url,
        { instances: [{ content: actionPrompt }], parameters: { temperature: 0.0, maxOutputTokens: 200 } },
        { headers: { Authorization: `Bearer ${process.env.GEMINI_API_KEY}`, 'Content-Type': 'application/json' }, timeout: 20000 }
      );

      // defensive extraction
      let raw = '';
      if (resp?.data?.predictions && resp.data.predictions[0]) {
        const p = resp.data.predictions[0];
        raw = p.content || p.text || (p.candidates && p.candidates[0] && p.candidates[0].content) || JSON.stringify(p);
      } else if (resp?.data?.candidates && resp.data.candidates[0]) {
        raw = resp.data.candidates[0].content || resp.data.candidates[0].message || JSON.stringify(resp.data.candidates[0]);
      } else {
        raw = JSON.stringify(resp.data).slice(0, 2000);
      }

      // split into bullet lines
      const lines = raw.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
      const actions = [];
      for (const ln of lines) {
        // strip leading bullets and numbers
        const cleaned = ln.replace(/^[-\d\.\)\s]+/, '').trim();
        if (cleaned) actions.push(cleaned);
        if (actions.length >= 6) break;
      }
      if (actions.length === 0) actions.push(raw.slice(0, 200));
      return { actions, reason: 'gemini' };
    } catch (err) {
      console.warn('Gemini next-actions failed, falling back:', err?.message || err);
      
    }
  }

  // Deterministic fallback (no external LLM)
  // Heuristic: look for escalation keywords, order id, billing, login, refund, invoice
  const text = (convoText || '').toLowerCase();
  const actions = [];

  // If contains billing/refund keywords => suggest billing steps
  if (/\b(refund|chargeback|billing|invoice|payment|card|declin)\b/.test(text)) {
    actions.push('Collect order/invoice ID and last 4 digits of card.');
    actions.push('Verify purchase date and refund eligibility (30-day policy).');
    actions.push('Escalate to Billing team with collected evidence.');
  }

  // If contains login/account keywords
  if (/\b(password|reset|login|sign in|account|locked)\b/.test(text)) {
    actions.push('Ask user to confirm registered email or username.');
    actions.push('Send password reset link or guide through Settings -> Reset Password.');
    actions.push('If email not received, check spam and resend or escalate.');
  }

  // If contains integration/API/technical keywords
  if (/\b(api|integrat|webhook|slack|error|traceback|exception)\b/.test(text)) {
    actions.push('Request exact error message and steps to reproduce.');
    actions.push('Request environment details (OS, app version, API request payload).');
    actions.push('Create a debug ticket for Engineering with logs and sample request.');
  }

  // Generic helpful steps if no domain detected
  if (actions.length === 0) {
    actions.push('Ask clarifying question: what exact issue or error are you seeing?');
    actions.push('Request account identifier (email or user id) and relevant timestamps.');
    actions.push('Offer to escalate to human support if needed.');
  }

  // Trim to max 6 and ensure uniqueness
  const unique = Array.from(new Set(actions)).slice(0, 6);
  return { actions: unique, reason: 'fallback' };
}

// attach to exported function (keeping backward compatibility)
if (typeof module.exports === 'function') {
  module.exports.generateNextActions = generateNextActions;
} else if (module && module.exports) {
  module.exports.generateNextActions = generateNextActions;
}

generateResponse.generateNextActions = generateNextActions;


module.exports = generateResponse;

