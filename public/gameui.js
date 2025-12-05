const socket3 = window.socket;
let MY_SUBMITTED = false;
let TIMER_INTERVAL = null;

// Autocomplete Data
let ALL_COUNTRIES_LIST = []; 
let ALL_CAPITALS_LIST = []; 
let ALL_LANGUAGES_LIST = [];
let ALL_SYNONYMS_MAP = {}; 
let CURRENT_AUTOCOMPLETE_MODE = 'countries';

// Suggestion State
let SUGGESTIONS = [];
let SUGGESTION_INDEX = 0;
let HINTS_ENABLED = true;

// Client-Side Game State
let GAME_MANIFEST = [];
let CURRENT_Q_INDEX = 0;
let TIME_LIMIT = 10;
let IS_GAME_RUNNING = false;
let IS_MULTIPLAYER = false;
const IMAGE_CACHE = {}; 

// ----------------------------------
// UTILS & FUZZY
// ----------------------------------

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
  if (synonyms && Array.isArray(synonyms)) {
    for (let s of synonyms) if (clean(s) === inp) return true;
  }
  const dist = levenshtein(inp, tgt);
  const maxLen = Math.max(inp.length, tgt.length);
  const score = (1 - dist / maxLen) * 100;
  if (tgt.length <= 4) return score > 95;
  return score >= 85; 
}

// ----------------------------------
// PRELOADING LOGIC (ROLLING WINDOW)
// ----------------------------------

function preloadImage(url) {
  if (!url || IMAGE_CACHE[url]) return;
  const img = new Image();
  img.src = url;
  IMAGE_CACHE[url] = img;
}

function managePreloadBuffer(startIndex) {
  // Always load the next 3 assets into RAM
  for (let i = 1; i <= 3; i++) {
    const idx = startIndex + i;
    if (idx < GAME_MANIFEST.length) {
      const q = GAME_MANIFEST[idx];
      if (q.flagPath) preloadImage(q.flagPath);
    }
  }
}

// ----------------------------------
// GAME FLOW
// ----------------------------------

socket3.on("staticData", ({ countries, capitals, languages, synonyms }) => {
    ALL_COUNTRIES_LIST = countries || [];
    ALL_CAPITALS_LIST = capitals || [];
    ALL_LANGUAGES_LIST = languages || [];
    ALL_SYNONYMS_MAP = synonyms || {};
});

socket3.on("gameStarting", (settings) => {
    HINTS_ENABLED = (settings && settings.hints === false) ? false : true;
    show("game-screen");
    
    // Clean UI
    const img = document.getElementById("flag-img");
    img.src = ""; 
    img.classList.add("loading-hidden");
    document.getElementById("text-question-display").classList.add("hidden");
    document.getElementById("flag-area").classList.remove("map-mode");
    document.getElementById("feedback-ticker").innerHTML = "";
    document.getElementById("progress-indicator").innerText = "";
    document.getElementById("timer-bar").style.width = "100%";
    document.getElementById("question-counter").innerText = "Get Ready!";
    
    // Reset Input
    const inp = document.getElementById("answer-input");
    inp.value = "";
    inp.className = ""; 
    document.getElementById("ghost-overlay").innerText = "";
    document.getElementById("next-suggestion-btn").classList.add("hidden");
});

socket3.on("gameManifest", ({ questions, timeLimit, isMultiplayer }) => {
    GAME_MANIFEST = questions;
    TIME_LIMIT = timeLimit;
    IS_MULTIPLAYER = isMultiplayer;
    CURRENT_Q_INDEX = 0;
    IS_GAME_RUNNING = true;
    
    // 1. Initial Preload
    managePreloadBuffer(-1); 

    // 2. Start Countdown (For Single Player this leads to Start. For MP this just syncs the vibe)
    const overlay = document.getElementById("countdown-overlay");
    overlay.classList.remove("hidden");
    let count = 3; 
    overlay.innerText = count;
    
    const countdownInt = setInterval(() => {
        count--;
        if (count > 0) {
            overlay.innerText = count;
        } else { 
            clearInterval(countdownInt); 
            overlay.classList.add("hidden");
            
            // SINGLE PLAYER: Start Immediately
            if (!IS_MULTIPLAYER) {
                runLocalRound();
            }
            // MULTIPLAYER: Wait for "roundStart" event from server
            else {
                document.getElementById("question-counter").innerText = "Waiting for server...";
            }
        }
    }, 500);
});

// MULTIPLAYER SIGNAL: Start Round
socket3.on("roundStart", ({ roundIndex }) => {
    if (!IS_MULTIPLAYER || !IS_GAME_RUNNING) return;
    CURRENT_Q_INDEX = roundIndex;
    runLocalRound();
});

// MULTIPLAYER SIGNAL: End Round (Intermission)
socket3.on("roundEnd", ({ correctTarget }) => {
    if (!IS_MULTIPLAYER || !IS_GAME_RUNNING) return;
    
    // Clear Player Toasts
    const container = document.getElementById("feedback-ticker");
    container.innerHTML = "";
    
    // Show Answer Pill (Yellow)
    const ansPill = document.createElement("div");
    ansPill.className = "ticker-pill pill-answer";
    ansPill.innerText = correctTarget;
    container.appendChild(ansPill);
    
    // Preload more while waiting
    managePreloadBuffer(CURRENT_Q_INDEX);
});


function runLocalRound() {
    if (!IS_GAME_RUNNING) return;

    const roundData = GAME_MANIFEST[CURRENT_Q_INDEX];
    const { index, imageType, flagPath, target, synonyms, questionText } = roundData;
    
    // Preload Next Batch
    managePreloadBuffer(CURRENT_Q_INDEX);

    MY_SUBMITTED = false;
    document.getElementById("question-counter").innerText = `Q ${index} / ${GAME_MANIFEST.length}`;
    
    const img = document.getElementById("flag-img");
    const area = document.getElementById("flag-area");
    const textDisplay = document.getElementById("text-question-display");
    
    // Mode
    if (imageType === 'capital') CURRENT_AUTOCOMPLETE_MODE = 'capitals';
    else if (imageType === 'language') CURRENT_AUTOCOMPLETE_MODE = 'languages';
    else CURRENT_AUTOCOMPLETE_MODE = 'countries';

    // Visuals
    if (imageType === 'capital') {
        img.classList.add("hidden");
        area.classList.remove("map-mode");
        textDisplay.classList.remove("hidden");
        textDisplay.innerText = questionText;
    } else {
        textDisplay.classList.add("hidden");
        img.classList.remove("hidden");
        
        if (imageType === 'map') area.classList.add("map-mode");
        else area.classList.remove("map-mode");
        
        // Instant Swap via Cache
        if (IMAGE_CACHE[flagPath]) {
            img.src = IMAGE_CACHE[flagPath].src;
            img.classList.remove("loading-hidden");
        } else {
            img.classList.add("loading-hidden");
            img.src = flagPath;
            img.onload = () => img.classList.remove("loading-hidden");
        }
    }

    // Reset Inputs
    const inp = document.getElementById("answer-input");
    inp.value = "";
    inp.disabled = false;
    inp.className = "";
    inp.focus();
    document.getElementById("answer-btn").disabled = false;
    updateGhostText("");
    
    // Clear Ticker (Single Player only - MP handles this at roundEnd)
    if (!IS_MULTIPLAYER) {
        document.getElementById("feedback-ticker").innerHTML = "";
    } else {
        // In MP, ticker starts empty for new round
        document.getElementById("feedback-ticker").innerHTML = ""; 
    }

    // Start Timer
    const bar = document.getElementById("timer-bar");
    if (TIMER_INTERVAL) clearInterval(TIMER_INTERVAL);
    
    let startTime = Date.now();
    
    TIMER_INTERVAL = setInterval(() => {
        if (!IS_GAME_RUNNING) { clearInterval(TIMER_INTERVAL); return; }
        
        const elapsed = (Date.now() - startTime) / 1000;
        const remaining = Math.max(0, TIME_LIMIT - elapsed);
        bar.style.width = ((remaining / TIME_LIMIT) * 100) + "%";
        
        if (remaining <= 0) {
            finishLocalRound(false); 
        }
    }, 50);
}

function finishLocalRound(isCorrect) {
    clearInterval(TIMER_INTERVAL);
    
    const roundData = GAME_MANIFEST[CURRENT_Q_INDEX];
    const inp = document.getElementById("answer-input");
    inp.disabled = true;
    document.getElementById("answer-btn").disabled = true;

    if (isCorrect) {
        socket3.emit("submitScore", { 
            questionIndex: CURRENT_Q_INDEX, 
            timeTaken: 1000 
        });
    }

    // --- SPLIT LOGIC ---

    // SINGLE PLAYER: Show Answer & Auto-Advance
    if (!IS_MULTIPLAYER) {
        const container = document.getElementById("feedback-ticker");
        container.innerHTML = ""; 
        const ansPill = document.createElement("div");
        ansPill.className = "ticker-pill pill-answer";
        ansPill.innerText = roundData.target;
        container.appendChild(ansPill);

        // Advance or End
        setTimeout(() => {
            CURRENT_Q_INDEX++;
            if (CURRENT_Q_INDEX < GAME_MANIFEST.length) {
                runLocalRound();
            } else {
                IS_GAME_RUNNING = false;
                document.getElementById("progress-indicator").innerText = "Finished! Calculating...";
                socket3.emit("playerFinished"); // Triggers stats calc
            }
        }, 1500);
    } 
    // MULTIPLAYER: Wait for Server
    else {
        // Don't show yellow answer pill yet. 
        // Just show "Waiting..." or keep the toasts visible.
        document.getElementById("question-counter").innerText = "Waiting for opponents...";
        
        // Signal server I am done
        socket3.emit("playerFinished");
    }
}

// ----------------------------------
// AUTOCOMPLETE & INPUT
// ----------------------------------

function updateSuggestions(typed) {
    if (!HINTS_ENABLED || !typed || typed.length < 1) {
        SUGGESTIONS = [];
        SUGGESTION_INDEX = 0;
        updateGhostText("");
        return;
    }

    const search = clean(typed);
    const matches = new Set();
    
    let sourceList = ALL_COUNTRIES_LIST;
    if (CURRENT_AUTOCOMPLETE_MODE === 'capitals') sourceList = ALL_CAPITALS_LIST;
    else if (CURRENT_AUTOCOMPLETE_MODE === 'languages') sourceList = ALL_LANGUAGES_LIST;

    sourceList.forEach(item => {
        if (clean(item).startsWith(search)) matches.add(item);
    });

    if (CURRENT_AUTOCOMPLETE_MODE === 'countries') {
        Object.keys(ALL_SYNONYMS_MAP).forEach(key => {
            if (clean(key).startsWith(search)) {
                matches.add(key.toUpperCase());
            }
        });
    }

    SUGGESTIONS = Array.from(matches).sort();
    SUGGESTION_INDEX = 0;
    
    if (SUGGESTIONS.length > 0) updateGhostText(SUGGESTIONS[0]);
    else updateGhostText("");
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
    if (SUGGESTIONS.length > 1) nextBtn.classList.remove("hidden");
    else nextBtn.classList.add("hidden");
}

function cycleSuggestion() {
    if (SUGGESTIONS.length <= 1) return;
    SUGGESTION_INDEX = (SUGGESTION_INDEX + 1) % SUGGESTIONS.length;
    updateGhostText(SUGGESTIONS[SUGGESTION_INDEX]);
}

function addTickerItem(username, isGood) {
  const container = document.getElementById("feedback-ticker");
  // In Multiplayer, don't clear. In Single Player, current logic clears it via runLocalRound
  const pill = document.createElement("div");
  pill.className = `ticker-pill ${isGood ? "pill-good" : "pill-bad"}`;
  pill.innerText = `${username} ${isGood ? "✓" : "✗"}`;
  container.appendChild(pill);
}

// ----------------------------------
// SUBMISSION LOGIC
// ----------------------------------

function submitGuess() {
  if (MY_SUBMITTED || !IS_GAME_RUNNING) return;
  
  const inp = document.getElementById("answer-input");
  const ghost = document.getElementById("ghost-overlay");
  
  let val = inp.value.trim();
  if (HINTS_ENABLED && ghost.innerText && ghost.innerText.toLowerCase().startsWith(val.toLowerCase())) {
      val = ghost.innerText;
      inp.value = val; 
  }
  
  if (!val) return;
  
  MY_SUBMITTED = true;
  inp.disabled = true;
  document.getElementById("answer-btn").disabled = true;
  document.getElementById("next-suggestion-btn").classList.add("hidden");
  
  const roundData = GAME_MANIFEST[CURRENT_Q_INDEX];
  const isCorrect = checkLocalAnswer(val, roundData.target, roundData.synonyms);
  
  if (isCorrect) {
      inp.classList.add("input-correct");
      addTickerItem(window.USERNAME || "You", true);
      finishLocalRound(true);
  } else {
      inp.classList.add("input-wrong");
      addTickerItem(window.USERNAME || "You", false);
      finishLocalRound(false);
  }
}

// ----------------------------------
// LISTENERS
// ----------------------------------

const inputEl = document.getElementById("answer-input");
inputEl.oninput = (e) => updateSuggestions(e.target.value);
inputEl.onkeydown = (e) => {
  if (e.key === "Enter") submitGuess();
  if (e.key === "Tab") { e.preventDefault(); cycleSuggestion(); }
};
document.getElementById("next-suggestion-btn").onclick = () => { cycleSuggestion(); inputEl.focus(); };
document.getElementById("answer-btn").onclick = submitGuess;

socket3.on("playerUpdate", ({ username, isCorrect }) => {
  if (username !== (window.USERNAME || "You")) {
     addTickerItem(username, isCorrect);
  }
});

socket3.on("gameOver", ({ leaderboard }) => {
  IS_GAME_RUNNING = false;
  clearInterval(TIMER_INTERVAL);
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