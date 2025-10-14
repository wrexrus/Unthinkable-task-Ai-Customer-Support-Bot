const fs = require('fs');
const path = require('path');
const stringSimilarity = require('string-similarity');

const faqsPath = path.join(__dirname, '..', 'data', 'faqs.csv');

function normalizeText(s = '') {
  return (s || '').toString().trim().toLowerCase().replace(/[^a-z0-9\s]/g, ' ');
}

function loadFaqs() {
  if (!fs.existsSync(faqsPath)) return [];
  const raw = fs.readFileSync(faqsPath, 'utf8');
  const lines = raw.split('\n').map(l => l.trim()).filter(Boolean);

  const faqs = [];
  for (const line of lines) {
    // Expecting: id,question,answer  (answer may include commas)
    // Use a regex to split first two commas only
    const m = line.match(/^([^,]+),([^,]+),([\s\S]+)$/);
    if (!m) continue;
    const id = m[1].trim();
    const question = m[2].trim();
    const answer = m[3].trim();
    faqs.push({
      id,
      question,
      question_norm: normalizeText(question),
      answer,
    });
  }
  return faqs;
}

const FAQS = loadFaqs();

function searchFaqs(query, limit = 3) {
  if (!query) return [];
  const qnorm = normalizeText(query);

  // compute similarity between normalized query and normalized faq question
  const scores = FAQS.map(f => {
    const score = stringSimilarity.compareTwoStrings(qnorm, f.question_norm);
    return { id: f.id, question: f.question, answer: f.answer, score };
  });

  scores.sort((a,b) => b.score - a.score);
  return scores.slice(0, limit);
}

module.exports = {
  searchFaqs,
  loadFaqs
};
