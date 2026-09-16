// Writes Claude Code's CV review back onto a candidate card and clears
// needsReview, so the "Needs review" tag disappears from the board. The card
// was already on the Ongoing page the moment it was added (default stage
// "Sourced"), so no separate "move to Ongoing" step is needed here.
//
// Usage:
//   node scripts/submit-review.mjs <candidateId> <fitScore> <priority> <outcome text...>
// Example:
//   node scripts/submit-review.mjs jane-doe 72 High "Strong LLM/agent experience, weak on distributed systems. Recommend moving to Screening."
import { doc, updateDoc } from "firebase/firestore";
import { db } from "./firestore.mjs";

const [id, fitScoreRaw, priority, ...outcomeParts] = process.argv.slice(2);
const outcome = outcomeParts.join(" ");

if (!id || !fitScoreRaw || !priority || !outcome) {
  console.error("Usage: node scripts/submit-review.mjs <candidateId> <fitScore> <High|Medium|Low> <outcome text...>");
  process.exit(1);
}
if (!["High", "Medium", "Low"].includes(priority)) {
  console.error(`Priority must be High, Medium or Low — got "${priority}"`);
  process.exit(1);
}

await updateDoc(doc(db, "cards", id), {
  fitScore: Number(fitScoreRaw),
  priority,
  outcome,
  needsReview: false
});

console.log(`Updated ${id}: fitScore=${fitScoreRaw}, priority=${priority}, needsReview=false`);
process.exit(0);
