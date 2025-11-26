// public/client.js
const socket = new NativeSocket();

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


// ============================================
// VOICE CHAT LOGIC (Mesh P2P - Unified Plan)
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

// 1. Voice Controls
const btnMic = document.getElementById("btn-mic");
const btnSpeaker = document.getElementById("btn-speaker");

btnMic.onclick = async () => {
  // A. Request Mic Permissions
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

  // B. Toggle State
  isMicOn = !isMicOn;
  
  if (isMicOn) {
    btnMic.classList.remove("voice-off");
    btnMic.style.background = "#28a745"; 
  } else {
    btnMic.classList.add("voice-off");
    btnMic.style.background = ""; 
  }

  // C. Mute/Unmute Hardware
  const audioTrack = localStream.getAudioTracks()[0];
  if (audioTrack) audioTrack.enabled = isMicOn;

  // D. Update Active Connections
  Object.values(peers).forEach(pc => {
    // Find the audio sender. It might be null track if currently silent.
    const sender = pc.getSenders().find(s => s.track && s.track.kind === 'audio' || (!s.track));
    if (sender) {
      sender.replaceTrack(audioTrack).catch(e => console.error("Voice: Replace error", e));
    }
  });
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

  // [CRITICAL FIX]: Only INITIATOR creates the Transceiver manually.
  // The Responder will get one automatically when they receive the Offer.
  // This prevents "Double Transceiver" / "Pipe Mismatch" bugs.
  if (initiator) {
    pc.addTransceiver('audio', { direction: 'sendrecv' });
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
      
      // [CRITICAL FIX FOR RESPONDER]
      // We didn't add a transceiver manually. We must ensure the one created
      // by the Offer is set to 'sendrecv' so we can reply with audio later.
      pc.getTransceivers().forEach(t => {
        if (t.receiver.track.kind === 'audio') {
          t.direction = 'sendrecv';
        }
      });

      // Process ICE
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

// 4. Lobby Updates
socket.on("lobbyUpdate", (lobby) => {
  myPlayerId = socket.id; 
  if (!myPlayerId || !lobby.players) return;

  const currentPlayers = Object.keys(lobby.players);

  // Connect to new players
  currentPlayers.forEach(pid => {
    if (pid !== myPlayerId && !peers[pid]) {
      // Mesh Rule: Larger ID calls Smaller ID
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

  // Cleanup
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