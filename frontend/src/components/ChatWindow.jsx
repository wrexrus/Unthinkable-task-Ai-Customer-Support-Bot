import { useState, useEffect } from "react";
import axios from "../api/axios";

export default function ChatWindow({ sessionId }) {
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!sessionId) return;
    axios.get(`/session/${sessionId}/history`).then(res => setMessages(res.data.messages));
  }, [sessionId]);

  const sendMessage = async () => {
    if (!input.trim()) return;
    const text = input;
    setInput("");
    setLoading(true);

    try {
      const res = await axios.post(`/session/${sessionId}/message`, { text });
      const newMsg = { role: "assistant", content: res.data.text, id: Date.now() };
      setMessages(prev => [...prev, { role: "user", content: text, id: Date.now() }, newMsg]);
    } catch (err) {
      console.error(err);
      alert("Failed to send message");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex flex-col h-full border p-2 rounded shadow-md bg-white">
      <div className="flex-1 overflow-y-auto mb-2">
        {messages.map(msg => (
          <div key={msg.id} className={`mb-2 ${msg.role === "assistant" ? "text-blue-700" : "text-gray-800"}`}>
            <strong>{msg.role}:</strong> {msg.content}
          </div>
        ))}
      </div>
      <div className="flex gap-2">
        <input
          type="text"
          className="flex-1 border rounded px-2 py-1"
          value={input}
          onChange={e => setInput(e.target.value)}
          disabled={loading}
        />
        <button className="bg-blue-600 text-white px-3 rounded" onClick={sendMessage} disabled={loading}>
          Send
        </button>
      </div>
    </div>
  );
}
