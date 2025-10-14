import React, { useEffect, useState } from "react";
import axios from "../api/axios";

export default function AdminPanel({ onPickSession }) {
  const [sessions, setSessions] = useState([]);
  const [selected, setSelected] = useState(null);
  const [detail, setDetail] = useState(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => { loadSessions(); }, []);

  async function loadSessions() {
    setLoading(true);
    try {
      const res = await axios.get("/admin/sessions");
      setSessions(res.data.sessions || []);
    } catch (err) {
      console.error("loadSessions", err);
      setSessions([]);
    } finally {
      setLoading(false);
    }
  }

  async function showSession(id) {
    setSelected(id);
    try {
      const res = await axios.get(`/admin/session/${id}`);
      setDetail(res);
    } catch (err) {
      console.error("showSession", err);
      setDetail(null);
    }
  }

  async function handlePick() {
    if (!selected || !detail) return;
    const summ = detail.session?.summary || "";
    onPickSession(selected, summ);
  }

  async function generateSummary() {
    if (!selected) return;
    setLoading(true);
    try {
      await axios.post(`/session/${selected}/summary`, {});
      // reload details & sessions
      await showSession(selected);
      await loadSessions();
    } catch (err) {
      console.error("generateSummary", err);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between mb-2">
        <h3 className="text-lg font-semibold">Admin</h3>
        <button onClick={loadSessions} className="text-sm px-2 py-1 bg-gray-100 rounded">Refresh</button>
      </div>

      <div className="flex gap-3">
        <div className="w-44 border rounded p-2 overflow-auto max-h-[320px]">
          {loading && <div className="text-sm text-gray-500">Loading...</div>}
          {sessions.map(s => (
            <div key={s.id} className="p-2 border-b hover:bg-gray-50 cursor-pointer" onClick={() => showSession(s.id)}>
              <div className="text-xs text-gray-600">{s.id.slice(0,8)}</div>
              <div className="text-sm text-gray-800">{s.summary ? s.summary.slice(0,40) : "— no summary —"}</div>
              <div className="text-xs text-gray-500">{s.last_active}</div>
            </div>
          ))}
        </div>

        <div className="flex-1 border rounded p-2 min-h-[320px]">
          {!detail && <div className="text-sm text-gray-500">Select a session to view details</div>}
          {detail && (
            <>
              <div className="flex items-center justify-between mb-2">
                <div>
                  <div className="text-sm text-gray-600">Session</div>
                  <div className="font-mono text-sm">{detail.session.id}</div>
                </div>
                <div className="text-right">
                  <div className="text-sm text-gray-600">Summary</div>
                  <div className="text-sm">{detail.session.summary || "—"}</div>
                </div>
              </div>

              <div className="mb-2">
                <button onClick={generateSummary} className="px-2 py-1 bg-indigo-600 text-white rounded mr-2">Generate Summary</button>
                <button onClick={handlePick} className="px-2 py-1 bg-green-600 text-white rounded">Use Session</button>
              </div>

              <h4 className="text-sm font-semibold">Messages</h4>
              <div className="max-h-36 overflow-auto border p-2 mb-2">
                {detail.messages.map(m => <div key={m.id}><strong>{m.role}</strong>: {m.content}</div>)}
              </div>

              <h4 className="text-sm font-semibold">Logs</h4>
              <div className="max-h-28 overflow-auto border p-2 mb-2 text-xs text-gray-600">
                {detail.logs.map(l => <div key={l.id}>[{l.level}] {l.message} {l.meta ? `- ${l.meta}` : ''}</div>)}
              </div>

              <h4 className="text-sm font-semibold">Escalations</h4>
              <div className="max-h-28 overflow-auto border p-2 text-sm">
                {detail.escalations.length === 0 && <div>None</div>}
                {detail.escalations.map(e => <div key={e.id}><strong>{e.status}</strong>: {e.reason} — {e.notes}</div>)}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
