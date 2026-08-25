# GinkgoBooks (銀杏書)

A local-first book reading tracker and log — the 5th app in the suite (after FRITH,
ContactPlus, DocketMaster, LearnEasy). Tracks what you're reading, your progress,
and how each book breaks into time-based segments that DocketMaster can eventually
pull in as tasks. No accounts, no server, no cloud sync — everything lives in your
browser's IndexedDB.

## What's in this build

- Book library: add/edit/delete books (title, author, free-text format, tags/shelves)
- Custom statuses (Owned / Reading / Finished / DNF by default) — add, rename, delete,
  and mark any status "terminal" via Settings
- Progress tracking by page or duration, with percent shown once a total length is set
  (leaving it unset is fine — progress still shows as a raw position)
- Auto-generated, time-based reading segments (default 50 min, editable globally or
  per book) based on your actual measured pace once you've completed a few
- Marking a book with a terminal status (e.g. Finished, DNF) automatically closes any
  remaining pending segments
- Manual on-demand export/import of all data as a JSON file — use this as a backup
  before updating the app, or to restore if local data ever gets reset

## Not in this build (by design)

Reading goals/targets, deadlines, and notes/quotes are intentionally out of scope —
see the spec doc for the reasoning. DocketMaster write-back (segments being completed
automatically when you finish the corresponding task in DocketMaster) is designed into
the schema but not wired up yet, since DocketMaster's side doesn't exist yet.

## Testing locally

Browsers block IndexedDB and service workers on `file://` pages, so you need a local
server — any of these work:

**Option A — Python (usually already installed):**
```
cd ginkgobooks
python3 -m http.server 8000
```
Then open `http://localhost:8000` in your browser.

**Option B — Node, if you have it:**
```
cd ginkgobooks
npx serve .
```

**Option C — VS Code:** install the "Live Server" extension, right-click
`index.html`, choose "Open with Live Server."

Once it's open, try: add a book, generate a segment, mark it complete, mark a book
Finished and confirm its remaining segments auto-close, rename/delete a status,
and run an export followed by an import to confirm round-tripping works.

## What I could not test myself

I don't have a live browser in this environment, so this hasn't been run for real —
only reviewed line-by-line and checked for syntax errors and dangling references.
Please do a real test pass and let me know what breaks. Likely trouble spots to poke at:

- The percent-progress leaf-fill visual on the book detail page, at very low/high percentages
- Mobile layout at narrow widths (the CSS has one breakpoint, not heavily tested)
- Import with a hand-edited or older/malformed JSON file
- Adding many segments to one book — the pace math has only been checked by hand, not run

## Installing as a PWA (once hosted)

This app is meant to be hosted on GitHub Pages alongside the other four apps, all
under the same GitHub Pages origin, at the end of the suite build. At that point:

1. Push this folder (as its own project, e.g. `ginkgobooks-app`) to a GitHub repo
2. Enable GitHub Pages for that repo (Settings → Pages → deploy from branch)
3. Visit the published URL — your browser should offer "Install" / "Add to Home Screen"
4. Because IndexedDB is scoped by origin, not path, this app's data stays separate
   from FRITH/ContactPlus/LearnEasy's data (different database name) even though
   they'll all share `https://yourusername.github.io/`

Until then, local testing (above) is the way to use and check it.

## File structure

```
ginkgobooks/
├── index.html
├── style.css
├── app.js          — all logic: IndexedDB, CRUD, segment/pace engine, import/export
├── manifest.json
├── sw.js           — offline app-shell caching
├── icons/
│   ├── icon-192.png
│   ├── icon-512.png
│   └── icon-maskable-512.png
└── README.md
```

## Data model

Database `ginkgobooks-db`, version 1, stores: `books`, `statuses`, `segments`, `meta`.
A full field-by-field schema reference (for wiring up DocketMaster's read + narrow
write-back later) will be produced as a separate document once this build is tested
and confirmed working — matching the format of the FRITH/ContactPlus reference you
provided.
