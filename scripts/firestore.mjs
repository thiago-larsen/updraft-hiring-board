// Shared Firestore client for the review scripts. Uses the same public web
// config as public/firebase-config.js (a Firebase web config is not a secret
// — see that file's header comment) — duplicated here because that file is a
// plain browser global, not a module other code can import.
import { initializeApp } from "firebase/app";
import { getFirestore } from "firebase/firestore";

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
