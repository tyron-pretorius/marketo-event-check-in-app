import { useState } from "react";

export default function WalkInModal({ onClose, onSubmit }) {
  const [form, setForm] = useState({ firstName: "", lastName: "", email: "", company: "" });
  const [error, setError] = useState(null);
  const [saving, setSaving] = useState(false);

  function update(field) {
    return (e) => setForm((f) => ({ ...f, [field]: e.target.value }));
  }

  async function submit(e) {
    e.preventDefault();
    setError(null);
    if (!form.email.trim()) {
      setError("Email is required.");
      return;
    }
    setSaving(true);
    try {
      await onSubmit(form);
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h3>Check in a walk-in</h3>
        <form onSubmit={submit}>
          <div className="field">
            <label>First name</label>
            <input value={form.firstName} onChange={update("firstName")} autoFocus />
          </div>
          <div className="field">
            <label>Last name</label>
            <input value={form.lastName} onChange={update("lastName")} />
          </div>
          <div className="field">
            <label>Email *</label>
            <input type="email" value={form.email} onChange={update("email")} required />
          </div>
          <div className="field">
            <label>Company</label>
            <input value={form.company} onChange={update("company")} />
          </div>
          {error && <div className="error-text">{error}</div>}
          <div className="modal__actions">
            <button type="button" className="btn btn--ghost" onClick={onClose}>
              Cancel
            </button>
            <button type="submit" className="btn btn--primary" disabled={saving}>
              {saving ? "Checking in…" : "Check In"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
