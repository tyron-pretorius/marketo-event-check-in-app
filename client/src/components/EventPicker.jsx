import { useEffect, useMemo, useState } from "react";
import Fuse from "fuse.js";
import { api } from "../api.js";
import Wordmark from "./Wordmark.jsx";

export default function EventPicker({ onSelect, onCancel }) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [folder, setFolder] = useState(null);
  const [programs, setPrograms] = useState([]);
  const [query, setQuery] = useState("");
  const [manualId, setManualId] = useState("");

  async function load(refresh) {
    setLoading(true);
    setError(null);
    try {
      const data = await api.getLatestEventFolder(refresh);
      setFolder(data.folder);
      setPrograms(data.programs);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load(false);
  }, []);

  const fuse = useMemo(
    () => new Fuse(programs, { keys: ["name"], threshold: 0.35, ignoreLocation: true }),
    [programs]
  );

  const filtered = query.trim() ? fuse.search(query).map((r) => r.item) : programs;

  function submitManualId(e) {
    e.preventDefault();
    if (!manualId.trim()) return;
    onSelect({ id: manualId.trim(), name: `Program ${manualId.trim()}` });
  }

  return (
    <div className="app">
      <header className="header">
        <div className="header__row">
          <Wordmark />
          <div className="header__event">
            <div className="header__event-name">Choose an event</div>
            <div className="header__event-sub">
              {folder ? folder.name : loading ? "Loading events…" : ""}
            </div>
          </div>
        </div>
        <div className="header__actions">
          <button className="btn btn--secondary btn--sm" onClick={() => load(true)} disabled={loading}>
            ⟳ Refresh
          </button>
          {onCancel && (
            <button className="btn btn--ghost btn--sm" onClick={onCancel}>
              Cancel
            </button>
          )}
        </div>
      </header>

      {!error && (
        <div className="search">
          <div className="search__input-wrap">
            <span className="search__icon">⌕</span>
            <input
              className="search__input"
              placeholder="Search event programs…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              autoFocus
            />
          </div>
        </div>
      )}

      <div className="list">
        {loading && <div className="empty">Loading events from Marketo…</div>}

        {error && (
          <>
            <div className="empty">
              Couldn't auto-discover events: {error}
              <br />
              You can still load an event directly by its Marketo Program Id.
            </div>
            <form onSubmit={submitManualId} className="field" style={{ padding: "0 var(--s-4)" }}>
              <label>Marketo Program Id</label>
              <input
                value={manualId}
                onChange={(e) => setManualId(e.target.value)}
                placeholder="e.g. 2086"
                inputMode="numeric"
              />
              <button type="submit" className="btn btn--primary btn--block" style={{ marginTop: "var(--s-3)" }}>
                Load Program
              </button>
            </form>
          </>
        )}

        {!loading && !error && filtered.length === 0 && (
          <div className="empty">No matching programs in {folder?.name}.</div>
        )}
        {!loading &&
          !error &&
          filtered.map((program) => (
            <button
              key={program.id}
              className="person"
              style={{ width: "100%", textAlign: "left", border: "1px solid var(--line)", cursor: "pointer" }}
              onClick={() => onSelect(program)}
            >
              <div className="person__avatar">{program.name.slice(0, 2).toUpperCase()}</div>
              <div className="person__info">
                <div className="person__name">{program.name}</div>
                <div className="person__meta">Program {program.id}</div>
              </div>
            </button>
          ))}
      </div>
    </div>
  );
}
