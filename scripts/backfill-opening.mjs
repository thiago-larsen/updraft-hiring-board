// One-time migration: stamps opening="AI Engineer" on every candidate that
// doesn't already have it — this is the field the Talent Pool (on the
// openings landing page) groups candidates by. Every candidate in this
// collection today belongs to the AI Engineer pipeline, since it's the only
// opening that exists so far. Safe to re-run.
import { collection, getDocs, doc, updateDoc } from "firebase/firestore";
import { db } from "./firestore.mjs";

const snap = await getDocs(collection(db, "cards"));
let stamped = 0;

for (const d of snap.docs) {
  if (d.data().opening) continue;
  await updateDoc(doc(db, "cards", d.id), { opening: "AI Engineer" });
  stamped++;
}

console.log(`Stamped ${stamped} of ${snap.size} candidates with opening="AI Engineer".`);
process.exit(0);
