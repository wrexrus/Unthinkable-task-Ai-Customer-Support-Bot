// src/App.jsx
import React, { useState, useEffect } from "react";
import ChatWindow from "./components/ChatWindow";
import axios from "./api/axios";

/**
 * Simple Error Boundary so Admin problems don't crash the whole app.
 */
class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, info: null };
  }
  static getDerivedStateFromError() {
    return { hasError: true };
  }
  componentDidCatch(error, info) {
    console.error("ErrorBoundary caught:", error, info);
    this.setState({ info: info });
  }
  render() {
    if (this.state.hasError) {
      return (
        <div className="p-4 bg-red-50 border border-red-200 rounded text-red-700">
          <strong>Something went wrong in the admin panel.</strong>
          <div className="mt-2 text-sm">Open console for details.</div>
          <button onClick={() => this.setState({ hasError: false, info: null })} className="mt-3 px-3 py-1 bg-gray-100 rounded">
            Dismiss
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}

/**
 * Embedded AdminPanel (fixed).
 * - uses axios and ALWAYS reads response.data
 * - has a "Back" button when viewing details
 * - exposes onPickSession to let App load a session
 */
function AdminPanel({ onPickSession }) {
  const [sessions, setSessions] = useState([]);
  const [selectedId, setSelectedId] = useState(null);
  const [detail, setDetail] = useState(null);
  const [loading, setLoading] = useState(false);
  const [view, setView] = useState("list"); // 'list' or 'detail'

  useEffect(() => {
    loadSessions();
  }, []);

  async function loadSessions() {
    setLoading(true);
    try {
      const res = await axios.get("/admin/sessions");
      const arr = res?.data?.sessions || [];
      setSessions(arr);
    } catch (err) {
      console.error("loadSessions error", err);
      setSessions([]);
    } finally {
      setLoading(false);
    }
  }

  async function showSession(id) {
    if (!id) return;
    setLoading(true);
    setSelectedId(id);
    try {
      const res = await axios.get(`/admin/session/${id}`);
      // IMPORTANT: axios returns { data: { session, messages, logs, escalations } }
      const payload = res?.data || res;
      // defensive: ensure shape is right
      const safe = {
        session: payload.session || payload.data?.session || null,
        messages: payload.messages || payload.data?.messages || [],
        logs: payload.logs || payload.data?.logs || [],
        escalations: payload.escalations || payload.data?.escalations || []
      };
      setDetail(safe);
      setView("detail");
    } catch (err) {
      console.error("showSession error", err);
      setDetail(null);
    } finally {
      setLoading(false);
    }
  }

  async function generateSummary() {
    if (!selectedId) return;
    setLoading(true);
    try {
      await axios.post(`/session/${selectedId}/summary`, {});
      // reload session detail and sessions list
      await showSession(selectedId);
      await loadSessions();
    } catch (err) {
      console.error("generateSummary error", err);
      alert("Failed to generate summary (check backend).");
    } finally {
      setLoading(false);
    }
  }

  function handlePick() {
    if (!selectedId || !detail) return;
    const sum = detail.session?.summary || "";
    onPickSession(selectedId, sum);
  }

  return (
    <div className="p-3">
      {view === "list" && (
        <>
          <div className="flex items-center justify-between mb-2">
            <h3 className="text-lg font-semibold">Admin — Sessions</h3>
            <div className="flex gap-2">
              <button onClick={loadSessions} className="px-2 py-1 bg-gray-100 rounded">Refresh</button>
            </div>
          </div>

          <div className="border rounded grid grid-cols-1 gap-2 p-2">
            {loading && <div className="text-sm text-gray-500">Loading...</div>}
            {sessions.length === 0 && !loading && <div className="text-sm text-gray-500">No sessions yet.</div>}
            {sessions.map(s => (
              <div key={s.id} className="p-2 border-b hover:bg-gray-50 flex items-start justify-between">
                <div>
                  <div className="text-xs text-gray-600">{s.id.slice(0,8)}</div>
                  <div className="text-sm text-gray-800">{s.summary ? s.summary.slice(0,60) : "— no summary —"}</div>
                  <div className="text-xs text-gray-500">{s.last_active}</div>
                </div>
                <div className="flex flex-col gap-2">
                  <button className="px-2 py-1 text-sm bg-blue-600 text-white rounded" onClick={() => showSession(s.id)}>View</button>
                </div>
              </div>
            ))}
          </div>
        </>
      )}

      {view === "detail" && detail && (
        <div>
          <div className="flex items-center justify-between mb-3">
            <div>
              <div className="text-sm text-gray-600">Session</div>
              <div className="font-mono">{detail.session?.id}</div>
            </div>

            <div className="flex gap-2 items-center">
              <button onClick={() => setView("list")} className="px-2 py-1 bg-gray-100 rounded">Back</button>
              <button onClick={generateSummary} className="px-2 py-1 bg-indigo-600 text-white rounded">Generate Summary</button>
              <button onClick={handlePick} className="px-2 py-1 bg-green-600 text-white rounded">Use Session</button>
            </div>
          </div>

          <div className="mb-2">
            <strong>Summary:</strong>
            <div className="p-2 border rounded mt-1 bg-gray-50">{detail.session?.summary || "— none —"}</div>
          </div>

          <div className="grid grid-cols-1 gap-3">
            <div>
              <h4 className="text-sm font-semibold">Messages</h4>
              <div className="max-h-36 overflow-auto border p-2">
                {detail.messages.map(m => <div key={m.id}><strong>{m.role}</strong>: {m.content}</div>)}
              </div>
            </div>

            <div>
              <h4 className="text-sm font-semibold">Logs</h4>
              <div className="max-h-28 overflow-auto border p-2 text-xs text-gray-600">
                {detail.logs.map(l => <div key={l.id}>[{l.level}] {l.message} {l.meta ? `- ${l.meta}` : ''}</div>)}
              </div>
            </div>

            <div>
              <h4 className="text-sm font-semibold">Escalations</h4>
              <div className="max-h-28 overflow-auto border p-2 text-sm">
                {detail.escalations.length === 0 && <div>None</div>}
                {detail.escalations.map(e => <div key={e.id}><strong>{e.status}</strong>: {e.reason} — {e.notes}</div>)}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/**
 * Main App component
 */
export default function App() {
  const [sessionId, setSessionId] = useState("");
  const [showAdmin, setShowAdmin] = useState(false);
  const [sessionSummary, setSessionSummary] = useState("");

  async function createSession() {
    try {
      const res = await axios.post("/session", {});
      const id = res?.data?.session_id || res?.session_id || (res?.data && res.data.session && res.data.session.id);
      if (!id) throw new Error("No session id returned from backend");
      setSessionId(id);
      setSessionSummary("");
    } catch (err) {
      console.error("Create session failed", err);
      alert("Failed to create session. Make sure backend is running at http://localhost:4000");
    }
  }

  function closeSession() {
    setSessionId("");
    setSessionSummary("");
  }

  return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center p-6">
      <div className="w-full max-w-7xl bg-white rounded-lg shadow-lg p-6">
        <header className="flex items-center justify-between mb-4">
          <div>
            <h1 className="text-2xl font-bold">Unthinkable — AI Support Demo</h1>
            <p className="text-sm text-gray-500">Type a query, test escalation, generate summaries, inspect sessions.</p>
          </div>

          <div className="flex items-center gap-2">
            <button onClick={() => setShowAdmin(s => !s)} className="px-3 py-1 border rounded bg-gray-100 hover:bg-gray-200">
              {showAdmin ? "Close Admin" : "Open Admin"}
            </button>

            {sessionId ? (
              <button onClick={closeSession} className="px-3 py-1 bg-red-600 text-white rounded">Close Session</button>
            ) : (
              <button onClick={createSession} className="px-3 py-1 bg-green-600 text-white rounded">Create Session</button>
            )}
          </div>
        </header>

        <main className="grid grid-cols-1 md:grid-cols-3 gap-6">
          <section className="md:col-span-2">
            <div className="mb-3 flex items-center justify-between">
              <div>
                <div className="text-sm text-gray-600">Session</div>
                <div className="text-sm font-mono text-gray-800">{sessionId || "No session (click Create Session)"}</div>
              </div>
              <div className="text-right">
                <div className="text-sm text-gray-600">Summary</div>
                <div className="text-sm text-gray-800 max-w-xs">{sessionSummary || "— no summary yet —"}</div>
              </div>
            </div>

            <ChatWindow sessionId={sessionId} setSessionSummary={setSessionSummary} />
          </section>

          <aside className="md:col-span-1">
            <ErrorBoundary>
              {showAdmin ? (
                <div className="border rounded p-3 shadow-sm">
                  <AdminPanel onPickSession={(id, summary) => { setSessionId(id); setSessionSummary(summary || ""); setShowAdmin(false); }} />
                </div>
              ) : (
                <div className="border rounded p-3 text-center text-sm text-gray-500">
                  Admin panel hidden — click <strong>Open Admin</strong> to inspect sessions.
                </div>
              )}
            </ErrorBoundary>
          </aside>
        </main>
      </div>
    </div>
  );
}
