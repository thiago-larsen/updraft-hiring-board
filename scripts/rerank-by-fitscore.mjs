// The board displays candidates within a column in "rank" order. New
// candidates added via Add Candidate always got rank = max+1 (bottom of the
// list) regardless of how they scored once reviewed. This recomputes rank
// for every candidate from scratch, sorted by fitScore descending, so
// display order actually reflects merit instead of "when they were added".
// Safe to re-run any time after new reviews land.
import { collection, getDocs, doc, updateDoc } from "firebase/firestore";
import { db } from "./firestore.mjs";

const snap = await getDocs(collection(db, "cards"));
const cards = snap.docs.map((d) => ({ id: d.id, ...d.data() }));

cards.sort((a, b) => {
  const sa = typeof a.fitScore === "number" ? a.fitScore : -1;
  const sb = typeof b.fitScore === "number" ? b.fitScore : -1;
  return sb - sa;
});

let changed = 0;
for (let i = 0; i < cards.length; i++) {
  const newRank = i + 1;
  if (cards[i].rank !== newRank) {
    await updateDoc(doc(db, "cards", cards[i].id), { rank: newRank });
    changed++;
  }
}

console.log(`Reranked ${cards.length} candidates by fitScore descending (${changed} rank values changed).`);
process.exit(0);
