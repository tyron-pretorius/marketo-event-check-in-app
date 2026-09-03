import { useState } from "react";
import { api } from "../api.js";
import Wordmark from "./Wordmark.jsx";

export default function LoginScreen({ onSuccess }) {
  const [password, setPassword] = useState("");
  const [error, setError] = useState(null);
  const [submitting, setSubmitting] = useState(false);

  async function submit(e) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      await api.login(password);
      onSuccess();
    } catch (err) {
      setError(err.message);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="app" style={{ justifyContent: "center", alignItems: "center", padding: "var(--s-5)" }}>
      <div style={{ marginBottom: "var(--s-6)" }}>
        <Wordmark />
      </div>
      <form onSubmit={submit} style={{ width: "100%", maxWidth: 340 }}>
        <div className="field">
          <label>Password</label>
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoFocus
            autoComplete="current-password"
          />
        </div>
        {error && <div className="error-text">{error}</div>}
        <button type="submit" className="btn btn--primary btn--block" disabled={submitting} style={{ marginTop: "var(--s-3)" }}>
          {submitting ? "Checking…" : "Unlock"}
        </button>
      </form>
    </div>
  );
}
