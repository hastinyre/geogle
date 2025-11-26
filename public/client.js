// public/client.js
const socket = new NativeSocket();

function show(id) {
  document.querySelectorAll(".screen").forEach((s) => s.classList.add("hidden"));
  const el = document.getElementById(id);
  if (el) el.classList.remove("hidden");
}

let USERNAME = "";

// USERNAME
document.getElementById("username-btn").onclick = () => {
  const name = document.getElementById("username-input").value.trim();
  if (!name) return;
  USERNAME = name;
  window.USERNAME = USERNAME;
  show("mode-screen");
};

// --- 1. PUBLIC (Matchmaking) ---
document.getElementById("public-btn").onclick = () => {
  socket.emit("requestPublicGame", { username: USERNAME });
};

// --- 2. PRIVATE (Menu) ---
document.getElementById("private-btn").onclick = () => {
  show("private-menu");
};

// --- 3. SINGLE PLAYER ---
document.getElementById("single-btn").onclick = () => {
  socket.emit("createLobby", { username: USERNAME, type: 'single' });
};

window.socket = socket;
window.USERNAME = USERNAME;