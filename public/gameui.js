// public/gameui.js
const socket3 = window.socket;
let MY_SUBMITTED = false;
let TIMER_INTERVAL = null;
let CURRENT_PLAYER_COUNT = 1;

// Client Prediction Data
let CURRENT_TARGET = ""; 
let CURRENT_SYNONYMS = [];

// --- CLIENT SIDE FUZZY LOGIC ---
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

socket3.on("gameStarting", () => {
  show("game-screen");
  
  const img = document.getElementById("flag-img");
  img.src = ""; 
  img.classList.add("loading-hidden");
  
  const area = document.getElementById("flag-area");
  area.classList.remove("map-mode");

  document.getElementById("feedback-ticker").innerHTML = "";
  document.getElementById("progress-indicator").innerText = "";
  document.getElementById("timer-bar").style.width = "100%";
  
  const inp = document.getElementById("answer-input");
  inp.value = "";
  inp.className = ""; 
  document.getElementById("question-counter").innerText = "Get Ready!";

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
    }
  }, 500); 
});

socket3.on("gamePreload", ({ url }) => {
  if (url) {
    const hiddenImg = new Image();
    hiddenImg.src = url;
  }
});

// [UPDATED] Handle Late Joins via 'remainingTime'
socket3.on("questionStart", ({ index, total, flagPath, timeLimit, playerCount, imageType, target, synonyms, remainingTime }) => {
  
  // Ensure we are viewing the game screen (Rehydration logic support)
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
  img.onload = () => {
    img.classList.remove("loading-hidden");
  };

  document.getElementById("progress-indicator").innerText = `0/${playerCount} Answered`;
  document.getElementById("feedback-ticker").innerHTML = "";
  
  const inp = document.getElementById("answer-input");
  inp.value = "";
  inp.disabled = false;
  inp.className = "";
  inp.focus();
  
  document.getElementById("answer-btn").disabled = false;

  // --- TIMER LOGIC ---
  const bar = document.getElementById("timer-bar");
  
  if (TIMER_INTERVAL) clearInterval(TIMER_INTERVAL);

  // If remainingTime is provided (Late Join), use it. Else full time.
  const initialTime = (remainingTime !== undefined) ? remainingTime : timeLimit;
  
  // Set initial width
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
  const val = document.getElementById("answer-input").value.trim();
  if (!val) return;
  
  MY_SUBMITTED = true;
  document.getElementById("answer-input").disabled = true;
  document.getElementById("answer-btn").disabled = true;
  
  if (CURRENT_PLAYER_COUNT === 1) {
    clearInterval(TIMER_INTERVAL);
  }

  const isLikelyCorrect = checkLocalAnswer(val, CURRENT_TARGET, CURRENT_SYNONYMS);
  const inp = document.getElementById("answer-input");
  
  if (isLikelyCorrect) {
    inp.classList.add("input-correct");
    addTickerItem(window.USERNAME || "You", true);
  } else {
    inp.classList.add("input-wrong");
    addTickerItem(window.USERNAME || "You", false);
  }
  
  socket3.emit("submitAnswer", { answer: val });
}

document.getElementById("answer-btn").onclick = submitGuess;
document.getElementById("answer-input").onkeydown = (e) => {
  if (e.key === "Enter") submitGuess();
};

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
  
  const myUsername = window.USERNAME || "You";
  if (username !== myUsername) {
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

  if (preload && preload.url) {
    const hiddenImg = new Image();
    hiddenImg.src = preload.url;
  }
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
  } else {
    tbody.innerHTML = "<tr><td colspan='4'>No stats</td></tr>";
  }
});

document.getElementById("back-to-lobby-btn").onclick = () => {
  show("lobby-room");
  document.getElementById("ready-btn").innerText = "Ready";
};