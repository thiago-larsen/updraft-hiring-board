// Sweeps Low-priority candidates that have sat untouched in "Sourced" for 3+
// days and moves them to Rejected (rejectedBy: "claude"), which is what
// routes them onto the "Rejected by Claude" page instead of Ongoing — see
// pageOf()/stagePatch() in public/app.js. This is a soft, reversible move
// (not a delete): dragging a card's stage away from "Rejected" in the UI
// clears rejectedBy and brings it straight back to Ongoing.
//
// A candidate is exempt the moment a human moves it past "Sourced" (e.g.
// marks it Contacted) or touches any field on it — lastTouchedAt is bumped
// by every save in app.js and by scripts/submit-review.mjs. This only ever
// acts on candidates nobody has acted on.
//
// Usage: node scripts/auto-reject-stale.mjs
import { collection, getDocs, query, where, doc, updateDoc } from "firebase/firestore";
import { db } from "./firestore.mjs";

const STALE_MS = 3 * 24 * 60 * 60 * 1000;
const now = Date.now();

const snap = await getDocs(
  query(collection(db, "cards"), where("priority", "==", "Low"), where("stage", "==", "Sourced"))
);

if (snap.empty) {
  console.log("No Low-priority candidates in Sourced.");
  process.exit(0);
}

let rejected = 0;
let skippedNoTimestamp = 0;

for (const d of snap.docs) {
  const c = d.data();
  if (!c.lastTouchedAt) {
    // No heartbeat yet (shouldn't happen after the one-time backfill runs,
    // but skip rather than guess if it ever does) — never silently treat
    // "unknown" as "stale".
    skippedNoTimestamp++;
    continue;
  }
  const age = now - new Date(c.lastTouchedAt).getTime();
  if (age < STALE_MS) continue;

  await updateDoc(doc(db, "cards", d.id), {
    stage: "Rejected",
    rejectedBy: "claude",
    lastTouchedAt: new Date().toISOString()
  });
  rejected++;
  console.log(`Auto-rejected ${d.id} (${c.name}) — untouched for ${(age / 86400000).toFixed(1)} days.`);
}

console.log(`Done. Rejected ${rejected}, skipped ${skippedNoTimestamp} with no timestamp yet.`);
process.exit(0);
