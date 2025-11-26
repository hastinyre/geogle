// public/gameui.js
const socket3 = window.socket;
let MY_SUBMITTED = false;
let TIMER_INTERVAL = null;

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
  
  // 1. Clean Slate
  const img = document.getElementById("flag-img");
  img.src = ""; 
  img.classList.add("loading-hidden");
  
  // Ensure default state (Remove map mode styles if any)
  const area = document.getElementById("flag-area");
  area.classList.remove("map-mode");

  // 2. Start Countdown
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

socket3.on("questionStart", ({ index, total, flagPath, timeLimit, playerCount, imageType }) => {
  MY_SUBMITTED = false;
  
  document.getElementById("question-counter").innerText = `Q ${index} / ${total}`;
  
  const img = document.getElementById("flag-img");
  const area = document.getElementById("flag-area");

  // 1. Hide briefly
  img.classList.add("loading-hidden");
  
  // 2. Toggle "Map Mode" on the Container
  if (imageType === 'map') {
    area.classList.add("map-mode");
  } else {
    area.classList.remove("map-mode");
  }

  // 3. Set Source
  img.src = flagPath;

  // 4. Show when ready
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

  const bar = document.getElementById("timer-bar");
  bar.style.width = "100%";
  
  if (TIMER_INTERVAL) clearInterval(TIMER_INTERVAL);
  const start = Date.now();
  TIMER_INTERVAL = setInterval(() => {
    const elapsed = (Date.now() - start) / 1000;
    const remain = Math.max(0, timeLimit - elapsed);
    bar.style.width = ((remain / timeLimit) * 100) + "%";
    if (remain <= 0) clearInterval(TIMER_INTERVAL);
  }, 50);
});

function submitGuess() {
  if (MY_SUBMITTED) return;
  const val = document.getElementById("answer-input").value.trim();
  if (!val) return;
  MY_SUBMITTED = true;
  document.getElementById("answer-input").disabled = true;
  document.getElementById("answer-btn").disabled = true;
  
  // Freeze Timer
  clearInterval(TIMER_INTERVAL);
  
  socket3.emit("submitAnswer", { answer: val });
}

document.getElementById("answer-btn").onclick = submitGuess;
document.getElementById("answer-input").onkeydown = (e) => {
  if (e.key === "Enter") submitGuess();
};

socket3.on("answerResult", ({ correct }) => {
  const inp = document.getElementById("answer-input");
  if (correct) inp.classList.add("input-correct");
  else inp.classList.add("input-wrong");
});

socket3.on("playerUpdate", ({ username, isCorrect, answeredCount, totalPlayers }) => {
  document.getElementById("progress-indicator").innerText = `${answeredCount}/${totalPlayers} Answered`;
  addTickerItem(username, isCorrect);
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