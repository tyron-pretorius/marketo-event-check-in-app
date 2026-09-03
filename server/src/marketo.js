// Thin client around the Marketo REST API endpoints this app needs:
//   - identity/oauth/token          (client_credentials auth)
//   - GET  /rest/v1/leads/programs/{id}.json   (pull program members)
//   - GET  /rest/v1/leads.json?filterType=email  (find a lead by email)
//   - POST /rest/v1/leads.json                   (createOrUpdate a lead)
//   - POST /rest/v1/leads/programs/{id}/status.json (change program member status)
//
// Docs: https://developers.marketo.com/rest-api/

let cachedToken = null; // { accessToken, expiresAt }

function config() {
  const {
    MARKETO_MUNCHKIN_ID,
    MARKETO_CLIENT_ID,
    MARKETO_CLIENT_SECRET,
    MARKETO_PROGRAM_ID,
  } = process.env;

  if (!MARKETO_MUNCHKIN_ID || !MARKETO_CLIENT_ID || !MARKETO_CLIENT_SECRET) {
    throw new Error(
      "Missing Marketo credentials. Set MARKETO_MUNCHKIN_ID, MARKETO_CLIENT_ID, MARKETO_CLIENT_SECRET in server/.env"
    );
  }

  return {
    baseUrl: `https://${MARKETO_MUNCHKIN_ID}.mktorest.com`,
    clientId: MARKETO_CLIENT_ID,
    clientSecret: MARKETO_CLIENT_SECRET,
    defaultProgramId: MARKETO_PROGRAM_ID || null,
  };
}

async function getAccessToken() {
  const { baseUrl, clientId, clientSecret } = config();

  if (cachedToken && cachedToken.expiresAt > Date.now() + 30_000) {
    return cachedToken.accessToken;
  }

  const url = new URL(`${baseUrl}/identity/oauth/token`);
  url.searchParams.set("grant_type", "client_credentials");
  url.searchParams.set("client_id", clientId);
  url.searchParams.set("client_secret", clientSecret);

  const res = await fetch(url);
  const json = await res.json();

  if (!res.ok || !json.access_token) {
    throw new Error(
      `Marketo auth failed: ${json.error_description || res.statusText}`
    );
  }

  cachedToken = {
    accessToken: json.access_token,
    expiresAt: Date.now() + (json.expires_in || 3600) * 1000,
  };
  return cachedToken.accessToken;
}

async function marketoFetch(pathAndQuery, options = {}) {
  const { baseUrl } = config();
  const token = await getAccessToken();
  const res = await fetch(`${baseUrl}${pathAndQuery}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      ...(options.headers || {}),
    },
  });
  const json = await res.json();
  if (!res.ok || json.success === false) {
    const err = (json.errors && json.errors[0]) || {};
    throw new Error(
      `Marketo API error ${err.code || res.status}: ${
        err.message || res.statusText
      }`
    );
  }
  return json;
}

const LEAD_FIELDS = ["id", "firstName", "lastName", "email", "company", "title"];

// Pulls program members (paginated) and returns only those currently in the
// program's "Registered" status — this endpoint returns every member
// regardless of status (Invited, Waitlisted, Declined, Attended, etc. from a
// prior sync), each with an embedded `membership.progressionStatusType` we
// filter on so re-pulling mid-event doesn't reintroduce already-processed
// people or noise like declines.
export async function getProgramMembers(programId) {
  const id = programId || config().defaultProgramId;
  if (!id) throw new Error("No Marketo program id provided");

  const members = [];
  let nextPageToken = null;

  do {
    const params = new URLSearchParams({
      fields: LEAD_FIELDS.join(","),
      batchSize: "200",
    });
    if (nextPageToken) params.set("nextPageToken", nextPageToken);

    const json = await marketoFetch(
      `/rest/v1/leads/programs/${id}.json?${params.toString()}`
    );
    members.push(...(json.result || []));
    nextPageToken = json.nextPageToken || null;
  } while (nextPageToken);

  return members.filter((m) => m.membership?.progressionStatusType === "Registered");
}

export async function findLeadByEmail(email) {
  const params = new URLSearchParams({
    filterType: "email",
    filterValues: email,
    fields: LEAD_FIELDS.join(","),
  });
  const json = await marketoFetch(`/rest/v1/leads.json?${params.toString()}`);
  return (json.result || [])[0] || null;
}

export async function createOrUpdateLead({ email, firstName, lastName, company }) {
  const json = await marketoFetch(`/rest/v1/leads.json`, {
    method: "POST",
    body: JSON.stringify({
      action: "createOrUpdate",
      lookupField: "email",
      input: [{ email, firstName, lastName, company }],
    }),
  });
  const result = (json.result || [])[0];
  if (!result || !result.id) {
    throw new Error(`Failed to create/update lead ${email}: ${JSON.stringify(result)}`);
  }
  return result.id;
}

// Sets a lead's Program Member status. Marketo adds the lead as a program
// member automatically if they aren't one yet, so this doubles as "add walk-in
// to program" when called with a fresh lead id.
export async function changeProgramStatus(programId, leadIds, status) {
  const id = programId || config().defaultProgramId;
  if (!id) throw new Error("No Marketo program id provided");
  if (!leadIds.length) return { success: true, result: [] };

  return marketoFetch(`/rest/v1/leads/programs/${id}/status.json`, {
    method: "POST",
    body: JSON.stringify({
      status,
      input: leadIds.map((leadId) => ({ id: leadId })),
    }),
  });
}

export function getDefaultProgramId() {
  return config().defaultProgramId;
}

export async function testConnection() {
  await getAccessToken();
  return true;
}

// ---------- Asset API (folders + programs) ----------
// Separate REST namespace (/rest/asset/v1) from the Lead Database API above,
// used to browse the program folder tree so hosts can pick an event instead
// of needing its numeric Program Id.

export async function getFolderById(id) {
  const json = await marketoFetch(`/rest/asset/v1/folder/${id}.json?type=Folder`);
  return (json.result || [])[0] || null;
}

// Folder IDs aren't visible anywhere in the Marketo UI (unlike program and
// smart campaign IDs, which show up in the URL) — the only practical way
// for someone to point this app at a folder is by its name, as shown in
// Design Studio.
export async function getFolderByName(name) {
  const params = new URLSearchParams({ name, type: "Folder" });
  const json = await marketoFetch(`/rest/asset/v1/folder/byName.json?${params.toString()}`);
  return (json.result || [])[0] || null;
}

export async function getFolderContent(id) {
  const params = new URLSearchParams({ type: "Folder", maxReturn: "200" });
  const json = await marketoFetch(`/rest/asset/v1/folder/${id}/content.json?${params.toString()}`);
  return (json.result || []).filter((item) => item.type === "Folder");
}

export async function browseProgramsInFolder(folderId) {
  const params = new URLSearchParams({
    filterType: "folderId",
    filterValues: String(folderId),
    maxReturn: "200",
  });
  const json = await marketoFetch(`/rest/asset/v1/programs.json?${params.toString()}`);
  return json.result || [];
}
