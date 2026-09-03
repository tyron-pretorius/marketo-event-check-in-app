import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

// Each Marketo program gets its own state file, keyed by program id. There
// is deliberately no server-side "currently active program" concept —
// every request that reads or mutates state carries its own explicit
// programId, and each device remembers its own current event client-side
// (localStorage), the same way it remembers its own auth token. An earlier
// version of this file kept one shared "active.json" pointer instead, which
// caused two real incidents: (1) one device's check-in could silently land
// in whatever program another device had most recently switched to, and
// (2) a slow sync's own final save would re-assert its own program as
// "active," undoing another device's switch to a different event behind
// its back — so a device that had genuinely moved on to Event B could have
// its next sync silently apply to Event A instead. Per-request, explicit
// program ids make both structurally impossible: there is no shared
// pointer left for one device's action to disturb another's.

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.join(__dirname, "..", "data");
const EVENTS_DIR = path.join(DATA_DIR, "events");

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

// Loads a specific program's state by id. Every caller must know which
// program it means — there is no "whichever one is active" fallback.
export function loadEventState(programId) {
  if (!programId) return emptyEventState(null);
  ensureDirs();
  const file = eventFilePath(programId);
  if (!fs.existsSync(file)) return emptyEventState(programId);
  try {
    return JSON.parse(fs.readFileSync(file, "utf-8"));
  } catch {
    return emptyEventState(programId);
  }
}

// Saves a program's state to its own file. Never touches any other
// program's file, and there is nothing global left to update.
export function saveEventState(state) {
  if (!state.programId) throw new Error("Cannot save event state without a programId");
  ensureDirs();
  fs.writeFileSync(eventFilePath(state.programId), JSON.stringify(state, null, 2));
}

// Clears one specific program's check-in progress back to empty.
export function resetEventState(programId) {
  const fresh = emptyEventState(programId);
  if (programId) saveEventState(fresh);
  return fresh;
}
