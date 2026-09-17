// Login gate for the board. Firestore rules now require request.auth != null
// on "cards" (see firestore.rules), so nobody can read/write candidate data
// without signing in — this file is what actually presents that sign-in step
// and blocks the page behind it until Firebase confirms a logged-in user.
//
// Accounts are created out-of-band (via `firebase auth:import`, run by
// Claude Code) — there is no self-serve sign-up here on purpose, since only
// specific people should have access.
(function () {
  "use strict";

  var readyCallbacks = [];
  var currentUser = null;

  window.onAuthReady = function (cb) {
    if (currentUser) cb(currentUser);
    else readyCallbacks.push(cb);
  };

  function buildOverlay() {
    var overlay = document.createElement("div");
    overlay.id = "authOverlay";
    overlay.style.cssText =
      "position:fixed;inset:0;background:var(--bg,#fafafa);z-index:1000;" +
      "display:flex;align-items:center;justify-content:center;padding:20px;";

    overlay.innerHTML =
      '<div style="width:100%;max-width:340px;background:var(--panel,#fff);border:1px solid var(--border,#eaeaea);' +
      'border-radius:12px;padding:28px;box-shadow:0 8px 32px rgba(0,0,0,.08);">' +
      '<div style="font-family:\'DM Serif Display\',Georgia,serif;font-size:22px;margin-bottom:4px;color:var(--text,#111);">UpDraft</div>' +
      '<div style="font-size:13px;color:var(--text-dim,#555);margin-bottom:20px;">Sign in to view the hiring pipeline.</div>' +
      '<label style="display:block;font-size:11px;font-weight:650;color:var(--text-faint,#999);text-transform:uppercase;letter-spacing:.3px;margin-bottom:4px;">Email</label>' +
      '<input type="email" id="authEmail" autocomplete="username" style="width:100%;padding:9px 10px;border-radius:7px;border:1px solid var(--border,#eaeaea);background:var(--panel-2,#fafafa);color:var(--text,#111);font-size:13px;margin-bottom:12px;box-sizing:border-box;">' +
      '<label style="display:block;font-size:11px;font-weight:650;color:var(--text-faint,#999);text-transform:uppercase;letter-spacing:.3px;margin-bottom:4px;">Password</label>' +
      '<input type="password" id="authPassword" autocomplete="current-password" style="width:100%;padding:9px 10px;border-radius:7px;border:1px solid var(--border,#eaeaea);background:var(--panel-2,#fafafa);color:var(--text,#111);font-size:13px;margin-bottom:6px;box-sizing:border-box;">' +
      '<div id="authError" style="font-size:12px;color:#c0362c;min-height:16px;margin-bottom:10px;"></div>' +
      '<button id="authSubmit" style="width:100%;padding:10px;background:#2563eb;color:#fff;border:none;border-radius:6px;font-size:13px;font-weight:600;cursor:pointer;">Sign in</button>' +
      "</div>";

    document.body.appendChild(overlay);

    function attempt() {
      var email = document.getElementById("authEmail").value.trim();
      var password = document.getElementById("authPassword").value;
      var errEl = document.getElementById("authError");
      var btn = document.getElementById("authSubmit");
      if (!email || !password) {
        errEl.textContent = "Enter your email and password.";
        return;
      }
      errEl.textContent = "";
      btn.disabled = true;
      btn.textContent = "Signing in…";
      firebase.auth().signInWithEmailAndPassword(email, password).catch(function (err) {
        errEl.textContent = "Couldn't sign in (" + (err && err.code ? err.code : "error") + "). Check your email and password.";
        btn.disabled = false;
        btn.textContent = "Sign in";
      });
      // On success, onAuthStateChanged below removes the overlay — no
      // explicit handling needed here.
    }

    document.getElementById("authSubmit").addEventListener("click", attempt);
    document.getElementById("authPassword").addEventListener("keydown", function (e) {
      if (e.key === "Enter") attempt();
    });
    document.getElementById("authEmail").focus();
  }

  function removeOverlay() {
    var el = document.getElementById("authOverlay");
    if (el) el.remove();
  }

  window.signOutOfBoard = function () {
    firebase.auth().signOut();
  };

  if (typeof firebase === "undefined" || !window.__firebaseReady) {
    // firebase-init.js already failed and showed its own error path — don't
    // also throw up a login screen on top of a broken config.
    return;
  }

  buildOverlay();

  firebase.auth().onAuthStateChanged(function (user) {
    if (user) {
      currentUser = user;
      removeOverlay();
      var who = document.getElementById("authWho");
      if (who) who.textContent = user.email;
      readyCallbacks.forEach(function (cb) { cb(user); });
      readyCallbacks = [];
    } else {
      currentUser = null;
      if (!document.getElementById("authOverlay")) buildOverlay();
    }
  });
})();
