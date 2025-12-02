// public/gameui.js
const socket3 = window.socket;
let MY_SUBMITTED = false;
let TIMER_INTERVAL = null;
let CURRENT_PLAYER_COUNT = 1;

// Client Prediction Data
let CURRENT_TARGET = ""; 
let CURRENT_SYNONYMS = [];
let ALL_COUNTRIES_LIST = []; 
let ALL_SYNONYMS_MAP = {}; 

// Autocomplete State
let SUGGESTIONS = [];
let SUGGESTION_INDEX = 0;
let HINTS_ENABLED = true;

// --- CLIENT SIDE LOGIC ---
function clean(str) {
  if (!str || typeof str !== 'string') return "";
  return str.trim().toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]+/g, " ").replace(/\s+/g, " ").trim();
}

function levenshtein(a, b) {
  if (!a) return b ? b.length : 0;
  if (!b) return a ? a.length : 0;
  const m = a.length;
  const n = b.length;
  const dp = Array(m + 1).fill(0).map(() => Array(n + 1).fill(0));
  for (let i = 0; i <= m; i++) dp[i][0] = i;
  for (let j = 0; j <= n; j++) dp[0][j] = j;
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      dp[i][j] = Math.min(dp[i - 1][j] + 1, dp[i][j - 1] + 1, dp[i - 1][j - 1] + cost);
    }
  }
  return dp[m][n];
}

function checkLocalAnswer(input, targetRaw, synonyms) {
  if (!input || !targetRaw) return false;
  const inp = clean(input);
  const tgt = clean(targetRaw);
  
  if (inp === tgt) return true;
  if (Array.isArray(synonyms)) {
    for (let s of synonyms) {
      if (clean(s) === inp) return true;
    }
  }
  const dist = levenshtein(inp, tgt);
  const maxLen = Math.max(inp.length, tgt.length);
  const score = (1 - dist / maxLen) * 100;
  if (tgt.length <= 4) return score > 95;
  return score >= 85; 
}
// -------------------------------

// --- AUTOCOMPLETE LOGIC ---

// Receive Data on Connection
socket3.on("staticData", ({ countries, synonyms }) => {
    ALL_COUNTRIES_LIST = countries || [];
    ALL_SYNONYMS_MAP = synonyms || {};
});

// Settings Update
socket3.on("gameStarting", (settings) => {
    HINTS_ENABLED = (settings && settings.hints === false) ? false : true;
    
    // Reset UI
    show("game-screen");
    const img = document.getElementById("flag-img");
    img.src = ""; 
    img.classList.add("loading-hidden");
    const area = document.getElementById("flag-area");
    area.classList.remove("map-mode");
    document.getElementById("feedback-ticker").innerHTML = "";
    document.getElementById("progress-indicator").innerText = "";
    document.getElementById("timer-bar").style.width = "100%";
    document.getElementById("question-counter").innerText = "Get Ready!";
    
    // Reset Inputs
    const inp = document.getElementById("answer-input");
    inp.value = "";
    inp.className = ""; 
    document.getElementById("ghost-overlay").innerText = "";
    document.getElementById("next-suggestion-btn").classList.add("hidden");

    const overlay = document.getElementById("countdown-overlay");
    overlay.classList.remove("hidden");
    let count = 3;
    overlay.innerText = count;
    const countdownInt = setInterval(() => {
        count--;
        if (count > 0) overlay.innerText = count;
        else { clearInterval(countdownInt); overlay.classList.add("hidden"); }
    }, 500); 
});

// Update suggestions based on input
function updateSuggestions(typed) {
    if (!HINTS_ENABLED || !typed || typed.length < 1) {
        SUGGESTIONS = [];
        SUGGESTION_INDEX = 0;
        updateGhostText("");
        return;
    }

    const search = clean(typed);
    const matches = new Set();
    
    // 1. Official Names starting with input
    ALL_COUNTRIES_LIST.forEach(c => {
        if (clean(c).startsWith(search)) matches.add(c);
    });

    // 2. Synonyms starting with input (Deduplicate)
    Object.keys(ALL_SYNONYMS_MAP).forEach(key => {
        if (clean(key).startsWith(search)) {
            // "Unique Country Match" Strategy:
            // If the official name for this synonym is ALREADY matched, skip the synonym
            // e.g. User types "U". "United States" is matched. We skip "USA" synonym?
            // User requested: "Next" button cycles. 
            // Better logic: Show synonym only if it adds a distinct string option.
            
            // Actually, simplest is just add the key (e.g. "UAE")
            // But we don't want "United Arab Emirates" AND "UAE" in the list? 
            // User said: "Unique Country Match... Never show two options for the same country."
            
            const officialName = ALL_SYNONYMS_MAP[key];
            const officialClean = clean(officialName);
            
            // Check if we already have the official name in our set?
            // Actually, we store the *DISPLAY STRING* in the Set.
            
            let alreadyHasOfficial = false;
            for (let m of matches) {
                if (clean(m) === officialClean) alreadyHasOfficial = true;
            }

            // If we don't have the official name yet (maybe user typed "UA" and official is "United..."), 
            // then we add the SYNONYM to the list.
            if (!alreadyHasOfficial) {
                matches.add(key.toUpperCase()); // Show synonyms in caps usually looks better (UAE, USA)
            }
        }
    });

    SUGGESTIONS = Array.from(matches).sort();
    SUGGESTION_INDEX = 0;
    
    // Render first match
    if (SUGGESTIONS.length > 0) {
        updateGhostText(SUGGESTIONS[0]);
    } else {
        updateGhostText("");
    }
}

function updateGhostText(text) {
    const ghost = document.getElementById("ghost-overlay");
    const nextBtn = document.getElementById("next-suggestion-btn");
    
    if (!text) {
        ghost.innerText = "";
        nextBtn.classList.add("hidden");
        return;
    }
    
    ghost.innerText = text;
    // Only show "Next" if there are multiple options
    if (SUGGESTIONS.length > 1) nextBtn.classList.remove("hidden");
    else nextBtn.classList.add("hidden");
}

function cycleSuggestion() {
    if (SUGGESTIONS.length <= 1) return;
    SUGGESTION_INDEX = (SUGGESTION_INDEX + 1) % SUGGESTIONS.length;
    updateGhostText(SUGGESTIONS[SUGGESTION_INDEX]);
}

// -------------------------------

function addTickerItem(username, isGood) {
  const container = document.getElementById("feedback-ticker");
  const pill = document.createElement("div");
  pill.className = `ticker-pill ${isGood ? "pill-good" : "pill-bad"}`;
  pill.innerText = `${username} ${isGood ? "✓" : "✗"}`;
  container.appendChild(pill);
  setTimeout(() => {
    pill.style.opacity = "0";
    setTimeout(() => pill.remove(), 300);
  }, 2000);
}

socket3.on("gamePreload", ({ url }) => {
  if (url) { const hiddenImg = new Image(); hiddenImg.src = url; }
});

socket3.on("questionStart", ({ index, total, flagPath, timeLimit, playerCount, imageType, target, synonyms, remainingTime }) => {
  if (document.getElementById("game-screen").classList.contains("hidden")) {
    show("game-screen");
  }

  MY_SUBMITTED = false;
  CURRENT_PLAYER_COUNT = playerCount;
  CURRENT_TARGET = target;
  CURRENT_SYNONYMS = synonyms || [];
  
  document.getElementById("question-counter").innerText = `Q ${index} / ${total}`;
  const img = document.getElementById("flag-img");
  const area = document.getElementById("flag-area");
  img.classList.add("loading-hidden");
  if (imageType === 'map') area.classList.add("map-mode");
  else area.classList.remove("map-mode");
  img.src = flagPath;
  img.onload = () => { img.classList.remove("loading-hidden"); };

  document.getElementById("progress-indicator").innerText = `0/${playerCount} Answered`;
  document.getElementById("feedback-ticker").innerHTML = "";
  
  // Input Reset
  const inp = document.getElementById("answer-input");
  inp.value = "";
  inp.disabled = false;
  inp.className = "";
  inp.focus();
  document.getElementById("answer-btn").disabled = false;
  
  // Clear Ghost
  updateGhostText("");

  // Timer
  const bar = document.getElementById("timer-bar");
  if (TIMER_INTERVAL) clearInterval(TIMER_INTERVAL);
  const initialTime = (remainingTime !== undefined) ? remainingTime : timeLimit;
  bar.style.width = ((initialTime / timeLimit) * 100) + "%";
  const start = Date.now();
  TIMER_INTERVAL = setInterval(() => {
    const elapsed = (Date.now() - start) / 1000;
    const currentRemaining = Math.max(0, initialTime - elapsed);
    bar.style.width = ((currentRemaining / timeLimit) * 100) + "%";
    if (currentRemaining <= 0) clearInterval(TIMER_INTERVAL);
  }, 50);
});

function submitGuess() {
  if (MY_SUBMITTED) return;
  
  const inp = document.getElementById("answer-input");
  const ghost = document.getElementById("ghost-overlay");
  
  let val = inp.value.trim();
  
  // If Ghost text is visible and valid, prefer it
  if (HINTS_ENABLED && ghost.innerText && ghost.innerText.toLowerCase().startsWith(val.toLowerCase())) {
      val = ghost.innerText;
      inp.value = val; // visually fill it in
  }
  
  if (!val) return;
  
  MY_SUBMITTED = true;
  inp.disabled = true;
  document.getElementById("answer-btn").disabled = true;
  document.getElementById("next-suggestion-btn").classList.add("hidden");
  
  if (CURRENT_PLAYER_COUNT === 1) clearInterval(TIMER_INTERVAL);

  const isLikelyCorrect = checkLocalAnswer(val, CURRENT_TARGET, CURRENT_SYNONYMS);
  
  if (isLikelyCorrect) {
    inp.classList.add("input-correct");
    addTickerItem(window.USERNAME || "You", true);
  } else {
    inp.classList.add("input-wrong");
    addTickerItem(window.USERNAME || "You", false);
  }
  
  socket3.emit("submitAnswer", { answer: val });
}

// EVENT HANDLERS
const inputEl = document.getElementById("answer-input");

inputEl.oninput = (e) => {
    updateSuggestions(e.target.value);
};

inputEl.onkeydown = (e) => {
  if (e.key === "Enter") submitGuess();
  if (e.key === "Tab") {
      e.preventDefault(); // Don't lose focus
      cycleSuggestion(); // Or select current? User asked for Next button, Tab cycling is a nice bonus.
  }
};

document.getElementById("next-suggestion-btn").onclick = () => {
    cycleSuggestion();
    inputEl.focus(); // Keep focus on input
};

document.getElementById("answer-btn").onclick = submitGuess;

socket3.on("answerResult", ({ correct }) => {
  const inp = document.getElementById("answer-input");
  const hasCorrect = inp.classList.contains("input-correct");
  const hasWrong = inp.classList.contains("input-wrong");

  if ((!hasCorrect && !hasWrong) || (correct && hasWrong) || (!correct && hasCorrect)) {
      inp.classList.remove("input-correct", "input-wrong");
      if (correct) inp.classList.add("input-correct");
      else inp.classList.add("input-wrong");
  }
});

socket3.on("playerUpdate", ({ username, isCorrect, answeredCount, totalPlayers }) => {
  document.getElementById("progress-indicator").innerText = `${answeredCount}/${totalPlayers} Answered`;
  if (username !== (window.USERNAME || "You")) {
     addTickerItem(username, isCorrect);
  }
});

socket3.on("questionEnd", ({ correctCountry, preload }) => {
  clearInterval(TIMER_INTERVAL);
  const container = document.getElementById("feedback-ticker");
  container.innerHTML = ""; 
  const ansPill = document.createElement("div");
  ansPill.className = "ticker-pill pill-answer";
  ansPill.innerText = correctCountry;
  container.appendChild(ansPill);
  if (preload && preload.url) { const hiddenImg = new Image(); hiddenImg.src = preload.url; }
});

socket3.on("gameOver", ({ leaderboard }) => {
  show("game-over-screen");
  const tbody = document.getElementById("leaderboard-body");
  tbody.innerHTML = "";
  if (Array.isArray(leaderboard) && leaderboard.length > 0) {
    leaderboard.forEach((entry, idx) => {
      const tr = document.createElement("tr");
      let avgTimeStr = entry.points > 0 ? ((entry.totalTime / entry.points) / 1000).toFixed(2) + "s" : "-";
      tr.innerHTML = `<td>${idx + 1}${idx === 0 ? " 🏆" : ""}</td><td style="text-align:left; padding-left:15px;">${entry.username}</td><td>${entry.points}</td><td>${avgTimeStr}</td>`;
      tbody.appendChild(tr);
    });
  } else { tbody.innerHTML = "<tr><td colspan='4'>No stats</td></tr>"; }
});

document.getElementById("back-to-lobby-btn").onclick = () => {
  show("lobby-room");
  document.getElementById("ready-btn").innerText = "Ready";
};