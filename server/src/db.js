import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

// Each Marketo program gets its own state file, keyed by program id. This
// is the whole fix for a real bug: if all events shared one flat "people"
// list, switching from Event A to Event B while A's attendees were still
// sitting in there — then hitting Sync — would mark A's people Attended
// on B's program (and add them to B's membership in the process). Per-
// program files make that structurally impossible: an id only ever
// exists in the file for the event it was pulled into.
//
// A small "active.json" pointer tracks which program the app is
// currently looking at, so switching back to a previously-loaded event
// picks its check-in progress back up instead of starting over.

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.join(__dirname, "..", "data");
const EVENTS_DIR = path.join(DATA_DIR, "events");
const ACTIVE_FILE = path.join(DATA_DIR, "active.json");

function ensureDirs() {
  if (!fs.existsSync(EVENTS_DIR)) fs.mkdirSync(EVENTS_DIR, { recursive: true });
}

function eventFilePath(programId) {
  // Program ids are always numeric-ish strings from Marketo or a manual
  // entry; strip anything that isn't safe in a filename just in case.
  const safe = String(programId).replace(/[^a-zA-Z0-9_-]/g, "_");
  return path.join(EVENTS_DIR, `${safe}.json`);
}

function emptyEventState(programId) {
  return {
    programId: programId ? String(programId) : null,
    programName: null,
    lastPulledAt: null,
    lastSyncedAt: null,
    // people keyed by a stable id: Marketo lead id for known leads, or
    // "walkin:<lowercased email>" for walk-ins without a Marketo match
    // yet. Scoped to this one program's file — never shared across events.
    people: {},
  };
}

// Exported so routes can compute the right lock key (see lock.js) before
// entering a load-mutate-save critical section, without needing to load
// the full state first.
export function getActiveProgramId() {
  try {
    const raw = fs.readFileSync(ACTIVE_FILE, "utf-8");
    return JSON.parse(raw).programId || null;
  } catch {
    return null;
  }
}

function writeActiveProgramId(programId) {
  ensureDirs();
  fs.writeFileSync(ACTIVE_FILE, JSON.stringify({ programId: programId ? String(programId) : null }, null, 2));
}

// Loads a specific program's state by id — used when switching to (or
// back to) an event, so its own persisted check-in progress comes with
// it rather than whatever was previously active.
export function loadEventState(programId) {
  ensureDirs();
  const file = eventFilePath(programId);
  if (!fs.existsSync(file)) return emptyEventState(programId);
  try {
    return JSON.parse(fs.readFileSync(file, "utf-8"));
  } catch {
    return emptyEventState(programId);
  }
}

// Saves a program's state to its own file and marks it as the active
// event — every other action (check-in, sync, etc.) operates on whatever
// is currently active.
export function saveEventState(state) {
  if (!state.programId) throw new Error("Cannot save event state without a programId");
  ensureDirs();
  fs.writeFileSync(eventFilePath(state.programId), JSON.stringify(state, null, 2));
  writeActiveProgramId(state.programId);
}

// The "current screen" state: whichever program is active, or an empty
// no-program shell if none has been loaded yet this session.
export function loadState() {
  const activeId = getActiveProgramId();
  if (!activeId) return emptyEventState(null);
  return loadEventState(activeId);
}

// Saves back to the active program's own file — safe to call from any
// route that already has a loaded state object, since it always carries
// its own programId.
export function saveState(state) {
  saveEventState(state);
}

// Clears the active program's own check-in progress (not other events'
// files, and not which program is active).
export function resetState() {
  const activeId = getActiveProgramId();
  const fresh = emptyEventState(activeId);
  if (activeId) saveEventState(fresh);
  return fresh;
}
