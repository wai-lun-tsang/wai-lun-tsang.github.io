# LearnEasy

Academic guidance & progress tracker for UCL Computer Science (BSc, switchable to MEng). Fourth app in the personal PWA suite, alongside Project FRITH, ContactPlus, and DocketMaster.

Plain HTML/CSS/JS. No frameworks, no accounts, no server. Everything lives in your browser's IndexedDB, on your device only.

## What it does

- **Progress** — a single drill-down page: Degree → Year → Term → Module → Chunk (nest as deep as you like) → Material. Years and Terms are fixed structure (UCL's actual curriculum shape — Term 3 is exam-only, not taught, so it isn't included); you can rename them or set dates, but can't add or delete them, and Year 4 only appears via the MEng toggle in Settings. Modules can go directly under a Term, or directly under a Year as a full-year module — capped at 120 credits per year, matching UCL's actual credit structure. Adding, editing, and deleting (with confirmation) is available for Modules, Chunks, and Materials. Materials tied to a summative assessment (synced from Marks) always sort below everything else, under a subtle separator, and clicking one only lets you log time against it — its name, deadline, and mark stay controlled from the Marks page. Every list can be sorted manually (drag order via up/down arrows), alphabetically (numbers sorted naturally — "2" before "10"), or by date, and the choice is remembered.
- **Marks** — summative assessments only, calculated according to UCL's actual Academic Manual (Chapter 4, Section 7 for classification; Part B, Section 3 for late-submission penalties) rather than guesswork. Ordered Year-first, Degree last: each Year shows its Progression Year Mean / Classification Year Mean, then its full-year modules (before Term 1), then each Term (strict/inclusive figures, then that term's own modules, in the same manual/alphabetical/deadline sort as Progress). "Add assessment" disappears once a module's assessment weights reach 100%; "Add module" disappears once a year reaches its 120-credit cap. Deadlines, extensions (in minutes or as a percentage of the assessment's duration), and submission timestamps feed an automatic late-penalty calculation.
- **Settings** — default landing page, BSc/MEng toggle (instantly shows/hides Year 4 — switching away never deletes its data, just hides it), Final Weighted Mark rounding display, and default extension allowances (set separately for summative assignments and summative exams, each in minutes or percentage).

Non-summative graded work (self-set past papers, practice questions) is logged only on the Progress page as a Material — it never appears on Marks and never enters the calculation engine.

## If you tested an earlier version of this app

Earlier builds used a caching strategy that could get stuck serving old files even after you unzip a new version — you'd keep seeing old bugs no matter what changed. This is fixed going forward, but your browser may still have the old, broken version cached from before. **One-time cleanup, do this once:**

1. Open the app in Chrome, open DevTools (F12 or Cmd+Option+I), go to the **Application** tab.
2. Under **Service Workers**, click **Unregister** for anything listed there.
3. Under **Storage**, click **Clear site data**.
4. Close that tab entirely, then reopen `index.html` fresh.

Or, simplest: delete the old unzipped folder entirely and unzip this version into a brand-new folder (not the same path as before) — that guarantees no leftover cache.

## Local testing (now)

1. Unzip this folder anywhere on your computer.
2. Open `index.html` directly in Chrome (double-click it, or drag it into a Chrome window).
3. That's it — the app runs entirely offline, no server needed. Some browsers restrict IndexedDB on `file://` pages; if data doesn't seem to save, right-click the folder → "Open with" isn't enough — instead run a tiny local server:
   ```
   cd learneasy
   python3 -m http.server 8000
   ```
   then visit `http://localhost:8000` in Chrome.

## Installing as an app (once hosted)

This app is built to eventually live at `https://<your-username>.github.io/learneasy/`, alongside the rest of the suite, once you're ready to deploy everything together. Once it's hosted there:

1. Visit the URL in Chrome (desktop) or Chrome/Safari (mobile).
2. Desktop Chrome: click the install icon in the address bar, or Menu → "Install LearnEasy…".
3. Mobile: use the browser's "Add to Home Screen" option.
4. It'll then open full-screen, offline-capable, just like a native app.

## Data & privacy

- All data is stored locally in your browser's IndexedDB (database name `learneasy`). Nothing is ever sent anywhere.
- Export is manual only, from Settings → Data: JSON (full backup — everything, including your whole Progress tree, assessments, and settings) or CSV (marks only, flat, for spreadsheets — not re-importable).
- Import (Settings → Data → "Import JSON backup…") restores a previously exported JSON file. **This replaces all current data** — export a backup first if you want to keep what's currently there. Useful for moving to a new browser/device, or recovering after clearing site data. Only the JSON format can be imported; CSV doesn't carry the tree structure or settings needed to restore properly.
- Because IndexedDB is scoped by origin, once every app in your suite is hosted under the same GitHub Pages username, they'll share one origin — meaning DocketMaster (the task planner) can read LearnEasy's data directly, with no export step, the same way it's designed to read FRITH and ContactPlus. A schema reference document is included separately for whoever builds/maintains DocketMaster.

## Known open items (see the spec document for detail)

- If you're updating from an earlier copy of this app that still had Term 3 seeded in, opening the new version once will automatically remove any Term 3 (and cascade-delete anything you'd put under it — modules, assessments, materials). This runs once per load and is harmless if there's no Term 3 to remove.
- Bank holidays / UCL closure days aren't yet factored into the "working days late" count for coursework — weekends only for now.
- UCL's automatic extension entitlements (the standard 1-week RAA extension, 3 annual Delayed Assessment Permits) aren't auto-applied; log them as manual extensions per assessment, or use the default-extension settings for a blanket allowance.
- Year 1 assessment weights are your best current estimate — editable any time, and every module percentage colours the same regardless of whether it's confirmed or estimated.
- BSc/MEng Computer Science is assumed to run UCL's default Honours Classification Scheme A; this hasn't been independently confirmed against the department's own rules tool.

## File structure

```
index.html          app shell, tab navigation
style.css            visual theme
db.js                IndexedDB layer (nodes / assessments / settings stores)
calc.js               progress rollups + marks calculation engine
ui-common.js          shared UI helpers (logo, modal system)
ui-progress.js        Progress tab
ui-marks.js            Marks tab
ui-settings.js         Settings tab
main.js                app entry point, tab routing
manifest.json           PWA manifest
sw.js                   service worker (offline cache)
icons/                  app icons (192, 512, maskable)
```
