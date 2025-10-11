const fs = require('fs');
const path = require('path');
const stringSimilarity = require('string-similarity');

const faqsPath = path.join(__dirname, '..', 'data', 'faqs.csv');

function loadFaqs() {
  if (!fs.existsSync(faqsPath)) return [];
  const raw = fs.readFileSync(faqsPath, 'utf8');
  const lines = raw.split('\n').map(l => l.trim()).filter(Boolean);
  // expected CSV: id,question,answer
  const faqs = lines.map(line => {
    const parts = line.split(',').map(p => p.trim());
    const id = parts[0];
    const question = parts[1];
    const answer = parts.slice(2).join(',');
    return { id, question, answer };
  });
  return faqs;
}

const FAQS = loadFaqs();

function searchFaqs(query, limit = 3) {
  if (!query) return [];
  const scores = FAQS.map(f => {
    const score = stringSimilarity.compareTwoStrings(query.toLowerCase(), f.question.toLowerCase());
    return { ...f, score };
  });
  scores.sort((a,b) => b.score - a.score);
  return scores.slice(0, limit);
}

module.exports = {
  searchFaqs,
  loadFaqs
};
