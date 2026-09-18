(function(){
  "use strict";

  if (typeof pdfjsLib !== "undefined") {
    pdfjsLib.GlobalWorkerOptions.workerSrc = "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js";
  }

  var STAGES = ["Sourced","Contacted","Screening","Interview 1","Interview 2","Take Home","Technical Assessment","Offer","Hired","On Hold","Rejected"];
  var PRIORITIES = ["High","Medium","Low"];
  var FOLLOWUPS = ["Not yet","Sent - awaiting reply","Replied","N/A"];
  var SOURCES = ["Lead","Applied"];
  var CONTACTED_OPTS = ["No","Yes"];

  var SEED = [{"Candidate": "Vinícius Gurski Ferraz", "Fit Score": 80.5, "Stage": "Sourced", "Priority": "High", "Source": "Lead", "Owner": null, "Last Contact Date": null, "Next Action": null, "Follow-up Sent to Candidate?": "Not yet", "Internal Comments": null, "Outcome / Notes": null, "Role": "AI Engineer @ Itaú Unibanco (ex-Compass.uol, Advolve.ai)", "LinkedIn": "https://www.linkedin.com/in/viniciusgferraz"}];

  var db = null;
  var cardsById = {};      // id -> card data object
  var order = [];          // ids in original fit-score rank order (stable secondary sort)
  var unsubBoard = null;
  var openCardId = null;
  var openCardUnsub = null;
  var commentsCache = {};  // id -> array of comment docs
  var searchTerm = "";
  var priorityFilterVal = "";
  var sourceFilterVal = "";
  var nameEditing = false;
  var modalMode = "view"; // "view" | "add" — which content the overlay/modal is showing
  var activeView = "board"; // "board" | "sheet" — both render the same live "cards" collection
  var activePage = "ongoing"; // "ongoing" | "rejected_us" | "rejected_claude"
  var PAGE_HINTS = {
    ongoing: "Active pipeline — everyone not yet rejected.",
    rejected_us: "Candidates we rejected by hand, with the internal reason and rejection-email draft attached.",
    rejected_claude: "Reserved for the auto-discard feature (stale Low-priority candidates). That automation is paused for now, so this stays empty until it's turned on."
  };

  // Which of the three pages a card belongs on. A card is only ever on one
  // page at a time — the pages partition the whole pipeline.
  function pageOf(c){
    if (c.stage !== "Rejected") return "ongoing";
    return c.rejectedBy === "claude" ? "rejected_claude" : "rejected_us";
  }
  // "Rejected" stays a column on the Ongoing board itself, so you can drag a
  // card straight into it. It's a one-way chute, not a resting place: the
  // moment a card's stage becomes "Rejected", pageOf() above routes it off
  // the Ongoing page entirely — it lands on "Rejected by Us" automatically,
  // so this column always renders empty on Ongoing right after a drop.
  //
  // Each page's columns are described as {key, label, match, onDrop} so
  // renderBoard() doesn't need to special-case any one page: "match" decides
  // which cards land in the column, "onDrop" decides what a drag-and-drop
  // into it actually does. Most columns key off "stage" like before; the
  // Rejected-by-Us page instead uses a "rejectedReason" field to split its
  // one bucket into three, since every card there already has stage
  // "Rejected" — "reason" is the thing that still varies.
  // The "Contacted" stage splits into three columns by a "contactStatus"
  // field (mirroring the rejectedReason pattern above) so the board shows
  // reply status at a glance instead of one undifferentiated bucket.
  // Dragging a card in from any other stage sets both stage:"Contacted" and
  // the target contactStatus in one move, since dropping straight onto
  // "Answered" clearly means both at once.
  function contactedSubColumns(){
    return [
      {
        key: "contacted_awaiting", label: "Awaiting Reply",
        match: function(c){ return c.stage === "Contacted" && !c.contactStatus; },
        onDrop: function(id){
          if (cardsById[id].stage !== "Contacted" || cardsById[id].contactStatus) setContactStatus(id, null);
        }
      },
      {
        key: "contacted_answered", label: "Answered", tone: "positive",
        match: function(c){ return c.stage === "Contacted" && c.contactStatus === "answered"; },
        onDrop: function(id){
          if (cardsById[id].stage !== "Contacted" || cardsById[id].contactStatus !== "answered") setContactStatus(id, "answered");
        }
      },
      {
        key: "contacted_no_response", label: "Didn't Answer", tone: "warn",
        match: function(c){ return c.stage === "Contacted" && c.contactStatus === "no_response"; },
        onDrop: function(id){
          if (cardsById[id].stage !== "Contacted" || cardsById[id].contactStatus !== "no_response") setContactStatus(id, "no_response");
        }
      }
    ];
  }

  function columnsForPage(page){
    if (page === "ongoing"){
      var cols = [];
      STAGES.forEach(function(s){
        if (s === "Contacted"){ cols = cols.concat(contactedSubColumns()); return; }
        cols.push({
          key: s, label: s,
          match: function(c){ return c.stage === s; },
          onDrop: function(id){ if (cardsById[id].stage !== s) moveCard(id, s); }
        });
      });
      return cols;
    }
    if (page === "rejected_us"){
      return [
        {
          key: "rejected_general", label: "Rejected",
          match: function(c){ return !c.rejectedReason; },
          onDrop: function(id){ if (cardsById[id].rejectedReason) setRejectedReason(id, null); }
        },
        {
          key: "missed_interview", label: "Missed the Interview",
          match: function(c){ return c.rejectedReason === "missed_interview"; },
          onDrop: function(id){ if (cardsById[id].rejectedReason !== "missed_interview") setRejectedReason(id, "missed_interview"); }
        },
        {
          key: "second_chance", label: "Second Chance", action: true,
          emptyText: "Drop a candidate here to send them back to Sourced on the Ongoing pipeline.",
          match: function(){ return false; }, // never a resting place — see sendToSecondChance()
          onDrop: function(id){ sendToSecondChance(id); }
        }
      ];
    }
    // rejected_claude
    return [{
      key: "Rejected", label: "Rejected",
      match: function(c){ return c.stage === "Rejected"; },
      onDrop: function(id){ if (cardsById[id].stage !== "Rejected") moveCard(id, "Rejected"); }
    }];
  }
  function updatePageTabBadges(){
    var counts = {ongoing:0, rejected_us:0, rejected_claude:0};
    order.forEach(function(id){
      var c = cardsById[id];
      if (!c) return;
      counts[pageOf(c)]++;
    });
    var elO = document.getElementById("ptOngoing");
    var elU = document.getElementById("ptRejUs");
    var elC = document.getElementById("ptRejClaude");
    if (elO) elO.textContent = counts.ongoing;
    if (elU) elU.textContent = counts.rejected_us;
    if (elC) elC.textContent = counts.rejected_claude;
  }

  function renderCurrentView(){
    updatePageTabBadges();
    if (activeView === "sheet") renderSheet(); else renderBoard();
  }
  var toastTimer = null;

  function showToast(text){
    var t = document.getElementById("toast");
    if (!t) return;
    t.textContent = text;
    t.classList.add("show");
    if (toastTimer) clearTimeout(toastTimer);
    toastTimer = setTimeout(function(){ t.classList.remove("show"); }, 4500);
  }

  function slugify(name){
    return name.toLowerCase()
      .normalize("NFD").replace(/[̀-ͯ]/g,"")
      .replace(/[^a-z0-9]+/g,"-").replace(/(^-|-$)/g,"") || "candidate";
  }

  function scoreColor(score){
    if (score >= 65) return "#1f9d55";
    if (score >= 45) return "#3f8fd6";
    if (score >= 28) return "#b7791f";
    return "#8a8f98";
  }

  function setStatus(text, mode){
    var dot = document.getElementById("statusDot");
    var t = document.getElementById("statusText");
    dot.className = "dot" + (mode ? " " + mode : "");
    t.textContent = text;
  }

  function getViewerName(){
    var n = null;
    try { n = localStorage.getItem("updraft_board_name"); } catch(e){}
    return n;
  }
  function setViewerName(n){
    try { localStorage.setItem("updraft_board_name", n); } catch(e){}
  }

  async function init(){
    // Standalone build: talks to your own Firebase project (see
    // firebase-init.js) instead of Claude's built-in "db" capability. The
    // rest of this file is unchanged from the original board — it only ever
    // called db.collection()/doc()/onSnapshot()/etc, which the Firestore
    // compat SDK implements with the same method names.
    var cap = null;
    try {
      if (window.__firebaseReady && typeof firebase !== "undefined") {
        cap = firebase.firestore();
      }
    } catch(e){ cap = null; }
    if (!cap){
      document.getElementById("offlineBanner").hidden = false;
      setStatus("Not connected — changes won't save", "err");
      // still render from seed so the board isn't blank
      SEED.forEach(function(row, i){ ingestSeedRow(row, i); });
      renderCurrentView();
      return;
    }
    db = cap;
    setStatus("Loading…");
    await ensureSeeded();
    subscribeBoard();
  }

  function ingestSeedRow(row, i){
    var id = slugify(row.Candidate);
    order.push(id);
    cardsById[id] = {
      id: id,
      name: row.Candidate,
      role: row.Role || "",
      fitScore: row["Fit Score"],
      stage: row.Stage || "Sourced",
      priority: row.Priority || "Medium",
      source: row.Source || "Lead",
      owner: row.Owner || "",
      contacted: row.Contacted || "No",
      lastContact: row["Last Contact Date"] || "",
      nextAction: row["Next Action"] || "",
      followup: row["Follow-up Sent to Candidate?"] || "Not yet",
      outcome: row["Outcome / Notes"] || "",
      linkedin: row.LinkedIn || "",
      rank: i + 1
    };
  }

  async function ensureSeeded(){
    var col = db.collection("cards");
    var snap = await col.limit(1).get();
    if (!snap.empty) return; // already seeded by an earlier viewer
    for (var i = 0; i < SEED.length; i++){
      var row = SEED[i];
      var id = slugify(row.Candidate);
      var data = {
        name: row.Candidate,
        role: row.Role || "",
        fitScore: row["Fit Score"],
        stage: row.Stage || "Sourced",
        priority: row.Priority || "Medium",
        source: row.Source || "Lead",
        owner: row.Owner || "",
        contacted: row.Contacted || "No",
        lastContact: row["Last Contact Date"] || "",
        nextAction: row["Next Action"] || "",
        followup: row["Follow-up Sent to Candidate?"] || "Not yet",
        outcome: row["Outcome / Notes"] || "",
        linkedin: row.LinkedIn || "",
        opening: "AI Engineer",
        rank: i + 1
      };
      try { await col.doc(id).set(data); } catch(e){ /* another viewer may be racing the same seed */ }
    }
  }

  function subscribeBoard(){
    if (unsubBoard) unsubBoard();
    var col = db.collection("cards");
    unsubBoard = col.onSnapshot(function(qs){
      var next = {};
      var nextOrder = [];
      qs.docs.forEach(function(d){
        var data = d.data();
        next[d.id] = Object.assign({id:d.id}, data);
        nextOrder.push(d.id);
      });
      nextOrder.sort(function(a,b){ return (next[a].rank||999) - (next[b].rank||999); });
      cardsById = next;
      order = nextOrder;
      setStatus("Live — synced across everyone with this link", "live");
      renderCurrentView();
      if (openCardId && cardsById[openCardId]) renderModalFields(cardsById[openCardId]);
    }, function(err){
      setStatus("Connection lost (" + err.code + ")", "err");
    });
  }

  // Strips accents/diacritics (á, ã, ç, é, …) and lowercases, so searching
  // "joao" finds "João" and "jose" finds "José" — plain .toLowerCase() alone
  // only handles case, not diacritics.
  function normalizeSearch(s){
    return String(s||"").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
  }

  function matchesFilters(c){
    if (priorityFilterVal && c.priority !== priorityFilterVal) return false;
    if (sourceFilterVal && (c.source || "Lead") !== sourceFilterVal) return false;
    if (searchTerm){
      var hay = normalizeSearch(c.name + " " + (c.role||""));
      if (hay.indexOf(searchTerm) === -1) return false;
    }
    return true;
  }

  function renderBoard(){
    var board = document.getElementById("board");
    board.innerHTML = "";
    var visibleCount = 0;
    var columns = columnsForPage(activePage);
    var singleCol = columns.length === 1;
    var pageIds = order.filter(function(id){ return cardsById[id] && pageOf(cardsById[id]) === activePage; });
    var total = pageIds.length;

    columns.forEach(function(colDef){
      var ids = pageIds.filter(function(id){ return colDef.match(cardsById[id]); });
      var visIds = ids.filter(function(id){ return matchesFilters(cardsById[id]); });
      visibleCount += visIds.length;

      var col = document.createElement("div");
      col.className = "column" + (singleCol ? " wide" : "") + (colDef.action ? " action" : "") + (colDef.tone ? " tone-" + colDef.tone : "");
      col.dataset.stage = colDef.key;

      var head = document.createElement("div");
      head.className = "column-head";
      head.innerHTML = '<span class="ct">'+escapeHtml(colDef.label)+'</span><span class="cn">'+ids.length+'</span>';
      col.appendChild(head);

      var body = document.createElement("div");
      body.className = "column-body";

      if (visIds.length === 0){
        var empty = document.createElement("div");
        empty.className = "column-empty";
        if (ids.length !== 0) empty.textContent = "No matches";
        else if (colDef.emptyText) empty.textContent = colDef.emptyText;
        else if (activePage === "rejected_claude") empty.textContent = "Empty — the auto-discard automation is paused, so nothing lands here yet.";
        else empty.textContent = "No candidates";
        body.appendChild(empty);
      } else {
        visIds.forEach(function(id){ body.appendChild(renderCard(cardsById[id])); });
      }

      col.appendChild(body);

      col.addEventListener("dragover", function(e){ e.preventDefault(); col.classList.add("dragover"); });
      col.addEventListener("dragleave", function(){ col.classList.remove("dragover"); });
      col.addEventListener("drop", function(e){
        e.preventDefault();
        col.classList.remove("dragover");
        var id = e.dataTransfer.getData("text/plain");
        if (id && cardsById[id]) colDef.onDrop(id);
      });

      board.appendChild(col);
    });

    document.getElementById("countPill").textContent =
      (searchTerm || priorityFilterVal || sourceFilterVal) ? (visibleCount + " of " + total + " shown") : (total + " candidates");
  }

  // Spreadsheet view — same "cards" collection as the Board, just laid out as
  // an editable table. Every edit here writes straight to the shared doc, so
  // the Board reflects it live and vice versa; there is no separate file to
  // keep in sync.
  function renderSheet(){
    var table = document.getElementById("sheetTable");
    if (!table) return;

    // Don't yank focus out from under someone mid-keystroke when a remote
    // update streams in — the field already shows what they typed; the
    // fresh data will render next time nothing's focused.
    if (document.activeElement && table.contains(document.activeElement) &&
        document.activeElement.tagName === "INPUT"){
      return;
    }

    var pageIds = order.filter(function(id){ return cardsById[id] && pageOf(cardsById[id]) === activePage; });
    var total = pageIds.length;
    var visIds = pageIds.filter(function(id){ return matchesFilters(cardsById[id]); });

    document.getElementById("countPill").textContent =
      (searchTerm || priorityFilterVal || sourceFilterVal) ? (visIds.length + " of " + total + " shown") : (total + " candidates");

    if (visIds.length === 0){
      var emptyMsg = total === 0
        ? (activePage === "rejected_claude" ? "Empty — the auto-discard automation is paused, so nothing lands here yet." : "No candidates on this page")
        : "No matches";
      table.innerHTML = '<tr><td class="sheet-empty">'+escapeHtml(emptyMsg)+'</td></tr>';
      return;
    }

    var head =
      '<thead><tr>' +
        '<th></th><th>Candidate</th><th>Role</th><th>Stage</th><th>Priority</th><th>Source</th>' +
        '<th>Owner</th><th>Contacted</th><th>Follow-up</th><th>Next action</th><th>in</th><th>💬</th>' +
      '</tr></thead>';

    var rows = visIds.map(function(id, i){
      var c = cardsById[id];
      var liCell = c.linkedin
        ? '<a class="li-link" href="'+escapeHtml(c.linkedin)+'" target="_blank" rel="noopener noreferrer" title="Open LinkedIn profile">in</a>'
        : '';
      var nComments = commentsCache[id] ? commentsCache[id].length : "";
      return '<tr>' +
        '<td class="sc-idx">'+(i+1)+'</td>' +
        '<td class="sc-name" data-open="'+escapeHtml(id)+'">'+(c.needsReview?"🔎 ":"")+escapeHtml(c.name)+'</td>' +
        '<td class="sc-role" title="'+escapeHtml(c.role||"")+'">'+escapeHtml(c.role||"")+'</td>' +
        '<td><select data-id="'+escapeHtml(id)+'" data-field="stage">'+fieldOptionsHtml(STAGES, c.stage)+'</select></td>' +
        '<td><select data-id="'+escapeHtml(id)+'" data-field="priority">'+fieldOptionsHtml(PRIORITIES, c.priority)+'</select></td>' +
        '<td><select data-id="'+escapeHtml(id)+'" data-field="source">'+fieldOptionsHtml(SOURCES, c.source||"Lead")+'</select></td>' +
        '<td><input type="text" data-id="'+escapeHtml(id)+'" data-field="owner" value="'+escapeHtml(c.owner||"")+'" placeholder="—"></td>' +
        '<td><select data-id="'+escapeHtml(id)+'" data-field="contacted">'+fieldOptionsHtml(CONTACTED_OPTS, c.contacted||"No")+'</select></td>' +
        '<td><select data-id="'+escapeHtml(id)+'" data-field="followup">'+fieldOptionsHtml(FOLLOWUPS, c.followup)+'</select></td>' +
        '<td><input type="text" data-id="'+escapeHtml(id)+'" data-field="nextAction" value="'+escapeHtml(c.nextAction||"")+'" placeholder="—"></td>' +
        '<td class="sc-li">'+liCell+'</td>' +
        '<td class="sc-comments" data-open="'+escapeHtml(id)+'">'+nComments+'</td>' +
      '</tr>';
    }).join("");

    table.innerHTML = head + "<tbody>" + rows + "</tbody>";

    table.querySelectorAll("select[data-field]").forEach(function(el){
      el.addEventListener("change", function(){ saveField(el.dataset.id, el.dataset.field, el.value); });
    });
    table.querySelectorAll("input[data-field]").forEach(function(el){
      el.addEventListener("input", debounce(function(){ saveField(el.dataset.id, el.dataset.field, el.value); }, 500));
    });
    table.querySelectorAll("[data-open]").forEach(function(el){
      el.addEventListener("click", function(){ openCard(el.dataset.open); });
    });

    visIds.forEach(function(id){ if (db && !(id in commentsCache)) fetchCommentCount(id); });
  }

  function initials(name){
    var parts = String(name||"").trim().split(/\s+/).filter(Boolean);
    if (parts.length === 0) return "?";
    if (parts.length === 1) return parts[0].slice(0,2).toUpperCase();
    return (parts[0][0] + parts[parts.length-1][0]).toUpperCase();
  }

  function renderCard(c){
    var card = document.createElement("div");
    card.className = "card";
    card.draggable = true;
    card.dataset.id = c.id;

    var top = document.createElement("div");
    top.className = "card-top";
    var idWrap = document.createElement("div");
    idWrap.className = "card-id";
    var avatar = document.createElement("div");
    avatar.className = "card-avatar";
    avatar.textContent = initials(c.name);
    idWrap.appendChild(avatar);
    var nameWrap = document.createElement("div");
    nameWrap.className = "card-name-wrap";
    var name = document.createElement("div");
    name.className = "card-name";
    name.textContent = c.name;
    nameWrap.appendChild(name);
    idWrap.appendChild(nameWrap);
    top.appendChild(idWrap);
    card.appendChild(top);

    var role = document.createElement("div");
    role.className = "card-role";
    role.textContent = c.role || "";
    card.appendChild(role);

    var tags = document.createElement("div");
    tags.className = "card-tags";
    var ptag = document.createElement("span");
    ptag.className = "tag prio-" + (c.priority||"Medium").toLowerCase();
    ptag.textContent = c.priority || "Medium";
    tags.appendChild(ptag);
    var stag = document.createElement("span");
    var srcVal = c.source || "Lead";
    stag.className = "tag src-" + srcVal.toLowerCase();
    stag.textContent = srcVal;
    tags.appendChild(stag);
    if (c.contacted === "Yes"){
      var ctag = document.createElement("span");
      ctag.className = "tag contacted";
      ctag.textContent = "Contacted";
      tags.appendChild(ctag);
    }
    if (c.followup && c.followup !== "Not yet"){
      var ftag = document.createElement("span");
      ftag.className = "tag fu";
      ftag.textContent = c.followup;
      tags.appendChild(ftag);
    }
    if (c.needsReview){
      var rtag = document.createElement("span");
      rtag.className = "tag needs-review";
      rtag.textContent = "🔎 Needs review";
      tags.appendChild(rtag);
    }
    if (c.rejectedReason === "missed_interview"){
      var mtag = document.createElement("span");
      mtag.className = "tag needs-review";
      mtag.textContent = "Missed the interview";
      tags.appendChild(mtag);
    }
    if (c.stage === "Contacted" && c.contactStatus){
      var ctag = document.createElement("span");
      ctag.className = "tag " + (c.contactStatus === "answered" ? "answered" : "no-response");
      ctag.textContent = c.contactStatus === "answered" ? "Answered" : "Didn't answer";
      tags.appendChild(ctag);
    }
    card.appendChild(tags);

    var foot = document.createElement("div");
    foot.className = "card-foot";
    var owner = document.createElement("span");
    owner.className = "owner";
    owner.textContent = c.owner ? ("Owner: " + c.owner) : "";
    var right = document.createElement("span");
    right.className = "comments";
    if (c.linkedin){
      var li = document.createElement("a");
      li.className = "li-link";
      li.href = c.linkedin;
      li.target = "_blank";
      li.rel = "noopener noreferrer";
      li.title = "Open LinkedIn profile";
      li.textContent = "in";
      li.addEventListener("click", function(e){ e.stopPropagation(); });
      right.appendChild(li);
    }
    var commentsSpan = document.createElement("span");
    commentsSpan.textContent = "💬 " + (commentsCache[c.id] ? commentsCache[c.id].length : "");
    right.appendChild(commentsSpan);
    foot.appendChild(owner);
    foot.appendChild(right);
    card.appendChild(foot);

    card.addEventListener("dragstart", function(e){
      e.dataTransfer.setData("text/plain", c.id);
      card.classList.add("dragging");
    });
    card.addEventListener("dragend", function(){ card.classList.remove("dragging"); });
    card.addEventListener("click", function(){ openCard(c.id); });

    // prefetch comment count once
    if (db && !(c.id in commentsCache)) fetchCommentCount(c.id);

    return card;
  }

  function updateCommentBadges(id){
    var n = commentsCache[id] ? commentsCache[id].length : 0;
    var cardEl = document.querySelector('.card[data-id="'+cssEscape(id)+'"] .comments');
    if (cardEl) cardEl.textContent = "💬 " + n;
    var sheetEl = document.querySelector('.sc-comments[data-open="'+cssEscape(id)+'"]');
    if (sheetEl) sheetEl.textContent = n || "";
  }

  function fetchCommentCount(id){
    commentsCache[id] = commentsCache[id] || [];
    db.doc("cards/"+id).collection("comments").orderBy("ts","asc").limit(200).get()
      .then(function(qs){
        commentsCache[id] = qs.docs.map(function(d){ return Object.assign({id:d.id}, d.data()); });
        updateCommentBadges(id);
      }).catch(function(){});
  }

  // A stage change made through the UI (drag, or a Stage dropdown) is always
  // a human decision, so it always tags rejectedBy "us". The "claude" tag is
  // reserved for the (currently paused) auto-discard automation, which will
  // write it directly via the data layer, bypassing this UI code entirely.
  function stagePatch(prevStage, newStage){
    var patch = {stage: newStage};
    if (newStage === "Rejected" && prevStage !== "Rejected") patch.rejectedBy = "us";
    else if (newStage !== "Rejected" && prevStage === "Rejected") patch.rejectedBy = null;
    return patch;
  }

  function moveCard(id, stage){
    var prev = cardsById[id] ? cardsById[id].stage : null;
    var patch = stagePatch(prev, stage);
    patch.lastTouchedAt = new Date().toISOString();
    if (cardsById[id]) Object.assign(cardsById[id], patch); // optimistic
    renderCurrentView();
    if (!db) return;
    db.doc("cards/"+id).update(patch).catch(function(err){
      if (cardsById[id] && prev) { cardsById[id].stage = prev; }
      renderCurrentView();
      showToast("Couldn't move that card (" + (err && err.code ? err.code : "error") + "). Please try again.");
    });
  }

  // Sub-categorizes a card within the Rejected-by-Us page — every card there
  // already has stage "Rejected", so this is a second, independent field
  // rather than another stage value. null means the plain "Rejected" bucket.
  function setRejectedReason(id, reason){
    var prev = cardsById[id] ? cardsById[id].rejectedReason : null;
    var patch = {rejectedReason: reason || null, lastTouchedAt: new Date().toISOString()};
    if (cardsById[id]) Object.assign(cardsById[id], patch);
    renderCurrentView();
    if (!db) return;
    db.doc("cards/"+id).update(patch).catch(function(err){
      if (cardsById[id]) cardsById[id].rejectedReason = prev;
      renderCurrentView();
      showToast("Couldn't move that card (" + (err && err.code ? err.code : "error") + "). Please try again.");
    });
  }

  // Moves a card into the Contacted stage (if it wasn't already there) and
  // sets its reply status in one write — see contactedSubColumns() above.
  function setContactStatus(id, status){
    var prev = cardsById[id] ? {stage: cardsById[id].stage, contactStatus: cardsById[id].contactStatus} : null;
    var patch = {stage: "Contacted", contactStatus: status || null, lastTouchedAt: new Date().toISOString()};
    if (cardsById[id]) Object.assign(cardsById[id], patch);
    renderCurrentView();
    if (!db) return;
    db.doc("cards/"+id).update(patch).catch(function(err){
      if (cardsById[id] && prev) Object.assign(cardsById[id], prev);
      renderCurrentView();
      showToast("Couldn't move that card (" + (err && err.code ? err.code : "error") + "). Please try again.");
    });
  }

  // Dropping a card on "Second Chance" (Rejected by Us page) sends it back
  // to Sourced on the Ongoing pipeline — same un-reject mechanics as dragging
  // a card's Stage off "Rejected" anywhere else (stagePatch clears
  // rejectedBy), plus clearing rejectedReason since it no longer applies.
  // lastTouchedAt resets too, so a Low-priority revival isn't immediately
  // swept up again by the stale-candidate cleanup.
  function sendToSecondChance(id){
    var prev = cardsById[id] ? {stage: cardsById[id].stage, rejectedBy: cardsById[id].rejectedBy, rejectedReason: cardsById[id].rejectedReason} : null;
    var patch = {stage: "Sourced", rejectedBy: null, rejectedReason: null, lastTouchedAt: new Date().toISOString()};
    if (cardsById[id]) Object.assign(cardsById[id], patch);
    renderCurrentView();
    if (!db) return;
    db.doc("cards/"+id).update(patch).then(function(){
      showToast("Sent back to Sourced on the Ongoing pipeline.");
    }).catch(function(err){
      if (cardsById[id] && prev) Object.assign(cardsById[id], prev);
      renderCurrentView();
      showToast("Couldn't move that card (" + (err && err.code ? err.code : "error") + "). Please try again.");
    });
  }

  function cssEscape(s){ return s.replace(/[^a-zA-Z0-9_-]/g, "\\$&"); }
  function escapeHtml(s){
    return String(s).replace(/[&<>"']/g, function(c){
      return {"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c];
    });
  }

  // ---------- modal ----------

  function openCard(id){
    modalMode = "view";
    openCardId = id;
    var c = cardsById[id];
    if (!c) return;
    nameEditing = !getViewerName();
    renderModalFields(c);
    document.getElementById("overlay").hidden = false;
    if (openCardUnsub) openCardUnsub();
    if (db){
      openCardUnsub = db.doc("cards/"+id).onSnapshot(function(snap){
        if (!snap.exists) return;
        cardsById[id] = Object.assign({id:id}, snap.data());
        if (openCardId === id) renderModalFields(cardsById[id]);
      });
      subscribeComments(id);
    }
  }

  function closeCard(){
    openCardId = null;
    document.getElementById("overlay").hidden = true;
    if (openCardUnsub){ openCardUnsub(); openCardUnsub = null; }
    if (commentsUnsub){ commentsUnsub(); commentsUnsub = null; }
  }

  document.getElementById("overlay").addEventListener("click", function(e){
    if (e.target.id !== "overlay") return;
    if (modalMode === "add") closeAddCandidateModal(); else closeCard();
  });
  document.addEventListener("keydown", function(e){
    if (e.key !== "Escape") return;
    if (modalMode === "add") closeAddCandidateModal();
    else if (openCardId) closeCard();
  });

  // ---------- add candidate ----------
  // Manual intake: a teammate pastes a CV here, which saves a card flagged
  // needsReview:true (default stage "Sourced", so it's already on the
  // Ongoing page — pageOf() only routes to Rejected pages). Claude Code
  // reviews the pasted CV in a chat session (using scripts/list-pending.mjs
  // and scripts/submit-review.mjs) and fills in fitScore/priority/outcome,
  // clearing needsReview — there's no in-app AI call, since this standalone
  // build has no backend to hold an API key.

  function addCandidateModalHtml(){
    return '<div class="modal-head">' +
        '<h2>Add candidate</h2>' +
        '<button class="close-btn" id="closeAddBtn" aria-label="Close">&times;</button>' +
      '</div>' +
      '<p class="msg-hint" style="margin:0 0 14px;">Upload the candidate\'s CV as a PDF — the text is extracted right in your browser. It\'ll appear on the board flagged "Needs review" — ask Claude Code to review it and fill in the fit score, priority and notes.</p>' +
      '<div class="field-grid">' +
        '<div class="field full"><label>Name *</label><input type="text" id="ac_name" placeholder="Full name"></div>' +
        '<div class="field"><label>Role</label><input type="text" id="ac_role" placeholder="e.g. AI Engineer"></div>' +
        '<div class="field"><label>Source</label><select id="ac_source">'+fieldOptionsHtml(SOURCES, "Applied")+'</select></div>' +
        '<div class="field full"><label>LinkedIn URL</label><input type="text" id="ac_linkedin" placeholder="https://www.linkedin.com/in/…"></div>' +
        '<div class="field full">' +
          '<label>CV (PDF) *</label>' +
          '<input type="file" id="ac_cvFile" accept="application/pdf,.pdf">' +
          '<div class="draft-status" id="ac_cvStatus" style="margin-top:6px;"></div>' +
        '</div>' +
        '<div class="field full" id="ac_cvPreviewWrap" hidden>' +
          '<label>Extracted text (edit if anything looks off before saving)</label>' +
          '<textarea id="ac_cvPreview" rows="8"></textarea>' +
        '</div>' +
      '</div>' +
      '<div class="save-hint" id="addCandidateHint"></div>' +
      '<div class="draft-btn-row">' +
        '<button type="button" class="draft-btn" id="ac_submit">Add to pipeline</button>' +
        '<button type="button" class="draft-btn secondary" id="ac_cancel">Cancel</button>' +
      '</div>';
  }

  function openAddCandidateModal(){
    modalMode = "add";
    if (openCardUnsub){ openCardUnsub(); openCardUnsub = null; }
    if (commentsUnsub){ commentsUnsub(); commentsUnsub = null; }
    openCardId = null;
    document.getElementById("modal").innerHTML = addCandidateModalHtml();
    document.getElementById("overlay").hidden = false;
    document.getElementById("closeAddBtn").addEventListener("click", closeAddCandidateModal);
    document.getElementById("ac_cancel").addEventListener("click", closeAddCandidateModal);
    document.getElementById("ac_submit").addEventListener("click", submitAddCandidate);
    document.getElementById("ac_cvFile").addEventListener("change", handleCvFileSelected);
    document.getElementById("ac_name").focus();
  }

  // Reads the uploaded PDF fully in the browser (pdf.js) and pulls out its
  // text layer — there's no server to send the file to (Firebase Storage
  // needs the paid Blaze plan), so this is the only extraction step there is.
  // Scanned/image-only PDFs have no text layer and will extract as empty or
  // near-empty; the status line below flags that so it's not silently wrong.
  async function handleCvFileSelected(e){
    var file = e.target.files && e.target.files[0];
    var status = document.getElementById("ac_cvStatus");
    var previewWrap = document.getElementById("ac_cvPreviewWrap");
    var previewEl = document.getElementById("ac_cvPreview");
    if (!file) return;

    if (typeof pdfjsLib === "undefined"){
      if (status){ status.textContent = "PDF reader failed to load — check your connection and try again."; status.classList.add("err"); }
      return;
    }

    if (status){ status.textContent = "Reading PDF…"; status.classList.remove("err"); }
    previewWrap.hidden = true;

    try {
      var buf = await file.arrayBuffer();
      var pdf = await pdfjsLib.getDocument({ data: buf }).promise;
      var pages = [];
      for (var i = 1; i <= pdf.numPages; i++){
        var page = await pdf.getPage(i);
        var content = await page.getTextContent();
        pages.push(content.items.map(function(it){ return it.str; }).join(" "));
      }
      var text = pages.join("\n\n").replace(/[ \t]+/g, " ").trim();

      previewEl.value = text;
      previewWrap.hidden = false;

      if (text.length < 40){
        if (status){
          status.textContent = "Only found " + text.length + " characters of text — this PDF may be a scanned image. You can edit the box below by hand, or try a different file.";
          status.classList.add("err");
        }
      } else if (status){
        status.textContent = "Extracted " + text.length + " characters from " + pdf.numPages + " page" + (pdf.numPages === 1 ? "" : "s") + ".";
        status.classList.remove("err");
      }
    } catch(err){
      if (status){
        status.textContent = "Couldn't read that PDF (" + (err && err.message ? err.message : "error") + "). Try a different file.";
        status.classList.add("err");
      }
    }
  }

  function closeAddCandidateModal(){
    modalMode = "view";
    document.getElementById("overlay").hidden = true;
  }

  function nextRank(){
    var max = 0;
    order.forEach(function(id){ var r = cardsById[id] && cardsById[id].rank; if (r && r > max) max = r; });
    return max + 1;
  }

  async function submitAddCandidate(){
    var hint = document.getElementById("addCandidateHint");
    var name = document.getElementById("ac_name").value.trim();
    var previewEl = document.getElementById("ac_cvPreview");
    var cvText = previewEl ? previewEl.value.trim() : "";
    var cvFile = document.getElementById("ac_cvFile").files[0];
    if (!name || !cvFile){
      if (hint) hint.textContent = "Name and a CV PDF are both required.";
      return;
    }
    if (!cvText){
      if (hint) hint.textContent = "No text was extracted from that PDF yet — wait for extraction to finish, or try a different file.";
      return;
    }
    if (!db){
      if (hint) hint.textContent = "Not connected — can't save right now.";
      return;
    }
    var role = document.getElementById("ac_role").value.trim();
    var linkedin = document.getElementById("ac_linkedin").value.trim();
    var source = document.getElementById("ac_source").value;

    var btn = document.getElementById("ac_submit");
    btn.disabled = true;
    if (hint) hint.textContent = "Saving…";

    var id = slugify(name);
    try {
      var existing = await db.doc("cards/"+id).get();
      if (existing.exists) id = id + "-" + Date.now().toString().slice(-5);

      await db.collection("cards").doc(id).set({
        name: name,
        role: role,
        linkedin: linkedin,
        source: source,
        stage: "Sourced",
        priority: "Medium",
        fitScore: null,
        owner: "",
        contacted: "No",
        lastContact: "",
        nextAction: "",
        followup: "Not yet",
        outcome: "",
        cvText: cvText,
        cvFileName: cvFile.name,
        // Which pipeline this candidate belongs to — this file only ever
        // serves the AI Engineer opening, so it's hardcoded here. A future
        // opening's own board page would stamp its own value instead. This
        // is the field the Talent Pool (openings landing page) groups by.
        opening: "AI Engineer",
        needsReview: true,
        addedBy: getViewerName() || "",
        rank: nextRank(),
        lastTouchedAt: new Date().toISOString()
      });
      closeAddCandidateModal();
      showToast("Candidate added — ask Claude Code to review the CV when ready.");
    } catch(err){
      if (hint) hint.textContent = "Couldn't save (" + (err && err.code ? err.code : "error") + "). Try again.";
      btn.disabled = false;
    }
  }

  document.getElementById("addCandidateBtn").addEventListener("click", openAddCandidateModal);

  function fieldOptionsHtml(options, current){
    return options.map(function(o){
      return '<option value="'+escapeHtml(o)+'"'+(o===current?" selected":"")+'>'+escapeHtml(o)+'</option>';
    }).join("");
  }

  function renderModalFields(c){
    var modal = document.getElementById("modal");
    var scrollTop = 0;
    var existingCL = modal.querySelector(".comment-list");
    if (existingCL) scrollTop = existingCL.scrollTop;

    var liRow = c.linkedin
      ? '<a class="li-link-full" href="'+escapeHtml(c.linkedin)+'" target="_blank" rel="noopener noreferrer"><span class="li-badge">in</span>View LinkedIn profile ↗</a>'
      : '<span style="font-size:12px;color:var(--text-faint)">No LinkedIn link on file</span>';

    var srcVal = c.source || "Lead";

    modal.innerHTML =
      '<div class="modal-head">' +
        '<div class="modal-id"><div class="card-avatar modal-avatar">'+initials(c.name)+'</div><div><h2>'+escapeHtml(c.name)+'</h2><div class="modal-role">'+escapeHtml(c.role||"")+'</div></div></div>' +
        '<button class="close-btn" id="closeBtn" aria-label="Close">&times;</button>' +
      '</div>' +
      '<div class="fitscore-line">' +
        '<span class="tag prio-'+(c.priority||"Medium").toLowerCase()+'">'+escapeHtml(c.priority||"Medium")+' priority</span>' +
        '<span class="tag src-'+srcVal.toLowerCase()+'">'+escapeHtml(srcVal)+'</span>' +
        (c.stage === "Rejected" ? '<span class="tag" style="background:var(--gray-bg);color:var(--text-dim);">Rejected by '+(c.rejectedBy==="claude"?"Claude":"Us")+'</span>' : '') +
      '</div>' +
      '<div style="margin:-6px 0 14px;">'+liRow+'</div>' +
      (c.needsReview ? '<div class="cv-banner">⏳ Awaiting review — ask Claude Code to review this candidate\'s CV and fill in fit score, priority and notes.</div>' : '') +
      (c.cvText ? '<div class="field full" style="margin-bottom:10px;"><label>CV text'+(c.cvFileName?' (from '+escapeHtml(c.cvFileName)+')':'')+'</label><textarea readonly rows="6" style="opacity:.85;">'+escapeHtml(c.cvText)+'</textarea></div>' : '') +
      '<div class="field-grid">' +
        '<div class="field"><label>Stage</label><select id="f_stage">'+fieldOptionsHtml(STAGES, c.stage)+'</select></div>' +
        '<div class="field"><label>Priority</label><select id="f_priority">'+fieldOptionsHtml(PRIORITIES, c.priority)+'</select></div>' +
        '<div class="field"><label>Source</label><select id="f_source">'+fieldOptionsHtml(SOURCES, srcVal)+'</select></div>' +
        '<div class="field"><label>Owner</label><input type="text" id="f_owner" value="'+escapeHtml(c.owner||"")+'" placeholder="Who\'s driving this"></div>' +
        '<div class="field"><label>Contacted</label><select id="f_contacted">'+fieldOptionsHtml(CONTACTED_OPTS, c.contacted||"No")+'</select></div>' +
        '<div class="field"><label>Last contact</label><input type="date" id="f_lastContact" value="'+escapeHtml(toDateInputValue(c.lastContact))+'"></div>' +
        '<div class="field"><label>Follow-up status</label><select id="f_followup">'+fieldOptionsHtml(FOLLOWUPS, c.followup)+'</select></div>' +
        '<div class="field"><label>Next action</label><input type="text" id="f_nextAction" value="'+escapeHtml(c.nextAction||"")+'" placeholder="e.g. Schedule tech interview"></div>' +
        '<div class="field full"><label>LinkedIn URL</label><input type="text" id="f_linkedin" value="'+escapeHtml(c.linkedin||"")+'" placeholder="https://www.linkedin.com/in/…"></div>' +
        '<div class="field full"><label>Outcome / notes</label><textarea id="f_outcome" placeholder="Interview feedback, decision, offer terms…">'+escapeHtml(c.outcome||"")+'</textarea></div>' +
      '</div>' +
      '<div class="save-hint" id="saveHint"></div>' +
      messagingSectionHtml(c) +
      '<div class="comments-section">' +
        '<h3>Internal comments</h3>' +
        '<div class="name-inline" id="nameInline"></div>' +
        '<div class="comment-list" id="commentList"><div class="comment-empty">Loading…</div></div>' +
        '<div class="comment-form">' +
          '<textarea id="commentInput" placeholder="Leave a note for the team…"></textarea>' +
          '<button type="button" id="commentSend">Post</button>' +
        '</div>' +
        '<div class="comment-form-hint" id="commentFormHint"></div>' +
      '</div>';

    document.getElementById("closeBtn").addEventListener("click", closeCard);

    var fields = ["stage","priority","source","owner","contacted","lastContact","followup","nextAction","outcome","linkedin"];
    var debouncedFields = {owner:1, nextAction:1, outcome:1, linkedin:1};
    fields.forEach(function(f){
      var el = document.getElementById("f_"+f);
      var evt = (el.tagName === "SELECT") ? "change" : "input";
      var handler = debounce(function(){ saveField(c.id, f, el.value); }, debouncedFields[f] ? 500 : 0);
      el.addEventListener(evt, handler);
    });

    wireMessagingSection(c);

    renderNameInline();
    renderComments(c.id);

    document.getElementById("commentSend").addEventListener("click", function(){ postComment(c.id); });
    document.getElementById("commentInput").addEventListener("keydown", function(e){
      if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) postComment(c.id);
    });

    if (existingCL){
      var newCL = document.getElementById("commentList");
      if (newCL) newCL.scrollTop = scrollTop;
    }
  }

  function toDateInputValue(v){
    if (!v) return "";
    if (/^\d{4}-\d{2}-\d{2}$/.test(v)) return v;
    var d = new Date(v);
    if (isNaN(d.getTime())) return "";
    return d.toISOString().slice(0,10);
  }

  function debounce(fn, ms){
    var t = null;
    return function(){
      var args = arguments;
      if (t) clearTimeout(t);
      if (ms === 0){ fn.apply(null, args); return; }
      t = setTimeout(function(){ fn.apply(null, args); }, ms);
    };
  }

  function saveField(id, field, value){
    var patch;
    if (field === "stage"){
      var prevStage = cardsById[id] ? cardsById[id].stage : null;
      patch = stagePatch(prevStage, value);
    } else {
      patch = {}; patch[field] = value;
    }
    // Any edit counts as human attention, which resets the staleness clock
    // the auto-discard sweep (scripts/auto-reject-stale.mjs) reads from.
    patch.lastTouchedAt = new Date().toISOString();
    if (cardsById[id]) Object.assign(cardsById[id], patch);
    var hint = document.getElementById("saveHint");
    if (!db){ if (hint) hint.textContent = "Not connected — change not saved."; return; }
    if (hint) hint.textContent = "Saving…";
    db.doc("cards/"+id).update(patch).then(function(){
      if (hint && openCardId === id) hint.textContent = "Saved";
      renderCurrentView();
    }).catch(function(err){
      if (hint && openCardId === id) hint.textContent = "Couldn't save (" + err.code + ")";
    });
  }

  // ---------- candidate messaging ----------
  // Always available (any stage). A teammate writes — or pulls in from the
  // internal comment thread below — a short internal note, picks a tone
  // (positive: moving forward / offer; negative: not moving forward), and
  // Claude drafts a candidate-facing email from it. Nothing sends
  // automatically; the recruiter copies it into their own mail client.

  function defaultToneForStage(stage){
    return (stage === "Rejected" || stage === "On Hold") ? "negative" : "positive";
  }

  function messagingSectionHtml(c){
    var tone = c.messageTone || defaultToneForStage(c.stage);
    var note = (c.messageNote != null ? c.messageNote : c.rejectionNote) || "";
    var draft = (c.candidateEmailDraft != null ? c.candidateEmailDraft : c.rejectionEmailDraft) || "";
    return '<div class="msg-section">' +
      '<h3>Candidate messaging</h3>' +
      '<p class="msg-hint">Write an internal note about this candidate — or pull in the latest internal comment below — pick a tone, and Claude drafts a short, honest email you copy into your own mail client. Nothing here is sent automatically.</p>' +
      '<div class="tone-pills" id="tonePills">' +
        '<button type="button" class="tone-pill'+(tone==="positive"?" active":"")+'" data-tone="positive">Positive — moving forward</button>' +
        '<button type="button" class="tone-pill'+(tone==="negative"?" active":"")+'" data-tone="negative">Negative — not moving forward</button>' +
      '</div>' +
      '<div class="field full">' +
        '<label>Internal note (what happened / why)</label>' +
        '<textarea id="f_messageNote" placeholder="e.g. Great technical interview, moving to offer stage next week. Or: Strong Python fundamentals but no production LLM/agent experience.">'+escapeHtml(note)+'</textarea>' +
        '<button type="button" class="draft-btn secondary" id="useCommentBtn" style="margin-top:6px;">Use latest internal comment</button>' +
      '</div>' +
      '<div class="draft-btn-row">' +
        '<button type="button" class="draft-btn" id="draftEmailBtn">Draft candidate email</button>' +
        '<span class="draft-status" id="draftStatus"></span>' +
      '</div>' +
      '<div class="email-output" id="emailOutputWrap"' + (draft ? '' : ' hidden') + '>' +
        '<textarea id="f_candidateEmailDraft" rows="7">'+escapeHtml(draft)+'</textarea>' +
        '<div class="draft-btn-row">' +
          '<button type="button" class="draft-btn secondary" id="copyEmailBtn">Copy</button>' +
          '<span class="copy-hint" id="copyHint">Or click into the box, Cmd/Ctrl+A, Cmd/Ctrl+C.</span>' +
        '</div>' +
      '</div>' +
    '</div>';
  }

  function wireMessagingSection(c){
    document.querySelectorAll("#tonePills .tone-pill").forEach(function(btn){
      btn.addEventListener("click", function(){
        document.querySelectorAll("#tonePills .tone-pill").forEach(function(b){ b.classList.toggle("active", b === btn); });
        saveField(c.id, "messageTone", btn.dataset.tone);
      });
    });

    var noteEl = document.getElementById("f_messageNote");
    if (noteEl){
      noteEl.addEventListener("input", debounce(function(){
        saveField(c.id, "messageNote", noteEl.value);
      }, 500));
    }

    var useCommentBtn = document.getElementById("useCommentBtn");
    if (useCommentBtn){
      useCommentBtn.addEventListener("click", function(){
        var items = commentsCache[c.id] || [];
        var status = document.getElementById("draftStatus");
        if (items.length === 0){
          if (status){ status.textContent = "No internal comments yet — post one below first."; status.classList.add("err"); }
          return;
        }
        var latest = items[items.length - 1];
        if (noteEl){
          noteEl.value = latest.text || "";
          saveField(c.id, "messageNote", noteEl.value);
        }
        if (status){ status.textContent = "Pulled in the latest comment — review, then draft."; status.classList.remove("err"); }
      });
    }

    var draftEl = document.getElementById("f_candidateEmailDraft");
    if (draftEl){
      draftEl.addEventListener("input", debounce(function(){
        saveField(c.id, "candidateEmailDraft", draftEl.value);
      }, 500));
    }

    var copyBtn = document.getElementById("copyEmailBtn");
    if (copyBtn){
      copyBtn.addEventListener("click", function(){
        var ta = document.getElementById("f_candidateEmailDraft");
        if (!ta) return;
        ta.focus();
        ta.select();
        var hint = document.getElementById("copyHint");
        try {
          navigator.clipboard.writeText(ta.value).then(function(){
            if (hint) hint.textContent = "Copied to clipboard.";
          }).catch(function(){
            if (hint) hint.textContent = "Selected — press Cmd/Ctrl+C to copy.";
          });
        } catch(e){
          if (hint) hint.textContent = "Selected — press Cmd/Ctrl+C to copy.";
        }
      });
    }

    var draftBtn = document.getElementById("draftEmailBtn");
    if (draftBtn){
      draftBtn.addEventListener("click", function(){ draftCandidateEmail(c.id); });
    }
  }

  function buildEmailPrompt(c, tone, note){
    var base = "You are helping a startup recruiter write a short, honest email to a job candidate. " +
      "Do not invent facts. Do not mention internal scores, rankings, priority tiers, pipeline stage names, or the word 'fit score'. " +
      "Candidate name: " + (c.name || "the candidate") + ". " +
      "Role they're being considered for: " + (c.role || "the role") + ". " +
      "Internal note (context only — rephrase naturally in your own words, don't quote it verbatim): " + note + ". " +
      "Write 90-130 words. No subject line. No greeting boilerplate beyond a simple 'Hi <name>,'. " +
      "End with a simple sign-off like 'Best,' followed by '[Your name]' on its own line. Output ONLY the email body, nothing else. ";

    if (tone === "negative"){
      return base + "Tone: warm, direct, respectful of their time — not corporate, not falsely encouraging, not harsh. " +
        "This email tells the candidate we are not moving forward with their application right now.";
    }
    return base + "Tone: genuinely warm and encouraging, but not gushing or over-promising anything the note doesn't say. " +
      "This email shares positive news based on the note (e.g. advancing to a next step, an offer, or other good progress).";
  }

  async function draftCandidateEmail(id){
    var c = cardsById[id];
    if (!c) return;
    var status = document.getElementById("draftStatus");
    var noteEl = document.getElementById("f_messageNote");
    var note = noteEl ? noteEl.value.trim() : ((c.messageNote != null ? c.messageNote : c.rejectionNote) || "");
    var activePill = document.querySelector("#tonePills .tone-pill.active");
    var tone = activePill ? activePill.dataset.tone : (c.messageTone || defaultToneForStage(c.stage));

    if (!note){
      if (status){ status.textContent = "Add an internal note above first (or pull in the latest comment)."; status.classList.add("err"); }
      if (noteEl) noteEl.focus();
      return;
    }
    if (status){ status.textContent = ""; status.classList.remove("err"); }

    var samp = null;
    // AI email drafting used Claude's built-in "sample" capability, which
    // only exists inside Claude's own artifact runtime. It's not available
    // in this standalone build, so this always falls through to the
    // "write it directly below" message a few lines down. To bring AI
    // drafting back here, add a small serverless function that calls the
    // Anthropic API (never call it directly from the browser — that would
    // expose your API key) and swap this block to call that function.
    try {
      if (typeof claude !== "undefined") samp = await claude.use("sample");
    } catch(e){ samp = null; }
    if (!samp){
      if (status){ status.textContent = "AI drafting isn't available in this view — write the email directly below."; status.classList.add("err"); }
      var wrap = document.getElementById("emailOutputWrap");
      if (wrap) wrap.hidden = false;
      return;
    }

    var btn = document.getElementById("draftEmailBtn");
    if (btn) btn.disabled = true;
    if (status) status.textContent = "Drafting…";
    var wrap = document.getElementById("emailOutputWrap");
    if (wrap) wrap.hidden = false;
    var outTa = document.getElementById("f_candidateEmailDraft");

    var prompt = buildEmailPrompt(c, tone, note);

    try {
      var res = await samp(prompt, {
        modelTier: "default",
        onText: function(ev){ if (outTa) outTa.value = ev.text; }
      });
      if (outTa) outTa.value = res.text;
      saveField(id, "candidateEmailDraft", res.text);
      if (status) status.textContent = res.truncated ? "Drafted (truncated — feel free to edit)." : "Drafted — edit freely, then copy.";
    } catch(err){
      if (status){
        status.textContent = "Couldn't draft the email (" + (err && err.code ? err.code : "error") + "). Try again, or write it directly below.";
        status.classList.add("err");
      }
    } finally {
      if (btn) btn.disabled = false;
    }
  }

  var commentsUnsub = null;

  function subscribeComments(id){
    if (commentsUnsub) commentsUnsub();
    commentsUnsub = db.doc("cards/"+id).collection("comments").orderBy("ts","asc").limit(200)
      .onSnapshot(function(qs){
        commentsCache[id] = qs.docs.map(function(d){ return Object.assign({id:d.id}, d.data()); });
        if (openCardId === id) renderComments(id);
        updateCommentBadges(id);
      }, function(){});
  }

  function renderComments(id){
    var list = document.getElementById("commentList");
    if (!list) return;
    var items = commentsCache[id] || [];
    if (items.length === 0){
      list.innerHTML = '<div class="comment-empty">No comments yet — be the first to leave one.</div>';
      return;
    }
    list.innerHTML = items.map(function(it){
      var when = "";
      try { when = new Date(it.ts).toLocaleString(); } catch(e){}
      return '<div class="comment-item"><span class="ca">'+escapeHtml(it.author||"Someone")+'</span>' +
        '<span class="ct">'+escapeHtml(when)+'</span>' +
        '<div class="cb">'+escapeHtml(it.text||"")+'</div></div>';
    }).join("");
    list.scrollTop = list.scrollHeight;
  }

  function renderNameInline(){
    var el = document.getElementById("nameInline");
    if (!el) return;
    var n = getViewerName();

    if (n && !nameEditing){
      el.innerHTML = 'Posting as <strong>'+escapeHtml(n)+'</strong> · <button type="button" id="changeName">change</button>';
      var btn = document.getElementById("changeName");
      if (btn) btn.addEventListener("click", function(){ nameEditing = true; renderNameInline(); });
      return;
    }

    // Edit mode: an inline field instead of a browser prompt() dialog, which
    // this embedded view blocks silently (dialogs never appear, and the
    // return value is empty) — that silent block was why comments couldn't
    // be posted before.
    el.innerHTML =
      '<div class="name-edit-row">' +
        '<input type="text" id="nameInput" placeholder="Your name" value="'+escapeHtml(n||"")+'">' +
        '<button type="button" id="saveName">Save</button>' +
      '</div>' +
      '<div>So teammates know who left each comment.</div>';
    var input = document.getElementById("nameInput");
    var saveBtn = document.getElementById("saveName");
    function commitName(){
      var v = input.value.trim();
      if (!v) { input.focus(); return; }
      setViewerName(v);
      nameEditing = false;
      renderNameInline();
      var hint = document.getElementById("commentFormHint");
      if (hint) hint.textContent = "";
    }
    if (saveBtn) saveBtn.addEventListener("click", commitName);
    if (input){
      input.addEventListener("keydown", function(e){
        if (e.key === "Enter"){ e.preventDefault(); commitName(); }
      });
      if (document.activeElement !== input) input.focus();
    }
  }

  function postComment(id){
    var input = document.getElementById("commentInput");
    var hint = document.getElementById("commentFormHint");
    var text = input.value.trim();
    if (!text) return;

    var author = getViewerName();
    if (!author){
      nameEditing = true;
      renderNameInline();
      if (hint) hint.textContent = "Enter your name above first, then press Post again.";
      return;
    }
    if (!db){
      if (hint) hint.textContent = "Not connected — comment can't be saved right now.";
      return;
    }

    var btn = document.getElementById("commentSend");
    btn.disabled = true;
    if (hint) { hint.textContent = "Posting…"; hint.classList.remove("err"); }
    db.doc("cards/"+id).collection("comments").add({
      text: text, author: author, ts: new Date().toISOString()
    }).then(function(){
      db.doc("cards/"+id).update({lastTouchedAt: new Date().toISOString()}).catch(function(){});
      input.value = "";
      btn.disabled = false;
      if (hint) hint.textContent = "";
    }).catch(function(err){
      btn.disabled = false;
      if (hint){
        hint.textContent = "Couldn't post comment (" + (err && err.code ? err.code : "error") + "). Try again.";
        hint.classList.add("err");
      }
    });
  }

  // ---------- toolbar ----------

  document.getElementById("search").addEventListener("input", function(e){
    searchTerm = normalizeSearch(e.target.value.trim());
    renderCurrentView();
  });
  document.querySelectorAll("#prioPills .prio-pill").forEach(function(btn){
    btn.addEventListener("click", function(){
      priorityFilterVal = btn.dataset.p || "";
      document.querySelectorAll("#prioPills .prio-pill").forEach(function(b){
        b.classList.toggle("active", b === btn);
      });
      renderCurrentView();
    });
  });
  document.getElementById("sourceFilter").addEventListener("change", function(e){
    sourceFilterVal = e.target.value;
    renderCurrentView();
  });
  document.querySelectorAll("#pageTabs .page-tab").forEach(function(btn){
    btn.addEventListener("click", function(){
      activePage = btn.dataset.page;
      document.querySelectorAll("#pageTabs .page-tab").forEach(function(b){ b.classList.toggle("active", b === btn); });
      var hintEl = document.getElementById("pageHint");
      if (hintEl) hintEl.textContent = PAGE_HINTS[activePage] || "";
      renderCurrentView();
    });
  });
  document.querySelectorAll("#viewTabs .view-tab").forEach(function(btn){
    btn.addEventListener("click", function(){
      activeView = btn.dataset.view;
      document.querySelectorAll("#viewTabs .view-tab").forEach(function(b){ b.classList.toggle("active", b === btn); });
      document.getElementById("boardViewWrap").hidden = activeView !== "board";
      document.getElementById("sheetViewWrap").hidden = activeView !== "sheet";
      renderCurrentView();
    });
  });

  // auth-guard.js (loaded before this file) holds off calling init() until
  // someone is actually signed in — Firestore rules now require it anyway,
  // so touching "cards" any earlier would just fail with permission-denied.
  if (window.onAuthReady) window.onAuthReady(init);
  else init();
})();