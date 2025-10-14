const axios = require('axios');

function buildPrompt(faqHits = [], contextMessages = [], userMessage = '') {
  const system = `You are a customer support assistant. 
Be concise (max 2 sentences unless asked). Do NOT guess or invent facts. 
If unsure, ask a single clarifying question. If the issue seems sensitive (billing/refund/legal), recommend escalation.`;

  let prompt = `${system}\n\n`;

  if (faqHits && faqHits.length > 0) {
    prompt += 'Relevant FAQ snippets (use only if they directly answer):\n';
    faqHits.slice(0,3).forEach((hit, idx) => {
      const snippet = (hit.answer || hit.snippet || hit.question || '').toString().slice(0,400);
      prompt += `${idx+1}) ${snippet}\n`;
    });
    prompt += '\n';
  }

  if (contextMessages && contextMessages.length > 0) {
    prompt += 'Recent conversation (oldest->newest):\n';
    contextMessages.forEach(m => {
      const role = m.role === 'assistant' ? 'Assistant' : 'User';
      const c = (m.content || '').toString().slice(0,800);
      prompt += `${role}: ${c}\n`;
    });
    prompt += '\n';
  }

  prompt += `User: ${userMessage}\nAssistant:`;
  return prompt;
}


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

function localSummarizeFromConversationText(fullText) {
  const lines = (fullText || '').split('\n').map(l => l.trim()).filter(Boolean);
  const userLines = [];
  const assistantLines = [];
  for (const ln of lines) {
    const low = ln.toLowerCase();
    if (low.startsWith('user:')) userLines.push(ln.slice(5).trim());
    else if (low.startsWith('assistant:')) assistantLines.push(ln.slice(10).trim());
    else if (low.startsWith('u:')) userLines.push(ln.slice(2).trim());
    else if (low.startsWith('a:')) assistantLines.push(ln.slice(2).trim());
  }

  if (userLines.length === 0 && assistantLines.length === 0) {
    const chunk = fullText.trim().split('\n').slice(0, 10).join(' ');
    const truncated = chunk.slice(0, 300);
    return `Conversation summary: ${truncated}...`;
  }

  const firstUser = userLines[0] || userLines.join(' | ');
  const userIntent = firstUser.split(/\s+/).slice(0, 12).join(' ');
  const firstAssistant = assistantLines.find(a => a && a.length > 5) || assistantLines[0] || '';

  let summary = `User asked about: "${userIntent}".`;
  if (firstAssistant) {
    const shortAssist = firstAssistant.split(/\s+/).slice(0, 20).join(' ');
    summary += ` Assistant responded: "${shortAssist}${firstAssistant.split(/\s+/).length > 20 ? '...' : ''}".`;
  } else {
    summary += ' No assistant response recorded.';
  }

  const convoText = (userLines.join(' ') + ' ' + assistantLines.join(' ')).toLowerCase();
  if (/\b(refund|legal|chargeback|sue|complain|escalat|human)\b/.test(convoText)) {
    summary += ' The conversation includes a request that may require human escalation.';
  }

  return summary;
}

async function generateResponse({ faqHits = [], contextMessages = [], userMessage = '' }) {
  const FAQ_CONF_THRESHOLD = 0.6;
  const CLARIFY_TRIGGER_COUNT = 2;
  const escalationKeywords = ['refund', 'chargeback', 'sue', 'legal', 'human', 'complain', 'escalate', 'fraud'];
  const lowerUser = (userMessage || '').toLowerCase();

  if (escalationKeywords.some(k => lowerUser.includes(k))) {
    return {
      text: "This looks like it may require human support. I'm escalating this issue to a live agent.",
      shouldEscalate: true
    };
  }

  const low = lowerUser;
  if (low.includes('summar') || low.startsWith('please write a concise') || low.includes('please summarize')) {
    const summary = localSummarizeFromConversationText(userMessage);
    return { text: summary, shouldEscalate: false };
  }

  if (process.env.GEMINI_API_KEY) {
    try {
      const result = await generateResponseGemini({ faqHits, contextMessages, userMessage });
      const assistantText = (result.text || '').replace(/^I found something related \(faq_\d+\):\s*/i, '');
      const shouldEsc = /i don't know|not sure|escalat|human/i.test(assistantText.toLowerCase());
      return { text: assistantText, shouldEscalate: shouldEsc };
    } catch (err) {
      console.warn('Gemini call failed — falling back to local logic:', err.message);
    }
  }

  let topFaq = faqHits?.[0];
  const prevAssistantClarifyCount = (contextMessages || []).filter(m =>
    m.role === 'assistant' &&
    /can you please provide more details|please provide more details|please clarify/i.test(m.content || '')
  ).length;

  if (topFaq && topFaq.score >= FAQ_CONF_THRESHOLD) {
    const answer = (topFaq.answer || '').replace(/^I found something related.*?:\s*/i, '').trim();
    return { text: answer, shouldEscalate: false };
  }

  if (topFaq && topFaq.score < FAQ_CONF_THRESHOLD) {
    if (prevAssistantClarifyCount >= CLARIFY_TRIGGER_COUNT) {
      return { text: "I still don't have enough info, escalating to human support.", shouldEscalate: true };
    }
    const hint = topFaq.question || '';
    return {
      text: hint
        ? `I found something possibly related. Could you clarify a bit more — e.g. ${hint.split('. ')[0]}?`
        : "I couldn't find a precise answer. Could you provide more details (product, account type, or exact error)?",
      shouldEscalate: false
    };
  }

  if (prevAssistantClarifyCount >= CLARIFY_TRIGGER_COUNT) {
    return { text: "I'm still not sure. Let me escalate this to a support agent.", shouldEscalate: true };
  }

  return {
    text: 'Can you please provide more details about the issue (account type, product, or exact error)?',
    shouldEscalate: false
  };
}

async function generateNextActions({ faqHits = [], contextMessages = [], userMessage = '' }) {
  const convoText = (contextMessages || []).map(m => `${m.role}: ${m.content}`).join('\n') + `\nUser: ${userMessage || ''}`;
  const actionPrompt = `You are a customer-support assistant. Given the conversation below, produce a short ordered list (3-6 items) of concrete next actions for support staff or the user. Keep each item short (<= 20 words). Use bullet points. Conversation:\n\n${convoText}\n\nACTIONS:`;

  if (process.env.GEMINI_API_KEY) {
    try {
      const url = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent';
      const resp = await axios.post(
        url,
        { instances: [{ content: actionPrompt }], parameters: { temperature: 0.0, maxOutputTokens: 200 } },
        { headers: { Authorization: `Bearer ${process.env.GEMINI_API_KEY}`, 'Content-Type': 'application/json' }, timeout: 20000 }
      );

      let raw = '';
      if (resp?.data?.predictions && resp.data.predictions[0]) {
        const p = resp.data.predictions[0];
        raw = p.content || p.text || (p.candidates && p.candidates[0] && p.candidates[0].content) || JSON.stringify(p);
      } else if (resp?.data?.candidates && resp.data.candidates[0]) {
        raw = resp.data.candidates[0].content || resp.data.candidates[0].message || JSON.stringify(resp.data.candidates[0]);
      } else {
        raw = JSON.stringify(resp.data).slice(0, 2000);
      }

      const lines = raw.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
      const actions = [];
      for (const ln of lines) {
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

  const text = (convoText || '').toLowerCase();
  const actions = [];

  if (/\b(refund|billing|invoice|payment|card)\b/.test(text)) {
    actions.push('Collect order/invoice ID and card last 4 digits.');
    actions.push('Verify purchase date and refund eligibility.');
    actions.push('Escalate to Billing team with evidence.');
  }

  if (/\b(password|login|account|locked)\b/.test(text)) {
    actions.push('Confirm user email/username.');
    actions.push('Guide through Settings -> Reset Password.');
    actions.push('Check spam if reset email not received.');
  }

  if (/\b(api|integration|webhook|error|traceback)\b/.test(text)) {
    actions.push('Request error message and reproduction steps.');
    actions.push('Collect environment details and create debug ticket.');
  }

  if (actions.length === 0) {
    actions.push('Ask clarifying question about exact issue.');
    actions.push('Request user ID and timestamps.');
    actions.push('Offer escalation to human support.');
  }

  const unique = Array.from(new Set(actions)).slice(0, 6);
  return { actions: unique, reason: 'fallback' };
}

generateResponse.generateNextActions = generateNextActions;

module.exports = generateResponse;
