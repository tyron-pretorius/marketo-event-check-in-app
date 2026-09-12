function initials(person) {
  const a = (person.firstName || "?")[0] || "";
  const b = (person.lastName || "")[0] || "";
  return (a + b).toUpperCase();
}

function formatTime(iso) {
  if (!iso) return "";
  return new Date(iso).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
}

// syncStatus is null until a sync touches this person, "Attended"/"No Show"
// once it succeeds, or "error: <message>" if Marketo rejected it — the only
// place that reason is available, since the sync modal only ever showed a
// count and forgot it the moment you closed the modal.
function SyncStatusBadge({ syncStatus }) {
  if (!syncStatus) return null;

  if (syncStatus.startsWith("error:")) {
    const message = syncStatus.slice("error:".length).trim();
    return (
      <button type="button" className="badge badge--sync-error" onClick={() => window.alert(message)}>
        Error
      </button>
    );
  }

  // Usually "Attended" or "No Show", but MARKETO_ATTENDED_STATUS /
  // MARKETO_NO_SHOW_STATUS can be customized per org's channel setup, so
  // this renders whatever the server actually recorded rather than
  // assuming — only the two defaults get their own color; anything else
  // still shows the real value instead of being hidden.
  if (syncStatus === "Attended") return <span className="badge badge--attended">Attended</span>;
  if (syncStatus === "No Show") return <span className="badge badge--no-show">No Show</span>;
  return <span className="badge badge--attended">{syncStatus}</span>;
}

export default function PersonRow({ person, tab, onCheckIn, onUndo }) {
  const name = `${person.firstName || ""} ${person.lastName || ""}`.trim() || person.email;

  return (
    <div className="person">
      <div className="person__avatar">{initials(person)}</div>
      <div className="person__info">
        <div className="person__name">
          <span>{name}</span>
          {tab === "checked-in" && (
            <span className={`badge badge--${person.source === "walkin" ? "unregistered" : "registered"}`}>
              {person.source === "walkin" ? "Unregistered" : "Registered"}
            </span>
          )}
        </div>
        <div className="person__meta">
          {[person.company, person.email].filter(Boolean).join(" · ")}
        </div>
        {tab === "checked-in" && person.checkedInAt && (
          <div className="person__time">Checked in {formatTime(person.checkedInAt)}</div>
        )}
      </div>
      <div className="person__actions">
        <SyncStatusBadge syncStatus={person.syncStatus} />
        {tab === "registered" ? (
          <button className="btn btn--primary btn--sm" onClick={() => onCheckIn(person.id)}>
            Check In
          </button>
        ) : (
          <button className="btn btn--ghost btn--sm" onClick={() => onUndo(person.id)}>
            Undo
          </button>
        )}
      </div>
    </div>
  );
}
