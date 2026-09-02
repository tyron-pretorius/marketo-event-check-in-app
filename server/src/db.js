import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.join(__dirname, "..", "data");
const DATA_FILE = path.join(DATA_DIR, "event-state.json");

function emptyState() {
  return {
    programId: null,
    programName: null,
    lastPulledAt: null,
    lastSyncedAt: null,
    // people keyed by a stable id: Marketo lead id for known leads,
    // or "walkin:<lowercased email>" for walk-ins without a Marketo match yet.
    people: {},
  };
}

function ensureDataFile() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  if (!fs.existsSync(DATA_FILE)) {
    fs.writeFileSync(DATA_FILE, JSON.stringify(emptyState(), null, 2));
  }
}

export function loadState() {
  ensureDataFile();
  const raw = fs.readFileSync(DATA_FILE, "utf-8");
  try {
    return JSON.parse(raw);
  } catch {
    return emptyState();
  }
}

export function saveState(state) {
  ensureDataFile();
  fs.writeFileSync(DATA_FILE, JSON.stringify(state, null, 2));
}

export function resetState() {
  const fresh = emptyState();
  saveState(fresh);
  return fresh;
}
