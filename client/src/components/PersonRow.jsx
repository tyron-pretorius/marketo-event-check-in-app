function initials(person) {
  const a = (person.firstName || "?")[0] || "";
  const b = (person.lastName || "")[0] || "";
  return (a + b).toUpperCase();
}

function formatTime(iso) {
  if (!iso) return "";
  return new Date(iso).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
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
