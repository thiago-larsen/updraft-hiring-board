# UpDraft Hiring Pipeline — standalone app

This is the same hiring-pipeline board you've been using inside Claude (Board view, Sheet view,
candidate cards, comments) turned into an ordinary website you own and host yourself — no Claude
Team plan required. Your team can open it from any browser, and anyone comfortable in VS Code can
edit it.

**What it's made of, in plain terms:**
- The app itself (`public/index.html`, `public/app.js`) — the board's look and behavior. Unchanged
  from before, except for how it connects to storage.
- **Firebase** — a free service from Google that stores the candidate data and pushes live updates
  to everyone looking at the board at once, the same way the old version did.
- **Vercel** — a free service that hosts the site and gives it a real URL, and automatically
  redeploys it every time you push a change to GitHub.

None of this costs money at your scale (a few hundred candidates, a handful of teammates) — both
Firebase's and Vercel's free tiers comfortably cover it.

> **Have Claude Code (Claude for VS Code) installed?** Skip everything below and open
> **`SETUP_WITH_CLAUDE_CODE.md`** instead — it has a single message you paste into Claude Code and
> it runs almost this entire setup for you in a terminal, including deploying the site (no GitHub
> or Vercel account needed). Come back to this file afterward for how to make changes later.

---

## Setup — do these once, in order

### 1. Create your Firebase project

1. Go to [console.firebase.google.com](https://console.firebase.google.com) and sign in with any
   Google account (a personal one is fine to start, or set up one for the company later).
2. Click **Add project**, name it something like `updraft-hiring`, and click through the prompts
   (you can turn off Google Analytics — you don't need it).
3. Once the project opens, click the **`</>`** (web) icon on the project's home screen to register
   a web app. Name it anything (e.g. "board"). You don't need Firebase Hosting — skip that checkbox.
4. Firebase will show you a code block that looks like:
   ```js
   const firebaseConfig = {
     apiKey: "AIza...",
     authDomain: "updraft-hiring.firebaseapp.com",
     projectId: "updraft-hiring",
     ...
   };
   ```
   Keep this page open — you'll paste these values in step 2.
5. In the left sidebar, find **Databases & Storage** and click **Firestore** under it (Firebase has
   renamed/reorganized this menu a few times — if you don't see "Build" as a section, this is where
   it moved to). Click **Create database**, choose a location close to your team, and pick
   **Test mode** when asked about security rules (we'll overwrite these with our own in step 3
   right after, so either mode works — Test mode is just the safer default in the meantime).

### 2. Fill in your config

1. In this project folder, find `public/firebase-config.example.js`.
2. Make a copy of it in the same folder, named exactly `public/firebase-config.js`.
3. Open `public/firebase-config.js` and replace the placeholder values with the real ones from
   step 1.4 above.

(`firebase-config.js` is intentionally left out of git via `.gitignore`, so it won't get pushed to
GitHub by accident — see the comment at the top of the example file for why that's just tidiness,
not a real secret.)

### 3. Set the Firestore security rules

1. Back in the Firebase console: **Databases & Storage → Firestore → Rules** tab.
2. Delete what's there and paste in the contents of `firestore.rules` from this project.
3. Click **Publish**.

Read the comment at the top of `firestore.rules` — it explains what these rules do and don't
protect, and how to lock things down further later with sign-in if you want to.

### 4. Import your existing 108 candidates

This project includes `public/seed-data.json` — a snapshot of everyone currently on your board.

1. Open `public/import.html` directly in your browser (double-click the file, or right-click →
   Open With → your browser). It'll work fine even before you've deployed anything.
2. Click **Import 108 candidates into Firestore**. Watch the log — it should finish in a few
   seconds.
3. Now open `public/index.html` the same way (double-click it) — you should see the full board,
   reading live from your new Firestore project.

You only need to do this once. Feel free to delete `import.html` and `seed-data.json` afterward,
or just leave them — they're harmless to keep around.

### 5. Push the code to GitHub

From a terminal, inside this project folder:
```bash
git init
git add .
git commit -m "Initial import of UpDraft hiring board"
git branch -M main
git remote add origin https://github.com/YOUR-USERNAME/YOUR-REPO-NAME.git
git push -u origin main
```
(Create the empty repo on GitHub first at github.com/new, then use its URL above.)

### 6. Deploy to Vercel

1. Go to [vercel.com](https://vercel.com) and sign in with your GitHub account.
2. Click **Add New → Project**, and pick the repo you just pushed.
3. Vercel will auto-detect this as a static site (thanks to `vercel.json`) — you don't need to
   change any build settings. Click **Deploy**.
4. In a minute or two you'll get a live URL like `updraft-board.vercel.app`. That's the link to
   share with your team.

From now on, any time you (or a teammate) push a change to the `main` branch on GitHub, Vercel
rebuilds and redeploys automatically — no extra steps.

---

## Working on it in VS Code

Open this whole folder in VS Code. The pieces you'll actually touch:

- **`public/index.html`** — page structure and all the CSS (colors, spacing, layout). Search for
  `<style>` for the CSS, and scroll down for the HTML markup.
- **`public/app.js`** — all the behavior: rendering the board/sheet, drag-and-drop, the candidate
  detail modal, comments, filters. This is plain JavaScript, no framework, no build step — save the
  file, refresh the browser, see the change.
- **`public/firebase-config.js`** — your project's connection details. You should rarely need to
  touch this after initial setup.

To preview changes locally before pushing: just open `public/index.html` in your browser after
editing (or use VS Code's "Live Server" extension for auto-refresh). To publish a change for
everyone: commit and push to GitHub (`git add . && git commit -m "..." && git push`) — Vercel
takes it from there.

Anyone else in the company can do the same: give them access to the GitHub repo, and they can
clone it, make the same `firebase-config.js` copy (step 2 above, using the same Firebase project's
values — ask you for them, or share the project as a Firebase collaborator), and start editing.

---

## What's different from the version inside Claude

- **Data storage**: now Firestore (your own project) instead of Claude's built-in database. Same
  live-sync behavior — the Board and Sheet views update instantly for everyone looking at the page,
  same as before.
- **AI email drafting**: the "Draft candidate email" button in each candidate's card used Claude's
  built-in AI directly from the page. That capability doesn't exist outside Claude, so in this
  standalone version that button will show "AI drafting isn't available in this view — write the
  email directly below" and let you type the email by hand instead. If you want that button working
  again, the clean way is a small serverless function (a few lines, runs on Vercel) that calls the
  Anthropic API with your own API key — ask me and I can build that when you're ready; it just
  can't be done by having the browser call the API directly, since that would expose the key to
  anyone who opens the page's source.
- **Everything else** — Board, Sheet, drag-and-drop stages, priority/source filters, search,
  candidate detail cards, internal comments, the three pipeline pages (Ongoing / Rejected by Us /
  Rejected by Claude) — works exactly the same, because it's the same code.

---

## If something breaks

- **Board shows "Not connected — changes won't save"**: `firebase-config.js` is either missing or
  still has placeholder values (see step 2), or the Firestore rules haven't been published yet
  (step 3). Check the browser console (right-click → Inspect → Console) for the exact error.
- **Import page errors on write**: almost always the security rules — make sure step 3 was
  published, not just pasted.
- **Vercel deploy fails**: check that `public/firebase-config.js` exists in what you pushed to
  GitHub — actually, it won't, since it's gitignored on purpose. Vercel needs its own copy of that
  file's contents set some other way. Simplest fix: remove the `public/firebase-config.js` line
  from `.gitignore` and commit the real file after all — for an internal recruiting tool this is a
  reasonable tradeoff (see the security note in `firestore.rules`); just know the values become
  visible to anyone who finds the GitHub repo.
