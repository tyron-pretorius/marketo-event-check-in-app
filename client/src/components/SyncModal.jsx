export default function SyncModal({ counts, onClose, onConfirm, syncing, result }) {
  return (
    <div className="modal-backdrop" onClick={syncing ? undefined : onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h3>Sync back to Marketo</h3>
        {!result ? (
          <>
            <p className="sync-summary">
              <strong>{counts.attended}</strong> people will be marked <strong>Attended</strong> (checked-in
              registrants + walk-ins).
              <br />
              <strong>{counts.noShow}</strong> people will be marked <strong>No Show</strong> (registered but
              never checked in).
            </p>
            <p className="sync-summary">This updates Program Member status directly in Marketo. It can't be undone from this app.</p>
            <div className="modal__actions">
              <button className="btn btn--ghost" onClick={onClose} disabled={syncing}>
                Cancel
              </button>
              <button className="btn btn--primary" onClick={onConfirm} disabled={syncing}>
                {syncing ? "Syncing…" : "Confirm Sync"}
              </button>
            </div>
          </>
        ) : (
          <>
            <p className="sync-summary">
              ✅ <strong>{result.attended.length}</strong> marked Attended
              <br />
              🚫 <strong>{result.noShow.length}</strong> marked No Show
              {result.failed.length > 0 && (
                <>
                  <br />
                  ⚠️ <strong>{result.failed.length}</strong> failed to sync
                </>
              )}
            </p>
            <div className="modal__actions">
              <button className="btn btn--primary btn--block" onClick={onClose}>
                Done
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
