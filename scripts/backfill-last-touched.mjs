// One-time migration: stamps lastTouchedAt on every candidate that doesn't
// already have it, so the auto-reject-stale.mjs sweep starts its 3-day clock
// from today instead of treating pre-existing candidates as already stale.
// Safe to re-run — it only fills in candidates still missing the field.
import { collection, getDocs, doc, updateDoc } from "firebase/firestore";
import { db } from "./firestore.mjs";

const snap = await getDocs(collection(db, "cards"));
const now = new Date().toISOString();
let stamped = 0;

for (const d of snap.docs) {
  if (d.data().lastTouchedAt) continue;
  await updateDoc(doc(db, "cards", d.id), { lastTouchedAt: now });
  stamped++;
}

console.log(`Stamped ${stamped} of ${snap.size} candidates with lastTouchedAt=${now}.`);
process.exit(0);
