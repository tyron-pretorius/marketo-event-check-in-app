import { useEffect, useMemo, useState } from "react";
import Fuse from "fuse.js";
import { api, AuthError } from "./api.js";
import PersonRow from "./components/PersonRow.jsx";
import WalkInModal from "./components/WalkInModal.jsx";
import SyncModal from "./components/SyncModal.jsx";
import EventPicker from "./components/EventPicker.jsx";
import LoginScreen from "./components/LoginScreen.jsx";
import Wordmark from "./components/Wordmark.jsx";

function useToast() {
  const [message, setMessage] = useState(null);
  useEffect(() => {
    if (!message) return;
    const t = setTimeout(() => setMessage(null), 3000);
    return () => clearTimeout(t);
  }, [message]);
  return [message, setMessage];
}

export default function App() {
  const [state, setState] = useState(null);
  const [tab, setTab] = useState("registered");
  const [query, setQuery] = useState("");
  const [pulling, setPulling] = useState(false);
  const [showWalkIn, setShowWalkIn] = useState(false);
  const [showSync, setShowSync] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [syncResult, setSyncResult] = useState(null);
  const [showPicker, setShowPicker] = useState(false);
  const [authed, setAuthed] = useState(null); // null = unknown yet, true/false once resolved
  const [toast, setToast] = useToast();

  function handleError(err) {
    if (err instanceof AuthError) {
      setAuthed(false);
    } else {
      setToast(err.message);
    }
  }

  async function refresh() {
    const s = await api.getState();
    setState(s);
    if (!s.programId) setShowPicker(true);
    return s;
  }

  useEffect(() => {
    api
      .authStatus()
      .then(({ required }) => {
        if (!required) {
          setAuthed(true);
          return refresh();
        }
        return refresh()
          .then(() => setAuthed(true))
          .catch((err) => {
            if (err instanceof AuthError) setAuthed(false);
            else throw err;
          });
      })
      .catch((err) => setToast(err.message));
  }, []);

  // Poll for changes made by other devices checking people in against the
  // same event, so nobody has to manually refresh to see teammates' work.
  useEffect(() => {
    if (!authed || showPicker || !state?.programId) return;

    let cancelled = false;
    const interval = setInterval(async () => {
      try {
        const s = await api.getState();
        if (!cancelled) setState(s);
      } catch (err) {
        if (!cancelled && err instanceof AuthError) setAuthed(false);
        // Otherwise silent — a transient poll failure isn't worth interrupting anyone.
      }
    }, 4000);

    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [authed, showPicker, state?.programId]);

  const people = useMemo(() => (state ? Object.values(state.people) : []), [state]);
  const registered = people.filter((p) => p.status === "registered");
  const checkedIn = people.filter((p) => p.status === "checked-in");
  const list = tab === "registered" ? registered : checkedIn;

  const fuse = useMemo(
    () =>
      new Fuse(list, {
        keys: ["firstName", "lastName", "email", "company"],
        threshold: 0.35,
        ignoreLocation: true,
      }),
    [list]
  );

  const filtered = query.trim() ? fuse.search(query).map((r) => r.item) : list;

  async function handlePull() {
    setPulling(true);
    try {
      const res = await api.pull(state?.programId, state?.programName);
      setState(res.state);
      setToast(`Pulled ${res.pulled} registrants from Marketo`);
    } catch (err) {
      handleError(err);
    } finally {
      setPulling(false);
    }
  }

  async function handleSelectEvent(program) {
    setPulling(true);
    try {
      const res = await api.pull(program.id, program.name);
      setState(res.state);
      setShowPicker(false);
      setToast(`Loaded "${program.name}" — pulled ${res.pulled} registrants`);
    } catch (err) {
      handleError(err);
    } finally {
      setPulling(false);
    }
  }

  async function handleCheckIn(id) {
    try {
      await api.checkIn(id);
      await refresh();
    } catch (err) {
      handleError(err);
    }
  }

  async function handleUndo(id) {
    try {
      await api.undoCheckIn(id);
      await refresh();
    } catch (err) {
      handleError(err);
    }
  }

  async function handleWalkIn(form) {
    await api.addWalkIn(form);
    await refresh();
    setShowWalkIn(false);
    setToast(`${form.firstName || form.email} checked in`);
  }

  async function handleSyncConfirm() {
    setSyncing(true);
    try {
      const res = await api.sync();
      setSyncResult(res.results);
      setState(res.state);
    } catch (err) {
      handleError(err);
      setShowSync(false);
    } finally {
      setSyncing(false);
    }
  }

  function closeSyncModal() {
    setShowSync(false);
    setSyncResult(null);
  }

  const noShowCandidates = registered.length;

  if (authed === null) {
    return <div className="app" />;
  }

  if (!authed) {
    return <LoginScreen onSuccess={() => { setAuthed(true); refresh().catch(handleError); }} />;
  }

  if (showPicker) {
    return (
      <>
        <EventPicker
          onSelect={handleSelectEvent}
          onCancel={state?.programId ? () => setShowPicker(false) : undefined}
        />
        {toast && <div className="toast">{toast}</div>}
      </>
    );
  }

  return (
    <div className="app">
      <header className="header">
        <div className="header__row">
          <Wordmark />
          <button
            className="header__event"
            style={{ background: "none", border: "none", textAlign: "left", padding: 0, cursor: "pointer" }}
            onClick={() => setShowPicker(true)}
          >
            <div className="header__event-name">
              {state?.programName || (state?.programId ? `Program ${state.programId}` : "No event loaded")}
            </div>
            <div className="header__event-sub">
              {state?.lastPulledAt
                ? `Last pulled ${new Date(state.lastPulledAt).toLocaleTimeString()} · tap to switch event`
                : "Tap to choose an event"}
            </div>
          </button>
        </div>
        <div className="header__actions">
          <button className="btn btn--secondary btn--sm" onClick={handlePull} disabled={pulling}>
            {pulling ? "Pulling…" : "⟳ Pull Registrants"}
          </button>
          <button className="btn btn--secondary btn--sm" onClick={() => setShowSync(true)}>
            ⇪ Sync to Marketo
          </button>
        </div>
      </header>

      <div className="search">
        <div className="search__input-wrap">
          <span className="search__icon">⌕</span>
          <input
            className="search__input"
            placeholder="Search by name, email, or company…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </div>
      </div>

      <div className="tabs">
        <button
          className={`tab ${tab === "registered" ? "tab--active" : ""}`}
          onClick={() => setTab("registered")}
        >
          Registered <span className="tab__count">{registered.length}</span>
        </button>
        <button
          className={`tab ${tab === "checked-in" ? "tab--active" : ""}`}
          onClick={() => setTab("checked-in")}
        >
          Checked-In <span className="tab__count">{checkedIn.length}</span>
        </button>
      </div>

      <div className="list">
        {filtered.length === 0 && (
          <div className="empty">
            {list.length === 0
              ? tab === "registered"
                ? "No registrants yet — pull from Marketo above, or check someone in as a walk-in."
                : "No one checked in yet."
              : "No matches found."}
          </div>
        )}
        {filtered.map((person) => (
          <PersonRow
            key={person.id}
            person={person}
            tab={tab}
            onCheckIn={handleCheckIn}
            onUndo={handleUndo}
          />
        ))}
      </div>

      <button className="fab" onClick={() => setShowWalkIn(true)} aria-label="Add walk-in">
        +
      </button>

      {showWalkIn && (
        <WalkInModal onClose={() => setShowWalkIn(false)} onSubmit={handleWalkIn} />
      )}

      {showSync && (
        <SyncModal
          counts={{ attended: checkedIn.length, noShow: noShowCandidates }}
          onClose={closeSyncModal}
          onConfirm={handleSyncConfirm}
          syncing={syncing}
          result={syncResult}
        />
      )}

      {toast && <div className="toast">{toast}</div>}
    </div>
  );
}
