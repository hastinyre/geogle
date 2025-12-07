// public/client.js
const socket = new NativeSocket();

// 1. Recover Username from Storage
let savedName = localStorage.getItem("geogle_username") || "";
let USERNAME = savedName;
window.USERNAME = USERNAME;

function updateHUD() {
  const hudName = document.getElementById("hud-username");
  if (hudName) hudName.innerText = window.USERNAME || "";
}

function show(id) {
  document.querySelectorAll(".screen").forEach((s) => s.classList.add("hidden"));
  const el = document.getElementById(id);
  if (el) el.classList.remove("hidden");
  
  // Voice Overlay Visibility
  const voiceEl = document.getElementById("voice-overlay");
  if (id === "lobby-room" || id === "game-screen") {
    voiceEl.classList.remove("hidden");
  } else {
    if (id !== "game-over-screen") {
      voiceEl.classList.add("hidden");
    }
  }

  // HUD Visibility
  const hudEl = document.getElementById("hud-overlay");
  if (id !== "username-screen") {
    hudEl.classList.remove("hidden");
    updateHUD();
  } else {
    hudEl.classList.add("hidden");
  }
}

if (USERNAME) {
  show("mode-screen");
} else {
  show("username-screen");
}

// USERNAME INITIAL SETUP
document.getElementById("username-btn").onclick = () => {
  const name = document.getElementById("username-input").value.trim();
  if (!name) return;
  USERNAME = name;
  window.USERNAME = USERNAME;
  localStorage.setItem("geogle_username", USERNAME); 
  updateHUD();
  show("mode-screen");
};

// [NEW] NAME CHANGE LOGIC
const nameModal = document.getElementById("name-modal");
const hudNameEl = document.getElementById("hud-username");

hudNameEl.onclick = () => {
    // RESTRICTION: Do not allow name change in Gameplay or Leaderboard
    const isGameActive = !document.getElementById("game-screen").classList.contains("hidden");
    const isGameOver = !document.getElementById("game-over-screen").classList.contains("hidden");
    
    if (isGameActive || isGameOver) return;

    document.getElementById("new-name-input").value = window.USERNAME;
    nameModal.classList.remove("hidden");
    document.getElementById("new-name-input").focus();
};

document.getElementById("cancel-name-btn").onclick = () => {
    nameModal.classList.add("hidden");
};

document.getElementById("confirm-name-btn").onclick = () => {
    const newName = document.getElementById("new-name-input").value.trim();
    if (newName && newName.length > 0) {
        // 1. Update Local State
        USERNAME = newName;
        window.USERNAME = newName;
        localStorage.setItem("geogle_username", newName);
        updateHUD();

        // 2. Notify Server (Update Lobby List Immediately)
        socket.emit("changeName", { username: newName });
    }
    nameModal.classList.add("hidden");
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

// ============================================
// VOICE CHAT LOGIC (Mesh P2P - Auto-Reattach)
// ============================================

const peers = {}; 
const iceQueues = {}; 
let localStream = null;
let isMicOn = false;
let isSpeakerOn = true;
let myPlayerId = null;

const iceServers = {
  iceServers: [{ urls: "stun:stun.l.google.com:19302" }]
};

// --- Helper: Plug Mic into a Connection ---
function reattachLocalStream(pc) {
  if (localStream && isMicOn) {
    const audioTrack = localStream.getAudioTracks()[0];
    if (audioTrack) {
      const sender = pc.getSenders().find(s => s.track && s.track.kind === 'audio' || (!s.track));
      if (sender) {
        sender.replaceTrack(audioTrack).catch(e => console.error("Voice: Auto-Reattach Error", e));
      }
    }
  }
}

// 1. Voice Controls
const btnMic = document.getElementById("btn-mic");
const btnSpeaker = document.getElementById("btn-speaker");

btnMic.onclick = async () => {
  if (!localStream) {
    try {
      console.log("Voice: Requesting Mic Access...");
      localStream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch (e) {
      console.error("Voice: Mic access denied", e);
      alert("Could not access microphone.");
      return;
    }
  }

  isMicOn = !isMicOn;
  
  if (isMicOn) {
    btnMic.classList.remove("voice-off");
    btnMic.style.background = "#28a745"; 
  } else {
    btnMic.classList.add("voice-off");
    btnMic.style.background = ""; 
  }

  const audioTrack = localStream.getAudioTracks()[0];
  if (audioTrack) audioTrack.enabled = isMicOn;

  // Update ALL connections
  Object.values(peers).forEach(pc => reattachLocalStream(pc));
};

btnSpeaker.onclick = () => {
  isSpeakerOn = !isSpeakerOn;
  document.querySelectorAll("audio.remote-audio").forEach(a => {
    a.muted = !isSpeakerOn;
  });

  if (isSpeakerOn) {
    btnSpeaker.classList.remove("voice-off");
    btnSpeaker.style.background = "#28a745";
  } else {
    btnSpeaker.classList.add("voice-off");
    btnSpeaker.style.background = ""; 
  }
};

// 2. Peer Connection Logic
function createPeer(targetId, initiator) {
  console.log(`Voice: Creating Peer Connection to ${targetId} (Initiator: ${initiator})`);
  const pc = new RTCPeerConnection(iceServers);
  iceQueues[targetId] = [];

  if (initiator) {
    pc.addTransceiver('audio', { direction: 'sendrecv' });
    reattachLocalStream(pc);
  }

  pc.onicecandidate = (event) => {
    if (event.candidate) {
      socket.emit("voiceSignal", { targetId, signal: { type: "candidate", candidate: event.candidate }});
    }
  };

  pc.onconnectionstatechange = () => {
    console.log(`Voice: Connection to ${targetId} is now ${pc.connectionState}`);
  };

  pc.ontrack = (event) => {
    console.log(`Voice: Received Audio Track from ${targetId}`);
    
    let audio = document.getElementById(`audio-${targetId}`);
    if (!audio) {
      audio = document.createElement("audio");
      audio.id = `audio-${targetId}`;
      audio.className = "remote-audio";
      audio.autoplay = true;
      audio.playsInline = true;
      audio.muted = !isSpeakerOn; 
      document.body.appendChild(audio);
    }
    
    const inboundStream = new MediaStream([event.track]);
    if (audio.srcObject !== inboundStream) {
      audio.srcObject = inboundStream;
      audio.play().catch(e => console.warn("Voice: Autoplay blocked", e));
    }
  };

  peers[targetId] = pc;
  return pc;
}

async function handleIceCandidate(pc, targetId, candidate) {
  try {
    if (pc.remoteDescription && pc.remoteDescription.type) {
      await pc.addIceCandidate(new RTCIceCandidate(candidate));
    } else {
      if (!iceQueues[targetId]) iceQueues[targetId] = [];
      iceQueues[targetId].push(candidate);
    }
  } catch (e) { console.error("Voice: ICE Error", e); }
}

// 3. Signaling Handler
socket.on("voiceSignal", async ({ senderId, signal }) => {
  let pc = peers[senderId];
  
  if (!pc) {
    if (signal.type === "offer") {
      pc = createPeer(senderId, false);
    } else { return; }
  }

  try {
    if (signal.type === "offer") {
      console.log(`Voice: Received Offer from ${senderId}`);
      await pc.setRemoteDescription(new RTCSessionDescription(signal));
      
      pc.getTransceivers().forEach(t => {
        if (t.receiver.track.kind === 'audio') {
          t.direction = 'sendrecv';
        }
      });

      reattachLocalStream(pc);

      if (iceQueues[senderId]) {
        for (const cand of iceQueues[senderId]) await pc.addIceCandidate(new RTCIceCandidate(cand));
        iceQueues[senderId] = [];
      }

      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);
      socket.emit("voiceSignal", { targetId: senderId, signal: answer });
      
    } else if (signal.type === "answer") {
      console.log(`Voice: Received Answer from ${senderId}`);
      await pc.setRemoteDescription(new RTCSessionDescription(signal));
      
      if (iceQueues[senderId]) {
        for (const cand of iceQueues[senderId]) await pc.addIceCandidate(new RTCIceCandidate(cand));
        iceQueues[senderId] = [];
      }
      
    } else if (signal.type === "candidate") {
      await handleIceCandidate(pc, senderId, signal.candidate);
    }
  } catch(e) { console.error("Voice: Signal Error", e); }
});

// Handle Rejoined Players
socket.on("playerRejoined", ({ playerId }) => {
  const myId = socket.id; 
  if (playerId === myId) return;

  console.log(`Voice: Player ${playerId} rejoined. Resetting connection.`);
  
  if (peers[playerId]) {
    peers[playerId].close();
    delete peers[playerId];
    delete iceQueues[playerId];
    const el = document.getElementById(`audio-${playerId}`);
    if (el) el.remove();
  }

  if (myId && myId > playerId) {
    console.log(`Voice: Re-initiating call to ${playerId}`);
    const pc = createPeer(playerId, true);
    pc.createOffer().then(offer => {
      pc.setLocalDescription(offer);
      socket.emit("voiceSignal", { targetId: playerId, signal: offer });
    });
  }
});

// 4. Lobby Updates (Voice)
socket.on("lobbyUpdate", (lobby) => {
  myPlayerId = socket.id; 
  if (!myPlayerId || !lobby.players) return;

  const currentPlayers = Object.keys(lobby.players);

  currentPlayers.forEach(pid => {
    if (pid !== myPlayerId && !peers[pid]) {
      if (myPlayerId > pid) {
        const pc = createPeer(pid, true);
        pc.createOffer().then(offer => {
          console.log(`Voice: Sending Offer to ${pid}`);
          pc.setLocalDescription(offer);
          socket.emit("voiceSignal", { targetId: pid, signal: offer });
        });
      }
    }
  });

  Object.keys(peers).forEach(pid => {
    if (!lobby.players[pid]) {
      if (peers[pid]) peers[pid].close();
      delete peers[pid];
      delete iceQueues[pid];
      const el = document.getElementById(`audio-${pid}`);
      if (el) el.remove();
    }
  });
});