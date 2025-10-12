// frontend/src/Admin.jsx
import React, { useState, useEffect } from 'react';
const API_BASE = 'http://localhost:4000/api';

export default function Admin() {
  const [sessions, setSessions] = useState([]);
  const [selected, setSelected] = useState(null);
  const [detail, setDetail] = useState(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => loadSessions(), []);

  async function loadSessions() {
    setLoading(true);
    const res = await fetch(`${API_BASE}/admin/sessions`);
    const data = await res.json();
    setSessions(data.sessions || []);
    setLoading(false);
  }

  async function showSession(id) {
    setSelected(id);
    const res = await fetch(`${API_BASE}/admin/session/${id}`);
    const data = await res.json();
    setDetail(data);
  }

  async function generateSummary() {
    if (!selected) return;
    setLoading(true);
    const res = await fetch(`${API_BASE}/session/${selected}/summary`, { method: 'POST' });
    const data = await res.json();
    // refresh session list to show new summary
    await loadSessions();
    setDetail(prev => ({ ...prev, session: { ...prev.session, summary: data.summary } }));
    setLoading(false);
  }

  return (
    <div style={{ display: 'flex', gap: 16, padding: 12 }}>
      <div style={{ width: 320, borderRight: '1px solid #eee', paddingRight: 12 }}>
        <h3>Sessions</h3>
        {loading && <div>Loading...</div>}
        <ul style={{ listStyle: 'none', padding: 0 }}>
          {sessions.map(s => (
            <li key={s.id} style={{ marginBottom: 8, cursor: 'pointer' }} onClick={() => showSession(s.id)}>
              <div style={{ fontSize: 13, fontWeight: '600' }}>{s.id.slice(0,8)}</div>
              <div style={{ fontSize: 12, color: '#666' }}>{s.last_active || s.created_at}</div>
              <div style={{ fontSize: 12, color: '#444' }}>{s.summary ? s.summary.slice(0,80) : '— no summary —'}</div>
            </li>
          ))}
        </ul>
      </div>

      <div style={{ flex: 1 }}>
        {!detail && <div>Select a session to view details</div>}
        {detail && (
          <>
            <h3>Session {detail.session.id}</h3>
            <div style={{ marginBottom: 8 }}><strong>Summary:</strong> {detail.session.summary || '—'}</div>
            <button onClick={generateSummary} disabled={loading}>Generate Summary</button>

            <h4>Messages</h4>
            <div style={{ maxHeight: 240, overflow: 'auto', border: '1px solid #eee', padding: 8 }}>
              {detail.messages.map(m => <div key={m.id}><strong>{m.role}:</strong> {m.content}</div>)}
            </div>

            <h4 style={{ marginTop: 12 }}>Logs</h4>
            <div style={{ maxHeight: 160, overflow: 'auto', border: '1px solid #eee', padding: 8 }}>
              {detail.logs.map(l => <div key={l.id}><small>[{l.level}] {l.message} {l.meta ? `- ${l.meta}` : ''}</small></div>)}
            </div>

            <h4 style={{ marginTop: 12 }}>Escalations</h4>
            <div style={{ maxHeight: 160, overflow: 'auto', border: '1px solid #eee', padding: 8 }}>
              {detail.escalations.length === 0 && <div>None</div>}
              {detail.escalations.map(e => <div key={e.id}><strong>{e.status}</strong>: {e.reason} — {e.notes}</div>)}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
