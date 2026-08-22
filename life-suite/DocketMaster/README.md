# DocketMaster

A short-term task and time planner — Backlog → Quadrant triage → Day/Week
scheduling → Time & Timer. Plain HTML/CSS/JS Progressive Web App. All data
stays local to your device in IndexedDB — no accounts, no server, no cloud
sync, ever.

This app was built from `DocketMaster-Spec-v1.docx` — refer to that for the
full product spec, decisions log, and reasoning behind each feature.

---

## Testing locally right now

1. Unzip this folder anywhere on your device.
2. Open `index.html` directly in Chrome (double-click it, or drag it into a
   Chrome window).
3. That's it — everything runs client-side. Your data is saved in Chrome's
   IndexedDB for this file location and will persist between visits, as long
   as you keep opening it from the same place.

A couple of things that **won't** work yet from a local `file://` opening,
by design, until the hosting pass at the end:
- The FRITH/ContactPlus auto-sync (needs same-origin hosting — see spec §12).
- Full offline service-worker caching behaves a little differently under
  `file://` than it will once actually hosted; the app still works locally,
  it just isn't exercising the same code path a real deployment would.

## Eventual GitHub Pages install (once you're ready for the hosting pass)

1. Create (or reuse) a GitHub repository for your app suite.
2. Put this folder in its own subpath, e.g. `docketmaster/`, alongside
   `frith/`, `contactplus/`, etc. — all under the **same GitHub username**
   site (e.g. `yourusername.github.io/docketmaster/`) so they share one
   browser storage origin. This is what makes the FRITH/ContactPlus
   auto-read sync work with zero extra setup.
3. In the repo's Settings → Pages, set the source to the branch/folder
   you're using.
4. Visit `https://yourusername.github.io/docketmaster/` — the FRITH/ContactPlus
   sync settings in DocketMaster's Settings page should now show real goals
   and contacts instead of the "not detected" message.

---

## What to test / please report back on

I can't run this in a live browser from my end, so a real pass from you
would help a lot. Specifically worth checking:

- **Add a task** (+ button) — try it with and without optional fields (notes,
  time slot, tag, type, recurrence).
- **Sliders** — drag Importance/Urgency, try a preset button, confirm no snap.
- **Quadrant** — after adding a couple of tasks with different slider values,
  confirm the dots land roughly where you'd expect.
- **Recurring tasks** — create one with each of the three modes (weekday,
  every-N-days, specific dates) and check Day/Week view materializes it on
  the right dates.
- **Timer** — start a manual Binge and a manual Pomodoro, let one ring, check
  sound/visual/vibrate toggles.
- **.ics export** — export a week, try importing that file into Google
  Calendar (or Apple/Outlook) and see if the events land correctly.
- **Backup export/import** — export, then try importing it back in (or into
  a second browser profile) and confirm nothing's lost.
- **Settings → tags** — add, edit, delete a tag; confirm task bubbles update.
- **LearnEasy sync** (once LearnEasy exists and both apps are same-origin
  hosted) — set a module's Assessment deadlines / Unfinished materials
  toggles, confirm the right items show up as tasks, and that an assessment
  extension updates its task's date rather than duplicating it. Also try the
  detailed import screen (Settings → LearnEasy Sync → "Open detailed import
  screen") — tick a few individual items, confirm only those get created,
  and that they show as "✓ imported" if you revisit the screen afterward.

If anything looks broken, behaves unexpectedly, or just feels off, let me
know and I'll fix it.

---

## Implementation notes & known limitations

A few deliberate simplifications and things worth double-checking, flagged
honestly rather than glossed over:

- **Recurrence editing is only available when creating a brand-new task.**
  Editing an already-scheduled occurrence (including one materialized from a
  recurring series) edits just that single day's task, not the whole series.
  If you want to change a series going forward, delete and recreate it for
  now — turning this into a proper "edit this / edit all future" flow is a
  reasonable follow-up if it turns out you need it often.
- **A few quick interactions use the browser's native prompt/confirm dialogs**
  (picking a date to schedule a backlog task to, adding/editing/deleting a
  tag) rather than a custom in-app picker. Functional, but plainer than the
  rest of the UI — flag if this bothers you in practice and I'll build proper
  in-app versions.
- **Cross-app sync detection** relies on `indexedDB.databases()`, which
  modern Chrome/Edge support but which older Safari versions don't. Where
  it's unavailable, DocketMaster safely treats FRITH/ContactPlus as "not
  detected" rather than risking any write — so on unsupported browsers the
  Settings sync section will just always show the manual-import fallback
  message, even once hosted same-origin.
- **ContactPlus key-date matching** (recurring birthdays etc.) is a
  best-effort reimplementation based on the documented field shapes
  (`recurring` + `date`), since ContactPlus's exact `nextOccurrence()` source
  wasn't available to copy directly. Worth spot-checking a real birthday once
  same-origin sync is live, in case ContactPlus's actual logic handles an
  edge case (e.g. leap-year birthdays) differently.
- **LearnEasy sync is grouped by module for the automatic Never/Auto/Ask
  toggles** (Settings → LearnEasy Sync), since a per-item toggle there would
  be unwieldy with dozens of materials per module. For finer control, that
  same section has an **"Open detailed import screen →"** button — a
  dedicated page (Settings → LearnEasy Sync → detailed screen) listing every
  pending assessment deadline and unfinished material individually, grouped
  by module, each with its own checkbox and an "Import selected" action.
  Already-imported items show as disabled/checked with an "✓ imported" tag
  so you can see what's already in DocketMaster at a glance. The two
  mechanisms are independent — the module-level toggles keep working for
  fire-and-forget daily sync, the detail screen is for occasional manual
  curation — and both write through the same dedupe logic, so using one
  doesn't create duplicates against the other.
- **Assessment deadlines re-sync on every load** (so an extension changes
  the task's date automatically, one-way, without duplicating it), but
  **materials do not** — once a material's imported, DocketMaster won't
  notice if its estimate or done-time changes in LearnEasy afterward. If
  that turns out to matter, re-syncing materials the same way deadlines do
  is a straightforward follow-up.
- **Vibration** only works on Android Chrome — iOS Safari has no Vibration
  API support at all, so the toggle will simply do nothing there (sound and
  visual pulse still work everywhere).
- **Fonts** (Permanent Marker / Shantell Sans / Quicksand) load from Google
  Fonts and get cached by the service worker after the first successful
  online load. If you go offline before that first load, the app will fall
  back to your system font until you're online again — everything still
  works, it just won't look quite as crayon-y until then.
- **True closed-app push notifications are not implemented**, per the spec's
  §13 — only in-app reminders and an "on open" catch-up summary listing
  tasks that were due while the app was closed.

---

## File structure

```
index.html
style.css
manifest.json
sw.js
icons/
  icon-192.png
  icon-512.png
  icon-maskable-512.png
js/
  db.js            — IndexedDB wrapper
  defaults.js       — default tags/settings, first-run seeding
  recurrence.js     — shared weekday/everyN/dates eligibility logic
  tasks.js          — task CRUD + recurring series materialization
  sync.js           — read-only FRITH/ContactPlus cross-app sync
  ics.js            — .ics calendar export/import
  timer.js          — Binge/Pomodoro timer logic
  backup.js         — manual full-data JSON backup export/import
  ui-taskmodal.js   — task add/edit modal (sliders, tags, type, recurrence)
  ui-views.js       — Backlog/Quadrant/Day/Week/Timer/Settings renderers
  app.js            — routing, tab bar, init
```
