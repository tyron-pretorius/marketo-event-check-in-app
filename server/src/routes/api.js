import express from "express";
import { loadState, saveState, resetState } from "../db.js";
import * as marketo from "../marketo.js";
import { getLatestEventPrograms } from "../eventFolders.js";

export const router = express.Router();

function timestamp() {
  return new Date().toISOString();
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
  res.json(loadState());
});

router.post("/state/reset", (req, res) => {
  res.json(resetState());
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
    const members = await marketo.getProgramMembers(programId);

    const state = loadState();
    state.programId = programId;
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

    saveState(state);
    res.json({ pulled: members.length, state });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// ---------- Check-in actions ----------

router.post("/checkin/:id", (req, res) => {
  const state = loadState();
  const person = state.people[req.params.id];
  if (!person) return res.status(404).json({ error: "Person not found" });

  person.status = "checked-in";
  person.checkedInAt = timestamp();
  saveState(state);
  res.json(person);
});

router.post("/checkin/:id/undo", (req, res) => {
  const state = loadState();
  const person = state.people[req.params.id];
  if (!person) return res.status(404).json({ error: "Person not found" });

  if (person.source === "walkin") {
    // Walk-ins have no registration to fall back to — undo removes them.
    delete state.people[req.params.id];
    saveState(state);
    return res.json({ removed: true });
  }

  person.status = "registered";
  person.checkedInAt = null;
  saveState(state);
  res.json(person);
});

// ---------- Walk-in (unregistered) check-in ----------

router.post("/walkin", (req, res) => {
  const { firstName = "", lastName = "", email = "", company = "" } = req.body || {};
  if (!email) return res.status(400).json({ error: "Email is required for walk-ins" });

  const state = loadState();
  const key = `walkin:${email.trim().toLowerCase()}`;

  if (state.people[key]) {
    return res.status(409).json({ error: "This person is already checked in" });
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
  saveState(state);
  res.json(person);
});

// ---------- Post-event sync back to Marketo ----------
// Checked-in registrants + walk-ins -> "Attended"
// Still-registered (never checked in) -> "No Show"

router.post("/sync", async (req, res) => {
  const state = loadState();
  const programId = state.programId || marketo.getDefaultProgramId();
  if (!programId) return res.status(400).json({ error: "No program id set. Pull registrants first." });

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
    saveState(state);
    res.json({ results, state });
  } catch (err) {
    saveState(state);
    res.status(400).json({ error: err.message, partialResults: results });
  }
});
