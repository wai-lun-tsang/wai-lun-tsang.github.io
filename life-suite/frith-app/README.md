# F.R.I.T.H. — install instructions

This folder is a complete, self-contained app (a Progressive Web App). It needs to be hosted at a real web address once so your phone can install it — after that, it runs fully offline and never talks to the internet again.

## 1. Create a free GitHub account
If you don't already have one: https://github.com/join (this account is yours, not linked to Claude or Anthropic in any way).

## 2. Create a new repository
- Go to https://github.com/new
- Name it something like `frith-app` (name doesn't matter)
- Set it to **Public** (required for free GitHub Pages)
- Don't add a README — just click "Create repository"

## 3. Upload these files
On the new repository's page, click **"uploading an existing file"** and drag in every file from this folder, keeping the folder structure exactly as-is:

```
index.html
style.css
app.js
manifest.json
sw.js
icons/icon-192.png
icons/icon-512.png
icons/icon-maskable.png
```

Commit the upload.

## 4. Turn on GitHub Pages
- In the repository, go to **Settings → Pages**
- Under "Build and deployment", set **Source** to "Deploy from a branch"
- Set **Branch** to `main` and folder to `/ (root)`, then Save
- Wait ~1 minute; GitHub will show a URL like:
  `https://yourusername.github.io/frith-app/`

## 5. Install on your phone
- Open that URL in **Chrome** on your Android phone
- Chrome should show an "Install app" / "Add to Home Screen" prompt — tap it
  (if it doesn't appear automatically, tap the ⋮ menu → "Add to Home screen")
- The app icon (hourglass) appears on your home screen, labelled **F.R.I.T.H.**

From that point on, opening it from the home screen runs the app fully offline. GitHub is never contacted again — it was only the one-time delivery mechanism.

## Notes
- All your data (entries, goals, milestones, photos/videos) lives only in this phone's browser storage. It is not backed up anywhere automatically.
- **Settings → Full Backup & Restore** downloads a single `.json` file containing absolutely everything — settings, every goal, every milestone, and every entry ever logged, for the whole life of this instance, with photos and videos embedded directly in the file (not a separate folder). This is the file to keep somewhere safe (cloud drive, email to yourself, etc.) and the one to use if the app is ever lost, the phone is reset, or you reinstall — use the **Restore from backup** button on that same file to load it all back in.
- The regular **Export** button (structured data + photos folder + a readable summary, as a `.zip`) is still there for a specific date range — good for reading through or sharing a slice of your history, but it's not meant as the primary recovery backup; use Full Backup for that.
- If you ever want to update the app itself (a bug fix, a new feature), the new files just need re-uploading to the same GitHub repository, and Chrome will pick up the update next time you open the installed app while online.
