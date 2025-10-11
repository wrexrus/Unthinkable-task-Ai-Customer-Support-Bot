import React, { useState, useEffect } from 'react';

const API_BASE = 'http://localhost:4000/api';

export default function App() {
  const [sessionId, setSessionId] = useState(null);
  const [input, setInput] = useState('');
  const [messages, setMessages] = useState([]);

  useEffect(() => { createSession(); }, []);

  async function createSession() {
    const res = await fetch(`${API_BASE}/session`, { method: 'POST', headers: { 'Content-Type': 'application/json' }});
    const data = await res.json();
    setSessionId(data.session_id);
  }

  async function sendMessage() {
    if (!input.trim() || !sessionId) return;
    const text = input.trim();
    // optimistic update
    setMessages(prev => [...prev, { role: 'user', text }]);
    setInput('');
    const res = await fetch(`${API_BASE}/session/${sessionId}/message`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text })
    });
    const data = await res.json();
    if (data) {
      setMessages(prev => [...prev, { role: 'assistant', text: data.text }]);
      if (data.escalation) {
        setMessages(prev => [...prev, { role: 'system', text: `Escalation created: ${data.escalation.id}` }]);
      }
    }
  }

  return (
    <div style={{ maxWidth: 720, margin: '20px auto', fontFamily: 'Arial, sans-serif' }}>
      <h2>Unthinkable — AI Support Bot (Demo)</h2>
      <div style={{ border: '1px solid #ddd', padding: 12, minHeight: 300 }}>
        {messages.length === 0 && <div style={{ color: '#666' }}>Say hi to start the demo (e.g., "How do I reset my password?")</div>}
        {messages.map((m, i) => (
          <div key={i} style={{ margin: '8px 0' }}>
            <strong style={{ textTransform: 'capitalize' }}>{m.role}:</strong> <span>{m.text}</span>
          </div>
        ))}
      </div>

      <div style={{ marginTop: 12, display: 'flex', gap: 8 }}>
        <input value={input} onChange={e => setInput(e.target.value)} style={{ flex: 1, padding: 8 }} placeholder="Type your question..." />
        <button onClick={sendMessage} style={{ padding: '8px 12px' }}>Send</button>
      </div>
    </div>
  );
}
