import express from "express";
import { loadEventState, saveEventState, resetEventState } from "../db.js";
import * as marketo from "../marketo.js";
import { getLatestEventPrograms } from "../eventFolders.js";
import { withLock } from "../lock.js";

// Every route below that reads or mutates an event's state takes an
// explicit programId from the request — never a shared "currently active
// program." There is no such thing as a server-wide active event: each
// device tracks its own current program client-side (localStorage) and
// sends it on every request, the same way it sends its own auth token.
//
// An earlier version resolved a single shared "active.json" pointer
// instead, which caused two real incidents: one device's check-in could
// silently land in whatever program another device had most recently
// switched to, and a slow sync's own final save would re-assert its own
// program as "active," undoing another device's switch to a different
// event behind its back. Explicit, per-request program ids make both
// structurally impossible — there's no shared pointer left to disturb.
//
// The lock in withLock is keyed by that same programId, so two requests
// for the *same* event still serialize (see lock.js), while requests for
// different events never block each other.

export const router = express.Router();

function timestamp() {
  return new Date().toISOString();
}

function requireProgramId(req, res) {
  const programId = req.body?.programId || req.query?.programId;
  if (!programId) {
    res.status(400).json({ error: "programId is required" });
    return null;
  }
  return String(programId);
}

// ---------- Health / config ----------

router.get("/health", async (req, res) => {
  try {
    await marketo.testConnection();
    res.json({
      ok: true,
      marketoConnected: true,
      programId: marketo.getDefaultProgramId(),
    });
  } catch (err) {
    res.json({ ok: false, marketoConnected: false, error: err.message });
  }
});

// ---------- State ----------

router.get("/state", (req, res) => {
  const programId = req.query?.programId;
  res.json(loadEventState(programId || null));
});

router.post("/state/reset", async (req, res) => {
  const programId = requireProgramId(req, res);
  if (!programId) return;

  const result = await withLock(`event:${programId}`, () => resetEventState(programId));
  res.json(result);
});

// ---------- Event folder / program picker ----------

router.get("/event-folders/latest", async (req, res) => {
  try {
    const data = await getLatestEventPrograms({ skipCache: req.query.refresh === "1" });
    res.json(data);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// ---------- Pull registrants from Marketo ----------

router.post("/pull", async (req, res) => {
  try {
    const programId = req.body?.programId || marketo.getDefaultProgramId();
    if (!programId) return res.status(400).json({ error: "programId is required" });

    const result = await withLock(`event:${programId}`, async () => {
      const members = await marketo.getProgramMembers(programId);

      // Load this specific program's own file — never whatever another
      // device might be looking at — so switching events never carries
      // another event's people (registered or checked-in) along with it.
      const state = loadEventState(programId);
      state.programId = String(programId);
      if (req.body?.programName) state.programName = req.body.programName;
      state.lastPulledAt = timestamp();

      const registeredIds = new Set(members.map((m) => String(m.id)));

      for (const m of members) {
        const key = String(m.id);
        const existing = state.people[key];
        if (existing) {
          // Refresh contact details but keep local check-in progress intact.
          Object.assign(existing, {
            firstName: m.firstName,
            lastName: m.lastName,
            email: m.email,
            company: m.company,
            title: m.title,
            marketoId: m.id,
          });
        } else {
          state.people[key] = {
            id: key,
            marketoId: m.id,
            firstName: m.firstName || "",
            lastName: m.lastName || "",
            email: m.email || "",
            company: m.company || "",
            title: m.title || "",
            source: "registered",
            status: "registered",
            checkedInAt: null,
            synced: false,
            syncStatus: null,
          };
        }
      }

      // Drop anyone who's no longer Registered in Marketo — but only if
      // they haven't been checked in yet. A checked-in person stays put
      // regardless of what Marketo now says, so a real check-in that
      // already happened is never silently erased from the list.
      for (const [key, person] of Object.entries(state.people)) {
        if (person.source === "registered" && person.status === "registered" && !registeredIds.has(key)) {
          delete state.people[key];
        }
      }

      saveEventState(state);
      return { pulled: members.length, state };
    });

    res.json(result);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// ---------- Check-in actions ----------

router.post("/checkin/:id", async (req, res) => {
  const programId = requireProgramId(req, res);
  if (!programId) return;

  const result = await withLock(`event:${programId}`, () => {
    const state = loadEventState(programId);
    const person = state.people[req.params.id];
    if (!person) return { status: 404, body: { error: "Person not found" } };

    person.status = "checked-in";
    person.checkedInAt = timestamp();
    saveEventState(state);
    return { status: 200, body: person };
  });
  res.status(result.status).json(result.body);
});

router.post("/checkin/:id/undo", async (req, res) => {
  const programId = requireProgramId(req, res);
  if (!programId) return;

  const result = await withLock(`event:${programId}`, () => {
    const state = loadEventState(programId);
    const person = state.people[req.params.id];
    if (!person) return { status: 404, body: { error: "Person not found" } };

    if (person.source === "walkin") {
      // Walk-ins have no registration to fall back to — undo removes them.
      delete state.people[req.params.id];
      saveEventState(state);
      return { status: 200, body: { removed: true } };
    }

    person.status = "registered";
    person.checkedInAt = null;
    saveEventState(state);
    return { status: 200, body: person };
  });
  res.status(result.status).json(result.body);
});

// ---------- Walk-in (unregistered) check-in ----------

router.post("/walkin", async (req, res) => {
  const programId = requireProgramId(req, res);
  if (!programId) return;

  const { firstName = "", lastName = "", email = "", company = "" } = req.body || {};
  if (!email) return res.status(400).json({ error: "Email is required for walk-ins" });

  const result = await withLock(`event:${programId}`, () => {
    const state = loadEventState(programId);
    const key = `walkin:${email.trim().toLowerCase()}`;

    if (state.people[key]) {
      return { status: 409, body: { error: "This person is already checked in" } };
    }

    const person = {
      id: key,
      marketoId: null,
      firstName,
      lastName,
      email: email.trim(),
      company,
      title: "",
      source: "walkin",
      status: "checked-in",
      checkedInAt: timestamp(),
      synced: false,
      syncStatus: null,
    };

    state.people[key] = person;
    saveEventState(state);
    return { status: 200, body: person };
  });

  res.status(result.status).json(result.body);
});

// ---------- Post-event sync back to Marketo ----------
// Checked-in registrants + walk-ins -> "Attended"
// Still-registered (never checked in) -> "No Show"

router.post("/sync", async (req, res) => {
  const programId = requireProgramId(req, res);
  if (!programId) return;

  // The whole operation — including every Marketo call it awaits — runs
  // inside the lock, keyed by the explicit programId this request named.
  // Sync used to load whatever the server considered "active" once, spend
  // several awaits talking to Marketo, then save that now-stale copy at
  // the end — during which another device could switch the shared
  // pointer to a different event, and sync's own final save would flip
  // it right back, silently sending that device's next sync to the wrong
  // program. There is no shared pointer left for this to happen to.
  const result = await withLock(`event:${programId}`, async () => {
    const state = loadEventState(programId);

    const attendedStatus = process.env.MARKETO_ATTENDED_STATUS || "Attended";
    const noShowStatus = process.env.MARKETO_NO_SHOW_STATUS || "No Show";

    const people = Object.values(state.people);
    const results = { attended: [], noShow: [], failed: [] };

    try {
      // 1. Resolve walk-ins to real Marketo lead ids (create if needed).
      const walkins = people.filter((p) => p.source === "walkin" && !p.marketoId);
      for (const person of walkins) {
        try {
          let leadId;
          const existingLead = await marketo.findLeadByEmail(person.email);
          if (existingLead) {
            leadId = existingLead.id;
          } else {
            leadId = await marketo.createOrUpdateLead(person);
          }
          // Re-key the person from "walkin:email" to their real Marketo id.
          delete state.people[person.id];
          person.id = String(leadId);
          person.marketoId = leadId;
          state.people[person.id] = person;
        } catch (err) {
          person.syncStatus = `error: ${err.message}`;
          results.failed.push({ email: person.email, error: err.message });
        }
      }

      const attendedIds = Object.values(state.people)
        .filter((p) => p.status === "checked-in" && p.marketoId && !p.syncStatus?.startsWith("error"))
        .map((p) => p.marketoId);

      const noShowIds = Object.values(state.people)
        .filter((p) => p.status === "registered" && p.source === "registered" && p.marketoId)
        .map((p) => p.marketoId);

      if (attendedIds.length) {
        await marketo.changeProgramStatus(programId, attendedIds, attendedStatus);
      }
      if (noShowIds.length) {
        await marketo.changeProgramStatus(programId, noShowIds, noShowStatus);
      }

      for (const person of Object.values(state.people)) {
        if (attendedIds.includes(person.marketoId)) {
          person.synced = true;
          person.syncStatus = attendedStatus;
          results.attended.push(person.email);
        } else if (noShowIds.includes(person.marketoId)) {
          person.synced = true;
          person.syncStatus = noShowStatus;
          results.noShow.push(person.email);
        }
      }

      state.lastSyncedAt = timestamp();
      saveEventState(state);
      return { status: 200, body: { results, state } };
    } catch (err) {
      saveEventState(state);
      return { status: 400, body: { error: err.message, partialResults: results } };
    }
  });

  res.status(result.status).json(result.body);
});
