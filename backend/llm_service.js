const { Configuration, OpenAIApi } = require('openai');
const systemPrompt = `You are Unthinkable Assistant, a concise and accurate customer support agent. 
- Use retrieved FAQ answers if they match.
- Keep replies short (<= 120 words) unless the user asks for details.
- If you cannot answer confidently, reply "I don't know — escalating" and let the system escalate.`;

const OPENAI_KEY = process.env.OPENAI_API_KEY;
if (!OPENAI_KEY) {
  console.warn('Warning: OPENAI_API_KEY is not set. LLM calls will fail.');
}
const config = new Configuration({ apiKey: OPENAI_KEY });
const client = new OpenAIApi(config);

function buildPrompt(faqHits, contextMessages, userMessage) {
  let p = `${systemPrompt}\n\nRETRIEVED_FAQS:\n`;
  faqHits.forEach((f, i) => {
    p += `${i+1}) [FAQ:${f.id},score:${f.score.toFixed(3)}] Q: ${f.question}\nA: ${f.answer}\n\n`;
  });
  p += `CONTEXT (recent):\n`;
  contextMessages.forEach(m => {
    p += `[${m.role}] ${m.content}\n`;
  });
  p += `\nUSER: ${userMessage}\n\nINSTRUCTIONS: Answer concisely. If the FAQ above directly answers, use it and reference FAQ id. If uncertain, say "I don't know — escalating".`;
  return p;
}

async function generateResponse({ faqHits = [], contextMessages = [], userMessage = '' }) {
  const prompt = buildPrompt(faqHits, contextMessages, userMessage);

  try {
    const resp = await client.createChatCompletion({
      model: 'gpt-4o-mini', // change to available model in your account; fallback to 'gpt-4o-mini' or 'gpt-4o' per access
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'system', content: faqHits.map(f => `[FAQ:${f.id}] Q:${f.question} A:${f.answer}`).join('\n') },
        ...contextMessages.map(m => ({ role: m.role === 'assistant' ? 'assistant' : 'user', content: m.content })),
        { role: 'user', content: userMessage }
      ],
      temperature: 0.0,
      max_tokens: 300
    });

    const assistantText = resp.data.choices[0].message.content.trim();

    const shouldEscalate = /i don't know|dont know|not sure|escalat/i.test(assistantText);

    return { text: assistantText, shouldEscalate };
  } catch (err) {
    console.error('LLM error', err?.response?.data || err.message || err);
    return { text: "I'm having trouble accessing the LLM right now.", shouldEscalate: true };
  }
}

module.exports = { generateResponse };
