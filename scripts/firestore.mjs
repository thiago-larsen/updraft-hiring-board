// Shared Firestore client for the review scripts. Uses the same public web
// config as public/firebase-config.js (a Firebase web config is not a secret
// — see that file's header comment) — duplicated here because that file is a
// plain browser global, not a module other code can import.
//
// Firestore rules now require request.auth != null (see firestore.rules), so
// this signs in with a dedicated automation-only account before exporting
// `db`. Its credentials are read from environment variables — never
// hardcoded here — because this file lives in a public GitHub repo. Locally,
// export UPDRAFT_BOT_EMAIL / UPDRAFT_BOT_PASSWORD before running any script
// that imports this file. In the scheduled cloud routine, they're set as
// that routine's private environment variables.
import { initializeApp } from "firebase/app";
import { getFirestore } from "firebase/firestore";
import { getAuth, signInWithEmailAndPassword } from "firebase/auth";

// Local dev only — the cloud routine sets UPDRAFT_BOT_EMAIL/PASSWORD as real
// environment variables instead, so this is a silent no-op there.
import path from "node:path";
try { process.loadEnvFile(path.join(import.meta.dirname, "..", ".env.local")); } catch {}

const firebaseConfig = {
  apiKey: "AIzaSyDcgOusZSWPHWkAwNTvXDVnF1hvI9mS3vI",
  authDomain: "updraft-hiring-7983.firebaseapp.com",
  projectId: "updraft-hiring-7983",
  storageBucket: "updraft-hiring-7983.firebasestorage.app",
  messagingSenderId: "303409628275",
  appId: "1:303409628275:web:88db04f743737c3bb15606"
};

const app = initializeApp(firebaseConfig);
export const db = getFirestore(app);

const botEmail = process.env.UPDRAFT_BOT_EMAIL;
const botPassword = process.env.UPDRAFT_BOT_PASSWORD;

if (!botEmail || !botPassword) {
  console.error(
    "Missing UPDRAFT_BOT_EMAIL / UPDRAFT_BOT_PASSWORD environment variables — " +
    "Firestore now requires auth, so these scripts can't read/write without them."
  );
  process.exit(1);
}

await signInWithEmailAndPassword(getAuth(app), botEmail, botPassword);
