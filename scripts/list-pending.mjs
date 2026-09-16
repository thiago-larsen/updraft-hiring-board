// Prints every candidate added through the board's "Add candidate" form that
// still has needsReview:true, with their full pasted CV text, so Claude Code
// can read and review each one in chat, then call submit-review.mjs.
import { collection, getDocs, query, where } from "firebase/firestore";
import { db } from "./firestore.mjs";

const snap = await getDocs(query(collection(db, "cards"), where("needsReview", "==", true)));

if (snap.empty) {
  console.log("No candidates pending review.");
  process.exit(0);
}

snap.forEach((d) => {
  const c = d.data();
  console.log("\n" + "=".repeat(60));
  console.log(`ID: ${d.id}`);
  console.log(`Name: ${c.name}`);
  console.log(`Role: ${c.role || "(none given)"}`);
  console.log(`Source: ${c.source || "(none given)"}`);
  console.log(`LinkedIn: ${c.linkedin || "(none given)"}`);
  console.log("-".repeat(60));
  console.log(c.cvText || "(no CV text)");
});
