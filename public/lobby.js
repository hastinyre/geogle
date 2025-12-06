// public/lobby.js
const socket2 = window.socket;
let CURRENT_LOBBY = null;
let IS_HOST = false;
let CONTINENT_DATA = {};

function showJoinCodeInput(show, lobbyName) {
  const codeInput = document.getElementById("join-code-input");
  if (lobbyName) {
    codeInput.placeholder = `Code for ${lobbyName}`;
    codeInput.value = "";
    codeInput.focus();
  } else {
    codeInput.placeholder = "Enter 4-Digit Code";
  }
}

function calculateMaxQuestions() {
  const checkboxes = document.querySelectorAll(".cont-chk:checked");
  let sum = 0;
  if (checkboxes.length === 0) sum = CONTINENT_DATA["all"] || 195;
  else checkboxes.forEach(chk => { sum += (CONTINENT_DATA[chk.value] || 0); });
  return sum;
}

function updateQuestionsInput(isMaxActive) {
  const input = document.getElementById("questions-input");
  const max = calculateMaxQuestions();
  if (isMaxActive) {
    input.value = max;
    socket2.emit("updateLobbySettings", { lobbyCode: CURRENT_LOBBY.code, settings: { questions: max }});
  } else {
    if (Number(input.value) > max) {
      input.value = max;
      socket2.emit("updateLobbySettings", { lobbyCode: CURRENT_LOBBY.code, settings: { questions: max }});
    }
  }
}

function updateLobbyUI(lobby) {
  CURRENT_LOBBY = lobby;
  IS_HOST = (socket2.id === lobby.hostId);

  const title = document.getElementById("lobby-room-title");
  const statusText = document.getElementById("lobby-status-text");
  const codeSpan = document.getElementById("lobby-room-code");
  const quitBtn = document.getElementById("hud-quit-btn");
  
  if (lobby.type === 'single') {
    title.innerText = "Single Player";
    statusText.innerText = "Practice Mode";
    codeSpan.innerText = "";
    quitBtn.classList.remove("hidden"); 
  } else {
    quitBtn.classList.add("hidden"); 
    
    if (lobby.type === 'public') {
      title.innerText = "Public Match";
      if (Object.keys(lobby.players).length < 2) {
        statusText.innerText = "Status:";
        codeSpan.innerText = "Searching...";
        codeSpan.style.fontSize = "1em";
      } else {
        statusText.innerText = "Status:";
        codeSpan.innerText = "Match Found!";
      }
    } else {
      title.innerText = lobby.name;
      statusText.innerText = "Code:";
      codeSpan.innerText = lobby.code;
      codeSpan.style.fontSize = "1.4em";
    }
  }

  // Player List
  const container = document.getElementById("player-list-container");
  container.innerHTML = "";
  let allReady = true;

  if (lobby.players) {
    Object.values(lobby.players).forEach((p) => {
      const row = document.createElement("div");
      row.className = "player-row";
      
      let html = `<strong>${p.username}</strong>`;
      if (p.id === lobby.hostId) html += " 👑";
      
      const statusDiv = document.createElement("div");
      if (lobby.type !== 'single' && lobby.type !== 'public') {
         const isReady = (p.id === lobby.hostId) || lobby.readyState[p.id];
         if (!isReady) allReady = false; 
         statusDiv.innerHTML = isReady ? "<span style='color:#28a745'>Ready</span>" : "<span style='color:#666'>...</span>";
      }
      
      row.innerHTML = `<div>${html}</div>`;
      row.appendChild(statusDiv);
      
      if (IS_HOST && lobby.type === 'private' && p.id !== socket2.id) {
        const kickBtn = document.createElement("button");
        kickBtn.className = "kick-btn";
        kickBtn.innerHTML = "&times;";
        kickBtn.onclick = () => socket2.emit("kickPlayer", { lobbyCode: lobby.code, targetId: p.id });
        row.appendChild(kickBtn);
      }
      container.appendChild(row);
    });
  }

  // Host Settings UI
  const showSettings = IS_HOST && (lobby.type === 'private' || lobby.type === 'single');
  document.getElementById("host-settings").classList.toggle("hidden", !showSettings);

  let hasValidModes = true;

  if (showSettings && lobby.settings) {
    // 1. Update Mode Checkboxes
    if (lobby.settings.modes) {
      document.querySelectorAll(".mode-chk").forEach(chk => {
        chk.checked = lobby.settings.modes.includes(chk.value);
      });
      
      hasValidModes = lobby.settings.modes.length > 0;

      // 2. Logic to Grey Out Continents
      const modes = lobby.settings.modes;
      const continentSection = document.getElementById("continents-section");
      
      const hasGeo = modes.includes('flags') || modes.includes('maps');
      
      if (hasGeo) {
        continentSection.classList.remove("disabled-area");
        document.querySelectorAll(".cont-chk").forEach(c => c.disabled = false);
      } else {
        continentSection.classList.add("disabled-area");
        document.querySelectorAll(".cont-chk").forEach(c => c.disabled = true);
      }
    }

    // 3. Update Checkbox State for Hints
    document.getElementById("hints-chk").checked = !!lobby.settings.hints;
  }

  // Start Button Logic
  const startBtn = document.getElementById("start-game-btn");
  const waitMsg = document.getElementById("wait-msg");
  const errorMsg = document.getElementById("mode-error-msg");

  if (lobby.type === 'private' || lobby.type === 'public') {
     const enoughPlayers = Object.keys(lobby.players).length >= 2;
     const canStart = enoughPlayers && allReady && hasValidModes;
     
     startBtn.disabled = !canStart;
     
     // Determine Message
     if (!hasValidModes) {
       errorMsg.classList.remove("hidden");
       waitMsg.classList.add("hidden");
     } else {
       errorMsg.classList.add("hidden");
       if (!canStart) {
           if (!enoughPlayers) waitMsg.innerText = "Need at least 2 players";
           else waitMsg.innerText = "Waiting for players to ready up...";
           waitMsg.classList.remove("hidden");
       } else {
           waitMsg.classList.add("hidden");
       }
     }
  } else {
     // Single Player
     if (!hasValidModes) {
       startBtn.disabled = true;
       errorMsg.classList.remove("hidden");
     } else {
       startBtn.disabled = false;
       errorMsg.classList.add("hidden");
     }
     waitMsg.classList.add("hidden");
  }

  // Ready Button UI (Guest)
  const showReady = !IS_HOST && lobby.type === 'private';
  const readyBtn = document.getElementById("ready-btn");
  readyBtn.style.display = showReady ? "inline-block" : "none";
  if (showReady) readyBtn.innerText = lobby.readyState?.[socket2.id] ? "Unready" : "Ready";
}

// --- LISTENERS ---

// Listener for Mode Checkboxes
document.querySelectorAll(".mode-chk").forEach(chk => {
  chk.onchange = () => {
    if (!IS_HOST) return;
    
    // Get all currently checked modes
    const allChecked = [...document.querySelectorAll(".mode-chk:checked")].map(x => x.value);
    
    // We allow unchecking everything (0 items)
    // The UI will handle disabling the start button
    
    socket2.emit("updateLobbySettings", { lobbyCode: CURRENT_LOBBY.code, settings: { modes: allChecked }});
  };
});

document.getElementById("max-q-btn").onclick = (e) => {
  const btn = e.target;
  const wasActive = btn.classList.contains("active");
  if (wasActive) btn.classList.remove("active");
  else {
    btn.classList.add("active");
    updateQuestionsInput(true);
  }
};

document.querySelectorAll(".cont-chk").forEach((chk) => {
  chk.onchange = () => {
    if (!IS_HOST) return;
    const maxBtn = document.getElementById("max-q-btn");
    if (maxBtn.classList.contains("active")) updateQuestionsInput(true);
    const continents = [...document.querySelectorAll(".cont-chk:checked")].map(x => x.value);
    socket2.emit("updateLobbySettings", { lobbyCode: CURRENT_LOBBY.code, settings: { continents }});
  };
});

document.getElementById("hints-chk").onchange = (e) => {
    if (!IS_HOST) return;
    socket2.emit("updateLobbySettings", { lobbyCode: CURRENT_LOBBY.code, settings: { hints: e.target.checked }});
};

document.getElementById("questions-input").oninput = (e) => {
  if (!IS_HOST) return;
  const val = Number(e.target.value);
  const max = calculateMaxQuestions();
  const maxBtn = document.getElementById("max-q-btn");
  if (val !== max) maxBtn.classList.remove("active");
  else maxBtn.classList.add("active");
  socket2.emit("updateLobbySettings", { lobbyCode: CURRENT_LOBBY.code, settings: { questions: val }});
};

document.getElementById("time-input").oninput = (e) => {
  if (!IS_HOST) return;
  let val = Number(e.target.value);
  if (val > 20) { val = 20; e.target.value = 20; }
  socket2.emit("updateLobbySettings", { lobbyCode: CURRENT_LOBBY.code, settings: { timeLimit: val }});
};

socket2.on("lobbyCreated", (data) => {
  if (data.stats) CONTINENT_DATA = data.stats;
  show("lobby-room");
});
socket2.on("initStats", (stats) => { CONTINENT_DATA = stats; });

socket2.on("lobbyUpdate", (lobby) => {
  if (!window.USERNAME && lobby.players && socket2.id && lobby.players[socket2.id]) {
    window.USERNAME = lobby.players[socket2.id].username;
  }
  
  const active = document.querySelector(".screen:not(.hidden)");
  if (!active || (active.id !== "game-screen" && active.id !== "game-over-screen")) {
    show("lobby-room");
  }

  updateLobbyUI(lobby);
});

socket2.on("kicked", () => {
  alert("You have been kicked from the lobby.");
  CURRENT_LOBBY = null;
  show("mode-screen");
  
  const input = document.getElementById("join-code-input");
  input.value = "";
  setTimeout(() => { input.value = ""; }, 100);
});

document.getElementById("hud-quit-btn").onclick = () => {
  if (CURRENT_LOBBY) socket2.emit("leaveLobby", { lobbyCode: CURRENT_LOBBY.code });
  CURRENT_LOBBY = null;
  show("mode-screen");
};

document.getElementById("back-to-mode-btn").onclick = () => show("mode-screen");
document.getElementById("create-lobby-btn").onclick = () => socket2.emit("createLobby", { username: window.USERNAME });
document.getElementById("join-lobby-btn").onclick = () => { show("join-lobby-screen"); showJoinCodeInput(true); };
document.getElementById("join-back-btn").onclick = () => show("private-menu");
document.getElementById("join-code-btn").onclick = () => {
  const typed = document.getElementById("join-code-input").value.trim();
  if (typed.length < 4) return alert("Enter code");
  socket2.emit("joinLobby", { lobbyCode: typed, username: window.USERNAME });
};
document.getElementById("start-game-btn").onclick = () => { if (CURRENT_LOBBY) socket2.emit("startGame", { lobbyCode: CURRENT_LOBBY.code }); };
document.getElementById("leave-lobby-btn").onclick = () => {
  if (CURRENT_LOBBY) socket2.emit("leaveLobby", { lobbyCode: CURRENT_LOBBY.code });
  CURRENT_LOBBY = null;
  show("mode-screen");
};
document.getElementById("home-btn").onclick = () => {
  if (CURRENT_LOBBY) socket2.emit("leaveLobby", { lobbyCode: CURRENT_LOBBY.code });
  CURRENT_LOBBY = null;
  show("mode-screen");
};

socket2.on("lobbyList", (list) => {
  const container = document.getElementById("lobby-list");
  container.innerHTML = "";
  list.forEach((l) => {
    const card = document.createElement("div");
    card.className = "lobby-item";
    card.innerHTML = `<span class="lobby-name">${l.name}</span><span class="lobby-count">👤 ${l.count}</span>`;
    card.onclick = () => { document.getElementById("join-code-input").value = ""; showJoinCodeInput(true, l.name); };
    container.appendChild(card);
  });
});

document.getElementById("ready-btn").onclick = () => {
  if (!CURRENT_LOBBY) return;
  const ready = !CURRENT_LOBBY.readyState?.[socket2.id];
  socket2.emit("setReady", { lobbyCode: CURRENT_LOBBY.code, ready });
};