import { useState } from "react";
import ChatWindow from "./components/ChatWindow";
import AdminPanel from "./components/AdminPanel";

function App() {
  const [sessionId, setSessionId] = useState("");

  const createSession = async () => {
    const res = await fetch("http://localhost:4000/api/session", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });
    const data = await res.json();
    setSessionId(data.session_id);
  };

  return (
    <div className="p-4 h-screen flex flex-col gap-4">
      <div>
        <button className="bg-green-600 text-white px-3 py-1 rounded" onClick={createSession}>
          {sessionId ? "Session Created" : "Create Session"}
        </button>
        {sessionId && <span className="ml-2 text-gray-700">Session ID: {sessionId}</span>}
      </div>
      {sessionId && <ChatWindow sessionId={sessionId} />}
      <hr className="my-4" />
      <AdminPanel />
    </div>
  );
}

export default App;
