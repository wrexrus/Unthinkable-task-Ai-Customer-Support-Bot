// src/components/ChatWindow.jsx
import React, { useState, useEffect, useRef } from "react";
import axios from "../api/axios";

export default function ChatWindow({ sessionId, setSessionSummary }) {
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const bottomRef = useRef(null);

  useEffect(() => {
    if (!sessionId) {
      setMessages([]);
      return;
    }
    fetchHistory();
    // fetch summary too
    fetchSessionDetail();
    // eslint-disable-next-line
  }, [sessionId]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  async function fetchHistory() {
    try {
      const res = await axios.get(`/session/${sessionId}/history`);
      setMessages(res.messages || []);
    } catch (err) {
      console.error("fetchHistory", err);
      setError("Failed to load history");
    }
  }

  async function fetchSessionDetail() {
    try {
      const adminRes = await axios.get(`/admin/session/${sessionId}`);
      if (adminRes && adminRes.session) {
        setSessionSummary(adminRes.session.summary || "");
      }
    } catch (err) {
      // ignore if admin endpoint not reachable
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
    // optimistic UI
    setMessages(prev => [...prev, { id: `u-${Date.now()}`, role: "user", content: userText }]);

    try {
      const res = await axios.post(`/session/${sessionId}/message`, { text: userText });
      // assistant text comes in res.text
      const assistantText = res.text || (res?.data?.text) || res?.data;
      setMessages(prev => [...prev, { id: `a-${Date.now()}`, role: "assistant", content: assistantText }]);
      // update summary display if backend has stored it
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
      const sum = res.summary || res?.data?.summary;
      setSessionSummary(sum || "");
      // refresh logs/messages
      fetchHistory();
    } catch (err) {
      console.error("generateSummary", err);
      setError("Failed to generate summary");
    } finally {
      setLoading(false);
    }
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
              <div className="text-sm">{m.content}</div>
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
      </div>

      {error && <div className="p-2 text-sm text-red-600">{error}</div>}
    </div>
  );
}
