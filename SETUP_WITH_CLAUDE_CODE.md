# Easiest setup path: let Claude Code do it

You have Claude for VS Code (Claude Code) and Git for Windows installed — that's everything needed
to skip the Firebase website almost entirely. Claude Code can run the setup commands for you in a
terminal, and Firebase itself can host the site directly (no GitHub, no Vercel account needed at
all).

## What to do

1. Unzip this project somewhere on your computer (e.g. your Desktop).
2. Open that folder in VS Code: **File → Open Folder…**, select the unzipped `updraft-board-app`
   folder.
3. Open the Claude Code panel (the Claude icon in VS Code's sidebar, or `Ctrl+Esc`).
4. Copy the entire message in the box below and paste it as your first message to Claude Code, then
   send it.

You'll be asked to approve each command Claude Code wants to run (normal VS Code/Claude Code
behavior) — just click **Allow** each time, this is your own machine running your own setup. Two
points in the middle need you specifically:
- A browser window will pop up asking you to log into your Google account — that's Firebase
  confirming it's really you.
- Right before the last step, you'll be asked to open one page in your browser and click one button
  (that's the one-time import of your 108 candidates).

Everything else — installing tools, creating the Firebase project, creating the database, writing
the config file, deploying — Claude Code does for you.

---

## Copy this entire message to Claude Code

```
I have a static web app in this folder (public/index.html, public/app.js) that needs a Firebase
project set up and deployed. I'm not a developer, so please run everything yourself and only stop
to ask me when you genuinely need my input (like logging into Google, or picking a name). Here's
the full sequence:

1. Check `node -v` and `npm -v` work. If not, tell me to install Node.js from nodejs.org first and
   stop.
2. Run `npx firebase-tools@latest login` — this opens a browser for me to log into Google. Wait for
   me to confirm it succeeded before continuing.
3. Create a new Firebase project with `npx firebase-tools projects:create` using a project id like
   `updraft-hiring-<random 4-digit number>` and display name "UpDraft Hiring". If that id is taken,
   try another random suffix.
4. Set it as the active project for this folder (this should create a `.firebaserc` file).
5. Create the Firestore database in Native mode, in a location close to Brazil (e.g. `southamerica-east1`
   if available, otherwise the closest supported region), using the firebase CLI. If the CLI command
   for this isn't available in the installed version, upgrade firebase-tools first and retry.
6. Deploy the security rules already in `firestore.rules` in this folder to that project
   (`firestore:rules` deploy target).
7. Create a Web app inside the Firebase project (`apps:create WEB`), then fetch its config
   (`apps:sdkconfig WEB <the app id>`).
8. Write that config into `public/firebase-config.js` (create this file — it does not exist yet,
   only `public/firebase-config.example.js` does) in this exact format:
   ```js
   const firebaseConfig = {
     apiKey: "...",
     authDomain: "...",
     projectId: "...",
     storageBucket: "...",
     messagingSenderId: "...",
     appId: "..."
   };
   ```
   using the real values Firebase gave you.
9. Tell me to open `public/import.html` in my browser and click the "Import 108 candidates into
   Firestore" button, and wait for me to confirm it's done.
10. Deploy the site with `npx firebase-tools deploy --only hosting`, and give me the live URL it
    prints at the end.
11. Confirm everything by telling me the live URL and reminding me it's now backed by my own
    Firebase project, fully separate from Claude.

Go ahead and start.
```

---

## If Claude Code gets stuck on step 5 (creating the Firestore database)

Some versions of the Firebase CLI don't support creating the database from the command line yet.
If that happens, this is the one step you may still need to do by hand — everything else stays
automated:

1. Go to [console.firebase.google.com](https://console.firebase.google.com), open your new project.
2. In the left sidebar: **Databases & Storage → Firestore → Create database**.
3. Pick a location, choose **Test mode**, click **Create**.
4. Tell Claude Code to continue from step 6.

## After this is done

The `README.md` in this folder still explains what each file does and how to make changes later —
worth a skim once things are live, but you shouldn't need it for the initial setup anymore.
