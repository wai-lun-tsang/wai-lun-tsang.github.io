# ContactPlus — install instructions

Same install process as F.R.I.T.H. — this is a self-contained app that needs hosting at a real web address once, then runs fully offline forever after.

## Quick local test (no hosting needed)
Unzip this folder and open `index.html` directly in Chrome, on your phone or computer. Everything works — contacts, timeline, key dates, mindmap, settings, import/export — since it's all local. The only things that won't work this way are the offline service worker and "Add to Home Screen" install prompt, which need a real `https://` address.

## Full install (when ready)
As agreed, this will be hosted together with your other apps once they're all ready, rather than one at a time. When that happens, the steps are the same as F.R.I.T.H.'s:
1. Upload this folder's contents to a GitHub repository (public, e.g. `contactplus-app`)
2. Enable GitHub Pages (Settings → Pages → Deploy from branch → main → root)
3. Open the resulting URL in Chrome on your phone and tap "Add to Home Screen" / the install prompt

## Notes
- All data (contacts, timeline entries, relationships, key dates, groups, alignment, tags) lives only in this phone's browser storage — nothing is sent anywhere, ever.
- vCard import/export is manual and one-off, standard fields only (name, phone, email) — private notes, relationships, and alignment never leave the app through that export.
- The "Export to calendar (.ics)" button on the Key Dates page is also manual and one-off — import the resulting file into Google Calendar, Apple Calendar, or any calendar app to get real reminders, since a browser app can't reliably notify you on its own when closed.
- There's no automatic backup. Use the vCard export (contacts) and .ics export (dates) periodically if you want a snapshot saved elsewhere.
