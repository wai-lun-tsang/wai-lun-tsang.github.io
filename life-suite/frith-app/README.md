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
- All your data (entries, goals, milestones, photos) lives only in this phone's browser storage. It is not backed up anywhere automatically.
- Use the **Export** button in Settings regularly to download a `.zip` backup (structured data + photos + a readable summary) — this is your safety net against a lost phone, a cleared browser, or a reinstall.
- If you ever want to update the app itself (a bug fix, a new feature), the new files just need re-uploading to the same GitHub repository, and Chrome will pick up the update next time you open the installed app while online.
