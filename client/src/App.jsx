import { useEffect, useMemo, useState } from "react";
import Fuse from "fuse.js";
import { api, AuthError, NetworkError, getCurrentProgram } from "./api.js";
import { enqueue, getQueue, drainQueue } from "./offlineQueue.js";
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
  const [pendingCount, setPendingCount] = useState(() => getQueue().length);

  function handleError(err) {
    if (err instanceof AuthError) {
      setAuthed(false);
    } else {
      setToast(err.message);
    }
  }

  // Replays anything queued while offline. Safe to call opportunistically
  // (mount, the 'online' event, every poll tick) — it's a no-op with an
  // empty queue, and stops at the first action that still can't reach the
  // server rather than erroring.
  async function attemptDrain() {
    const remaining = await drainQueue();
    setPendingCount((prev) => {
      if (remaining < prev) refresh().catch(() => {});
      return remaining;
    });
  }

  // Registered once (empty deps), so this closure's `refresh` always
  // resolves the program id via getCurrentProgram()'s live localStorage
  // read rather than the `state` this closure captured at mount — that's
  // what makes it safe to never re-subscribe as the event changes.
  useEffect(() => {
    window.addEventListener("online", attemptDrain);
    attemptDrain();
    return () => window.removeEventListener("online", attemptDrain);
  }, []);

  // Which event this refreshes is always explicit — never a shared
  // server-side "active" program. Falls back to whatever program this
  // device last had loaded (localStorage), so a reload picks up where
  // this device left off without touching any other device's event.
  async function refresh(programId = state?.programId ?? getCurrentProgram()?.id ?? null) {
    const s = await api.getState(programId);
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
      // The 'online' event isn't reliable on flaky Wi-Fi that never fully
      // drops the OS-level connection, so every poll tick also gets a
      // chance to drain anything still queued from an earlier failure.
      await attemptDrain();
      try {
        const s = await api.getState(state.programId);
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

  // Applies a mutation to the local person list immediately, without
  // waiting for the server — so a tap still shows up on this device's
  // screen even when the request behind it is offline and queued.
  function applyLocally(mutate) {
    setState((prev) => (prev ? mutate(prev) : prev));
  }

  // Only mutates the local list once a NetworkError confirms the request
  // never reached the server — applying it eagerly for every error would
  // leave the UI showing success for a genuine rejection too, uncorrected
  // until the next poll happens to run.
  async function handleCheckIn(id) {
    const programId = state.programId;
    try {
      await api.checkIn(id, programId);
      await refresh();
    } catch (err) {
      if (err instanceof NetworkError) {
        applyLocally((prev) => {
          const person = prev.people[id];
          if (!person) return prev;
          return { ...prev, people: { ...prev.people, [id]: { ...person, status: "checked-in", checkedInAt: new Date().toISOString() } } };
        });
        enqueue({ type: "checkin", personId: id, programId });
        setPendingCount(getQueue().length);
        setToast("Offline — check-in saved, will sync once back online");
      } else {
        handleError(err);
      }
    }
  }

  async function handleUndo(id) {
    const programId = state.programId;
    const person = state.people[id];
    try {
      await api.undoCheckIn(id, programId);
      await refresh();
    } catch (err) {
      if (err instanceof NetworkError) {
        applyLocally((prev) => {
          if (person?.source === "walkin") {
            const people = { ...prev.people };
            delete people[id];
            return { ...prev, people };
          }
          return { ...prev, people: { ...prev.people, [id]: { ...prev.people[id], status: "registered", checkedInAt: null } } };
        });
        enqueue({ type: "undo", personId: id, programId });
        setPendingCount(getQueue().length);
        setToast("Offline — undo saved, will sync once back online");
      } else {
        handleError(err);
      }
    }
  }

  // WalkInModal wraps this call in its own try/catch and stays open to show
  // a genuine rejection (e.g. a real duplicate) inline with the form intact
  // — so a non-network error must be rethrown, not swallowed here. Only a
  // NetworkError gets the optimistic-apply-and-queue treatment, since only
  // then do we know the request never reached the server to be rejected.
  async function handleWalkIn(form) {
    const programId = state.programId;
    try {
      await api.addWalkIn(form, programId);
      await refresh();
      setShowWalkIn(false);
      setToast(`${form.firstName || form.email} checked in`);
    } catch (err) {
      if (!(err instanceof NetworkError)) throw err;

      const key = `walkin:${form.email.trim().toLowerCase()}`;
      applyLocally((prev) => ({
        ...prev,
        people: {
          ...prev.people,
          [key]: {
            id: key,
            marketoId: null,
            firstName: form.firstName || "",
            lastName: form.lastName || "",
            email: form.email.trim(),
            company: form.company || "",
            title: "",
            source: "walkin",
            status: "checked-in",
            checkedInAt: new Date().toISOString(),
            synced: false,
            syncStatus: null,
          },
        },
      }));
      enqueue({ type: "walkin", person: form, programId });
      setPendingCount(getQueue().length);
      setShowWalkIn(false);
      setToast("Offline — check-in saved, will sync once back online");
    }
  }

  // Sync is never queued for later like check-ins/undos are — it's a
  // deliberate, one-time push to Marketo that a staff member watches the
  // result of, not something that should run silently once connectivity
  // happens to come back without anyone knowing whether it did.
  async function handleSyncConfirm() {
    setSyncing(true);
    try {
      const res = await api.sync(state.programId);
      setSyncResult(res.results);
      setState(res.state);
    } catch (err) {
      if (err instanceof NetworkError) {
        setToast("Can't sync while offline — check your connection and try again");
      } else {
        handleError(err);
      }
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
              {pendingCount > 0 && (
                <span className="badge badge--offline">
                  {pendingCount} pending offline
                </span>
              )}
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
