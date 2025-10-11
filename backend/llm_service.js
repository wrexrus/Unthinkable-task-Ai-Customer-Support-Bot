// backend/llm_service.js  (replace/patch)
const axios = require('axios');

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

/* keep generateResponseGemini(...) from your current file if you want */
async function generateResponseGemini({ faqHits = [], contextMessages = [], userMessage = '' }) {
  const prompt = buildPrompt(faqHits, contextMessages, userMessage);
  const url = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent';
  const resp = await axios.post(
    url,
    { instances: [{ content: prompt }], parameters: { temperature: 0.0, maxOutputTokens: 300 } },
    { headers: { Authorization: `Bearer ${process.env.GEMINI_API_KEY}`, 'Content-Type': 'application/json' }, timeout: 20000 }
  );
  let assistantText = '';
  if (resp?.data?.predictions && resp.data.predictions[0]) {
    const p = resp.data.predictions[0];
    assistantText = p.content || p.text || (p.candidates && p.candidates[0] && p.candidates[0].content) || JSON.stringify(p);
  } else {
    assistantText = JSON.stringify(resp.data).slice(0, 1000);
  }
  const shouldEscalate = /i don't know|dont know|not sure|cannot answer|unable to answer/i.test(assistantText || '');
  return { text: assistantText.toString().trim(), shouldEscalate };
}

/* NEW: safer escalation detector */
function detectEscalation(userMessage = '', assistantText = '') {
  // Escalate only if:
  //  - user explicitly used escalation keywords OR
  //  - assistant explicitly admitted inability ("I don't know", "cannot answer")
  const escalationKeywords = ['refund', 'chargeback', 'sue', 'legal', 'human', 'complain', 'escalate', 'delete account'];
  const user = (userMessage || '').toLowerCase();
  const hasUserEscalationKW = escalationKeywords.some(k => user.includes(k));

  const assistant = (assistantText || '').toLowerCase();
  const assistantAdmitsFailure = /i don't know|dont know|not sure|cannot answer|unable to answer|i cannot help/i.test(assistant);

  return hasUserEscalationKW || assistantAdmitsFailure;
}

/* MOCK fallback functions unchanged (but use updated detectEscalation) */
function buildAssistantTextFromFaq(faqHits = []) {
  if (!faqHits || faqHits.length === 0) return null;
  const top = faqHits[0];
  // lower threshold to 0.35 to be more permissive
  if (typeof top.score === 'number' && top.score >= 0.35) {
    return `FAQ:${top.id} ${top.answer}`;
  }
  return `I found something related (${top.id}): ${top.answer} If that doesn't help, please provide more details or ask for human support.`;
}

async function generateResponse({ faqHits = [], contextMessages = [], userMessage = '' }) {
  if (process.env.GEMINI_API_KEY) {
    try {
      return await generateResponseGemini({ faqHits, contextMessages, userMessage });
    } catch (err) {
      console.warn('Gemini failed — falling back to local mock. Error:', err?.message || err);
    }
  }

  const fromFaq = buildAssistantTextFromFaq(faqHits);
  if (fromFaq) {
    const shouldEsc = detectEscalation(userMessage, fromFaq);
    return { text: fromFaq, shouldEscalate: shouldEsc };
  }

  const clarifying = 'Can you please provide more details about the issue (account type, product, or exact error)?';
  const shouldEsc = detectEscalation(userMessage, clarifying);
  return { text: clarifying, shouldEscalate: shouldEsc };
}

module.exports = generateResponse;
