import { api, NetworkError } from "./api.js";

// Holds check-in/undo/walk-in actions that couldn't reach the server —
// venue Wi-Fi drops are common enough at events that losing a tap
// shouldn't mean losing the check-in. Not used for /sync: that's a
// deliberate, one-time action a staff member watches the result of, not
// something to silently retry later without them knowing whether it ran.
const QUEUE_KEY = "wp-checkin-offline-queue";

function readQueue() {
  try {
    return JSON.parse(localStorage.getItem(QUEUE_KEY)) || [];
  } catch {
    return [];
  }
}

function writeQueue(queue) {
  localStorage.setItem(QUEUE_KEY, JSON.stringify(queue));
}

export function getQueue() {
  return readQueue();
}

export function enqueue(action) {
  const queue = readQueue();
  queue.push({ id: crypto.randomUUID(), createdAt: Date.now(), ...action });
  writeQueue(queue);
  return queue;
}

async function runAction(action) {
  try {
    if (action.type === "checkin") return await api.checkIn(action.personId, action.programId);
    if (action.type === "undo") return await api.undoCheckIn(action.personId, action.programId);
    if (action.type === "walkin") return await api.addWalkIn(action.person, action.programId);
  } catch (err) {
    // The first attempt may have actually reached the server before the
    // connection dropped, in which case replaying a walk-in just hits the
    // dedup check — that's confirmation it already succeeded, not a failure.
    if (action.type === "walkin" && err.message?.includes("already checked in")) return;
    throw err;
  }
}

// Replays queued actions in order, stopping at the first one that still
// can't reach the server (still offline) so later actions get their turn
// on the next attempt instead of firing out of order. A queued action
// rejected for a real reason (not a network failure) is dropped — nothing
// more replay can do, and leaving it would block everything behind it.
// Returns the number of actions still queued afterward.
export async function drainQueue() {
  let queue = readQueue();
  while (queue.length) {
    try {
      await runAction(queue[0]);
    } catch (err) {
      if (err instanceof NetworkError) return queue.length;
    }
    queue = queue.slice(1);
    writeQueue(queue);
  }
  return 0;
}
