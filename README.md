# Marketo Event Check-In

A free, open-source, mobile/tablet-friendly check-in app for in-person
events run through Marketo. Pull your registrants from a Marketo program,
check people in with fuzzy name search, handle walk-ins who never
registered, and sync attendance back to Marketo when the event's over.

Built by [The Workflow Pro](https://theworkflowpro.com) for the Marketing
Ops community — self-hosted, no subscription, your data stays on your own
server and in your own Marketo instance.

- **server/** — Node/Express API. Holds your Marketo credentials (never
  exposed to the browser) and a small local JSON store for the event's
  live check-in state.
- **client/** — React (Vite) frontend. Dark theme, mobile-first, no
  bundled fonts or images — just this repo's brand colors and the
  device's native font.

## How it works

1. **Choose an event** — on first load (or by tapping the event name in
   the header at any time) the app can browse your Marketo program
   folders to list recent events, or you can just paste in a Program Id
   directly. Search the list to pick the right one — this uses fuzzy
   matching, so a typo still finds the right program.
2. **Pull Registrants** — fetches everyone currently Registered in the
   Marketo program and lists them under the **Registered** tab. Re-pulling
   later also drops anyone no longer Registered (removed from the program,
   or their status changed) — except people already checked in, who stay
   put no matter what Marketo says next, since a real check-in that
   already happened is never silently erased.
3. **Check In** — tap a registrant to move them to **Checked-In**. They're
   tagged `Registered`.
4. **Add walk-in** (the `+` button) — check in someone who never registered.
   They land in **Checked-In** tagged `Unregistered`.
5. **Undo** — moves a checked-in registrant back to Registered; removes a
   walk-in entirely. This only changes local state — if you've already
   synced to Marketo, undoing and syncing again will push the corrected
   status.
6. **Sync to Marketo** (after the event) —
   - Everyone in **Checked-In** → Program Member status `Attended`
     (walk-ins are matched to an existing Marketo lead by email if one
     exists, or created as a new lead, then added to the program).
   - Everyone left in **Registered** (never checked in) → `No Show`.

Tap the event name in the header at any time to reopen the event picker
and switch to a different event.

Both the event picker and the people search (across either tab) use fuzzy
matching (Fuse.js), so a typo like "Chenn" still finds "Chen".

## Multi-device use

All devices point at the same backend server, so two phones checking in
the same event share one source of truth — you won't get duplicate
check-in records. Each device also polls for updates every 4 seconds
while an event is loaded, so a check-in made on one phone shows up on the
others shortly after, without anyone needing to manually refresh.

Every action that reads-modifies-writes an event's state (check-in, undo,
walk-in, pull, sync) is also serialized per event on the server, so a
check-in landing at the exact same instant as someone else hitting Sync
can never get silently lost — it simply waits its turn (typically
milliseconds) rather than racing a slower operation's save.

Each Marketo program also gets its own state file under
`server/data/events/`. There is no server-side "currently active
event" — every request names the program it means, and each device
remembers its own current event locally (in its browser), the same way
it remembers its own login. Switching events on one device never
affects what any other device is looking at, switching events never
carries one event's registrants or check-ins into another, and
switching back to a previously-loaded event picks its check-in
progress back up automatically. Safe to delete `server/data/` entirely
to start over (or use `POST /api/state/reset` with a `programId` to
clear just that one event).

## Setup

```bash
cd server && npm install
cd ../client && npm install
```

Copy `server/.env.example` to `server/.env` and fill it in:

```
MARKETO_MUNCHKIN_ID=
MARKETO_CLIENT_ID=
MARKETO_CLIENT_SECRET=
MARKETO_PROGRAM_ID=
MARKETO_ATTENDED_STATUS=Attended
MARKETO_NO_SHOW_STATUS=No Show
MARKETO_EVENTS_ROOT_FOLDER_NAME=
APP_PASSWORD=
```

- `MARKETO_MUNCHKIN_ID` / `MARKETO_CLIENT_ID` / `MARKETO_CLIENT_SECRET` —
  from a Marketo LaunchPoint custom service (Admin > LaunchPoint). The
  API-only user behind it needs Read-Only/Read-Write **Assets** and
  **Lead** permissions.
- `MARKETO_PROGRAM_ID` — optional. A default Program Id to load on
  startup; you can skip this and always pick a program from the in-app
  event picker instead.
- `MARKETO_ATTENDED_STATUS` / `MARKETO_NO_SHOW_STATUS` — must exactly
  match the Program Member status values configured on your program's
  channel (Admin > Tags/Channels), e.g. "Attended" / "No Show".
- `MARKETO_EVENTS_ROOT_FOLDER_NAME` — optional. Enables the auto-discovery
  event picker by pointing it at a Marketo Design Studio folder to browse
  down from — it looks for the most recent "YYYY" and "QN"-style subfolder
  names as it descends, falling back to just listing whatever programs
  sit directly inside if it finds neither. This is a **name**, not an id —
  unlike programs and smart campaigns, folder ids aren't shown anywhere in
  the Marketo UI, so copy the folder's name exactly as it appears in
  Design Studio. Leave this unset and the event picker will offer a
  manual "enter a Program Id" field instead — the app works fine without
  it.
- `APP_PASSWORD` — optional. If set, everyone must enter this password
  once per device before using the app — there are no individual
  accounts. Sessions last 12 hours and live in server memory, so
  restarting the server signs everyone out. 3 wrong guesses from one
  **device** trigger a 15-minute lockout for that device only. This is
  keyed by a random id the browser generates and stores in localStorage
  on first load — not by IP — because event staff are typically all on
  the same venue WiFi, which NATs everyone to one public IP; an IP-only
  lockout would let one person's typo lock out the whole event. (A MAC
  address would sidestep that too, but a web server can never see one —
  it's a link-layer detail stripped at the first router hop, invisible to
  both servers and browsers.) A much looser per-IP backstop (20 attempts)
  still catches a scripted flood that keeps inventing new device ids.
  Leave `APP_PASSWORD` unset to disable the login screen entirely — the
  client checks this via `/api/auth-status` before ever showing it. If
  you deploy behind a reverse proxy (Replit, ngrok, etc.), `trust proxy`
  is set to 1 hop in `server/src/index.js` — bump that number if you add
  another proxy layer in front (e.g. a CDN), or the IP backstop can't
  tell visitors apart.

## Run

```bash
# terminal 1
cd server && npm run dev

# terminal 2
cd client && npm run dev
```

Client runs at http://localhost:5173 and proxies `/api` to the server on
port 4000.

## Brand colors

This build uses:

| | |
|---|---|
| Pink | `#ff00ff` |
| Purple | `#6c78d8` |
| Black | `#000000` |
| White | `#ffffff` |

All of it lives in `client/src/styles/tokens.css` — swap the values there
to reskin the app for your own org. The header logo and favicon come from
`client/src/assets/logo.png` (used in `Wordmark.jsx` and `index.html`) —
swap that file and update the "Workflow Pro" text in `Wordmark.jsx` to
put your own brand on it.

## FAQ

**If someone turns up without registering but they're already in
Marketo, does it find their existing record and mark them attended?**
Yes. Checking someone in as a walk-in only creates a local placeholder —
it doesn't touch Marketo until you sync. At sync time, each walk-in's
email is looked up in Marketo first; if a match exists, that existing
lead is used and marked Attended (and added to the program if they
weren't already a member). No duplicate record gets created.

**And if they're completely new, does it create their record in Marketo
when we sync?**
Yes. If the email search at sync time comes back empty, a brand-new
Marketo lead is created with the name/company/email entered at check-in,
then marked Attended on the program.

**Is Undo only before syncing, or can we still correct a check-in
afterward?**
Undo works at any time, but it only changes local state — it never talks
to Marketo. Undoing before a sync is straightforward, since nothing's
been written yet. Undoing after a sync means the person's Marketo status
stays whatever was last synced until you sync again; do that and the
corrected status gets pushed then. One asymmetry: undoing a **walk-in**
removes them from the app's list entirely (they have no "registered"
state to fall back to) — if that walk-in was already synced, the Marketo
lead created for them still exists and still shows Attended.

**Can a few staff check people in on different devices at the same time?
Will they see each other's updates so we don't check someone in twice?**
Yes. All devices point at the same backend server and share one source
of truth, so you can't get duplicate check-in records — a second "Check
In" tap on the same person just re-stamps their timestamp. Each device
also polls for updates every 4 seconds while an event is loaded, so a
check-in made on one phone shows up on the others shortly after, without
anyone needing to manually refresh.

## Notes

- **Walk-in → program membership**: the app relies on Marketo's "Change
  Program Status" endpoint implicitly adding a lead to the program when
  you set their status — standard Marketo behavior, but worth confirming
  against your own instance before relying on it at a real event.
- **Status values**: `Attended` / `No Show` (or whatever you set them to)
  must be real status values on your program's channel, or the sync call
  will fail — check your program's channel setup for the exact strings.
- This is a single-server, self-hosted tool, not a hosted multi-tenant
  SaaS product — you run it yourself, and your Marketo credentials and
  attendee data never leave your own server.
- The server sends `Content-Security-Policy: frame-ancestors 'none'` and
  `X-Frame-Options: DENY` on every response, so the app can't be embedded
  in a hidden iframe on another site and clickjacked.

## Contributing

Issues and PRs welcome. This is a community tool maintained by
[The Workflow Pro](https://theworkflowpro.com) — if you build something
useful on top of it, we'd love to hear about it.

## License

MIT — see [LICENSE](LICENSE).
