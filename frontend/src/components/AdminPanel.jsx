import { useState, useEffect } from "react";
import axios from "../api/axios";

export default function AdminPanel() {
  const [sessions, setSessions] = useState([]);

  useEffect(() => {
    axios.get("/admin/sessions").then(res => setSessions(res.data.sessions));
  }, []);

  return (
    <div className="p-4">
      <h1 className="text-xl font-bold mb-2">Admin Sessions</h1>
      <table className="w-full border">
        <thead>
          <tr className="bg-gray-200">
            <th className="border px-2 py-1">ID</th>
            <th className="border px-2 py-1">User</th>
            <th className="border px-2 py-1">Last Active</th>
            <th className="border px-2 py-1">Summary</th>
          </tr>
        </thead>
        <tbody>
          {sessions.map(s => (
            <tr key={s.id}>
              <td className="border px-2 py-1">{s.id}</td>
              <td className="border px-2 py-1">{s.user_id || "-"}</td>
              <td className="border px-2 py-1">{s.last_active}</td>
              <td className="border px-2 py-1">{s.summary || "-"}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
