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
2. **Pull Registrants** — fetches everyone currently in the Marketo program
   and lists them under the **Registered** tab.
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

State lives in `server/data/event-state.json` — safe to delete between
events to start fresh (or use `POST /api/state/reset`).

## Multi-device use

All devices point at the same backend server, so two phones checking in
the same event share one source of truth — you won't get duplicate
check-in records. There's no live push between devices, though: a device
only re-fetches the list when it takes an action (checking someone in,
searching, etc.), so another device's changes may not show up on your
screen until you interact with it.

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
MARKETO_EVENTS_ROOT_FOLDER_ID=
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
- `MARKETO_EVENTS_ROOT_FOLDER_ID` — optional. Enables the auto-discovery
  event picker by pointing it at a Marketo asset folder to browse down
  from — it looks for the most recent "YYYY" and "QN"-style subfolder
  names as it descends, falling back to just listing whatever programs
  sit directly inside if it finds neither. Leave this unset and the event
  picker will offer a manual "enter a Program Id" field instead — the app
  works fine without it.

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
to reskin the app for your own org.

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

## Contributing

Issues and PRs welcome. This is a community tool maintained by
[The Workflow Pro](https://theworkflowpro.com) — if you build something
useful on top of it, we'd love to hear about it.

## License

MIT — see [LICENSE](LICENSE).
