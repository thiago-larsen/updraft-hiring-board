// Writes Claude Code's CV review back onto a candidate card and clears
// needsReview, so the "Needs review" tag disappears from the board. The card
// was already on the Ongoing page the moment it was added (default stage
// "Sourced"), so no separate "move to Ongoing" step is needed here.
//
// Candidates added through the "Add Candidate" upload form leave the "role"
// field (the one-line headline shown under the name on every card) blank,
// since it's a manually-typed, optional field there and nobody's been
// filling it in. Pass --role so every reviewed candidate gets one, same
// style as the original seed data: "Title @ Company (detail) | ex-Company2".
//
// Usage:
//   node scripts/submit-review.mjs <candidateId> <fitScore> <priority> --role "..." <outcome text...>
// Example:
//   node scripts/submit-review.mjs jane-doe 72 High --role "AI Engineer @ Acme | ex-Foo, Bar" "Strong LLM/agent experience, weak on distributed systems."
import { doc, updateDoc } from "firebase/firestore";
import { db } from "./firestore.mjs";

const rawArgs = process.argv.slice(2);
const roleIdx = rawArgs.indexOf("--role");
let role = null;
let args = rawArgs;
if (roleIdx !== -1) {
  role = rawArgs[roleIdx + 1] || "";
  args = rawArgs.slice(0, roleIdx).concat(rawArgs.slice(roleIdx + 2));
}

const [id, fitScoreRaw, priority, ...outcomeParts] = args;
const outcome = outcomeParts.join(" ");

if (!id || !fitScoreRaw || !priority || !outcome) {
  console.error('Usage: node scripts/submit-review.mjs <candidateId> <fitScore> <High|Medium|Low> --role "..." <outcome text...>');
  process.exit(1);
}
if (!["High", "Medium", "Low"].includes(priority)) {
  console.error(`Priority must be High, Medium or Low — got "${priority}"`);
  process.exit(1);
}
if (!role) {
  console.error('Missing --role "..." — every reviewed candidate needs the one-line headline shown under their name on the board.');
  process.exit(1);
}

const patch = {
  fitScore: Number(fitScoreRaw),
  priority,
  outcome,
  role,
  needsReview: false,
  // Being reviewed counts as attention — starts a fresh 3-day staleness
  // clock for scripts/auto-reject-stale.mjs rather than back-dating it to
  // whenever the candidate was originally added.
  lastTouchedAt: new Date().toISOString()
};

await updateDoc(doc(db, "cards", id), patch);

console.log(`Updated ${id}: fitScore=${fitScoreRaw}, priority=${priority}, role="${role}", needsReview=false`);
process.exit(0);
