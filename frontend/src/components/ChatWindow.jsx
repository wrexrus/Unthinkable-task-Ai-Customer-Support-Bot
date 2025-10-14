import React, { useState, useEffect, useRef } from "react";
import axios from "../api/axios";

export default function ChatWindow({ sessionId, setSessionSummary }) {
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [nextActions, setNextActions] = useState(null); // null | { actions: [], reason: '' }
  const bottomRef = useRef(null);

  useEffect(() => {
    if (!sessionId) {
      setMessages([]);
      setNextActions(null);
      return;
    }
    fetchHistory();
    fetchSessionDetail();
    // eslint-disable-next-line
  }, [sessionId]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  async function fetchHistory() {
    try {
      const res = await axios.get(`/session/${sessionId}/history`);
      setMessages(res.data?.messages || res.messages || []);
    } catch (err) {
      console.error("fetchHistory", err);
      setError("Failed to load history");
    }
  }

  async function fetchSessionDetail() {
    try {
      const adminRes = await axios.get(`/admin/session/${sessionId}`);
      const summary = adminRes?.data?.session?.summary || adminRes?.session?.summary || "";
      setSessionSummary(summary);
    } catch (err) {
      // optional: quietly ignore if admin endpoint not available
    }
  }

  async function sendMessage() {
    if (!input.trim()) return;
    if (!sessionId) {
      setError("Create a session first.");
      return;
    }

    const userText = input.trim();
    setInput("");
    setError("");
    setLoading(true);
    setNextActions(null); // clear previous suggestions

    // optimistic UI add
    setMessages(prev => [...prev, { id: `u-${Date.now()}`, role: "user", content: userText }]);

    try {
      const res = await axios.post(`/session/${sessionId}/message`, { text: userText });
      const assistantText = (res.data && res.data.text) || res.text || res.data || "";
      setMessages(prev => [...prev, { id: `a-${Date.now()}`, role: "assistant", content: assistantText }]);
      await fetchSessionDetail();
    } catch (err) {
      console.error("sendMessage", err);
      setError(err?.response?.data?.error?.message || err.message || "Send failed");
      setMessages(prev => [...prev, { id: `a-err-${Date.now()}`, role: "assistant", content: "Sorry — there was an error sending your message." }]);
    } finally {
      setLoading(false);
    }
  }

  async function generateSummary() {
    if (!sessionId) return;
    try {
      setLoading(true);
      const res = await axios.post(`/session/${sessionId}/summary`, {});
      const sum = res.data?.summary || res.summary || res?.data;
      setSessionSummary(sum || "");
      // optionally refresh history
      fetchHistory();
    } catch (err) {
      console.error("generateSummary", err);
      setError("Failed to generate summary");
    } finally {
      setLoading(false);
    }
  }

  async function fetchNextActions() {
    if (!sessionId) return;
    try {
      setLoading(true);
      setError("");
      setNextActions(null);
      const res = await axios.post(`/session/${sessionId}/next_actions`, {});
      // Accept both shapes: res.data.actions or res.actions or res.data
      let payload = res?.data || res;
      // payload.actions should be array or single string
      const rawActions = payload.actions ?? payload.action ?? payload;
      let actions = [];

      if (Array.isArray(rawActions)) {
        actions = rawActions.filter(Boolean).map(a => String(a).trim());
      } else if (typeof rawActions === "string") {
        // If single string possibly containing newlines or bullets, split to lines but keep as single if short
        const lines = rawActions.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
        // If there are multiple reasonable lines, treat as list; else keep as single
        if (lines.length > 1) actions = lines;
        else actions = [rawActions.trim()];
      } else {
        // fallback: try to stringify
        const s = JSON.stringify(rawActions);
        actions = [s.slice(0, 500)];
      }

      // keep at most 6
      if (actions.length > 6) actions = actions.slice(0, 6);

      setNextActions({ actions, reason: payload.reason || payload?.data?.reason || "unknown" });
    } catch (err) {
      console.error("fetchNextActions", err);
      setError(err?.response?.data?.error?.message || err.message || "Failed to get next actions");
    } finally {
      setLoading(false);
    }
  }

  function renderNextActions() {
    if (!nextActions) return null;
    const { actions } = nextActions;
    if (!actions || actions.length === 0) return null;

    return (
      <div className="mt-3 p-3 bg-white border rounded shadow-sm">
        <div className="flex items-center justify-between mb-2">
          <strong className="text-sm">Suggested Next Action{actions.length > 1 ? "s" : ""}</strong>
          <div className="text-xs text-gray-500">source: {nextActions.reason}</div>
        </div>

        {actions.length === 1 ? (
          <div className="p-3 bg-yellow-50 rounded text-sm text-gray-800">{actions[0]}</div>
        ) : (
          <ol className="list-decimal list-inside space-y-1 text-sm">
            {actions.map((a, i) => <li key={i} className="text-gray-800">{a}</li>)}
          </ol>
        )}

        <div className="mt-3 flex gap-2">
          <button
            onClick={() => navigator.clipboard?.writeText(actions.join("\n")).catch(()=>{})}
            className="px-3 py-1 bg-gray-100 rounded text-sm"
          >
            Copy
          </button>
          <button
            onClick={() => setNextActions(null)}
            className="px-3 py-1 bg-red-100 text-red-700 rounded text-sm"
          >
            Close
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-[560px] border rounded-lg overflow-hidden">
      <div className="flex-1 p-4 overflow-y-auto bg-gray-50">
        <div className="flex flex-col gap-3">
          {messages.map((m, idx) => (
            <div
              key={m.id || idx}
              className={`max-w-3/4 px-3 py-2 rounded-xl ${m.role === "assistant" ? "bg-blue-50 self-start text-blue-900" : "bg-green-100 self-end text-gray-900"} `}
              style={{ alignSelf: m.role === "assistant" ? "flex-start" : "flex-end" }}
            >
              <div className="text-sm whitespace-pre-wrap">{m.content}</div>
            </div>
          ))}
          <div ref={bottomRef} />
        </div>
      </div>

      <div className="p-3 border-t bg-white flex items-center gap-3">
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && sendMessage()}
          placeholder={sessionId ? "Type your question..." : "Create or pick a session first"}
          className="flex-1 border rounded px-3 py-2"
          disabled={!sessionId || loading}
        />
        <button onClick={sendMessage} className="px-4 py-2 bg-blue-600 text-white rounded" disabled={!sessionId || loading}>
          Send
        </button>
        <button onClick={generateSummary} className="px-3 py-2 bg-indigo-600 text-white rounded" disabled={!sessionId || loading}>
          Generate Summary
        </button>
        <button onClick={fetchNextActions} className="px-3 py-2 bg-amber-600 text-white rounded" disabled={!sessionId || loading}>
          Next Actions
        </button>
      </div>

      {error && <div className="p-2 text-sm text-red-600">{error}</div>}

      <div className="p-3 bg-gray-50 border-t">
        {renderNextActions()}
      </div>
    </div>
  );
}
