// Initializes Firebase using the config in firebase-config.js.
// app.js checks window.__firebaseReady before trying to use Firestore, so if
// this file (or firebase-config.js) is missing/misconfigured, the board
// falls back to its built-in "not connected" banner instead of breaking.
(function () {
  try {
    if (typeof firebaseConfig === "undefined") {
      throw new Error("firebase-config.js not found or firebaseConfig not defined. " +
        "Copy firebase-config.example.js to firebase-config.js and fill in your project's values.");
    }
    if (firebaseConfig.apiKey === "PASTE-YOUR-API-KEY-HERE") {
      throw new Error("firebase-config.js still has placeholder values — fill in your real Firebase project config.");
    }
    firebase.initializeApp(firebaseConfig);
    window.__firebaseReady = true;
  } catch (e) {
    window.__firebaseReady = false;
    console.error("[UpDraft board] Firebase did not initialize:", e.message);
  }
})();
