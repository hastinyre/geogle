import { start as startGameEngine } from "./gameEngine.js";

// Cloudflare bundles these JSONs automatically
import countriesRaw from "./data/country.json";
import synonymsRaw from "./data/synonyms.json";
import lobbyNamesRaw from "./data/lobbyNames.json";

// Reconstruct Data Object for Game Engine
const data = {
  countries: {},
  synonyms: {},
  continentCounts: { "all": 0 }
};

// 1. Normalize Data (Run once on startup)
function normalize(str) {
  return str ? str.trim().toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]+/gi, " ").trim() : "";
}

// Process Data
(function initData() {
  // Synonyms
  for (const [key, val] of Object.entries(synonymsRaw)) {
    data.synonyms[normalize(key)] = val;
  }
  // Countries
  countriesRaw.forEach(c => {
    const normName = normalize(c.name);
    const tokens = normName.split(" ").filter(Boolean);
    const cont = c.continent || "Other";
    
    data.continentCounts[cont] = (data.continentCounts[cont] || 0) + 1;
    data.continentCounts["all"]++;

    data.countries[c.code] = {
      ...c,
      displayName: c.name,
      normalizedName: normName,
      tokens: tokens
    };
  });
})();

// Configuration
const config = {
  GAME: { DEFAULT_QUESTIONS_PER_GAME: 10, DEFAULT_TIME_LIMIT_SECONDS: 10, MIN_PLAYERS_TO_START: 2 },
  FUZZY: { THRESHOLD_DEFAULT: 85 },
  LOBBY: { LOBBY_EXPIRY_MINUTES: 30 }
};

export class GameLobby {
  constructor(state, env) {
    this.state = state;
    this.lobbies = {}; 
    this.sessions = new Map(); // WebSocket -> { playerId, lobbyCode }
  }

  async fetch(request) {
    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);
    this.handleSession(server);
    return new Response(null, { status: 101, webSocket: client });
  }

  handleSession(ws) {
    ws.accept();
    const playerId = crypto.randomUUID().slice(0, 8);
    this.sessions.set(ws, { playerId, lobbyCode: null });

    // Send Init
    ws.send(JSON.stringify({ event: "init", id: playerId }));

    ws.addEventListener("message", msg => {
      try {
        const { event, payload } = JSON.parse(msg.data);
        this.handleEvent(ws, playerId, event, payload);
      } catch (e) { console.error(e); }
    });

    ws.addEventListener("close", () => {
      const session = this.sessions.get(ws);
      if (session && session.lobbyCode) {
        this.leaveLobby(ws, session.lobbyCode, playerId);
      }
      this.sessions.delete(ws);
    });
  }

  // --- CORE EVENT HANDLER ---
  handleEvent(ws, playerId, event, payload) {
    const session = this.sessions.get(ws);
    const memoryLobbyCode = session ? session.lobbyCode : null;
    const code = (payload && payload.lobbyCode) ? payload.lobbyCode : memoryLobbyCode;

    switch (event) {
      case "createLobby":
        this.createLobby(ws, playerId, payload);
        break;
      case "joinLobby":
        this.joinLobby(ws, playerId, payload);
        break;
      case "requestPublicGame":
        this.requestPublicGame(ws, playerId, payload);
        break;
      case "leaveLobby":
        this.leaveLobby(ws, code, playerId);
        break;
      case "setReady":
        this.setReady(code, playerId, payload.ready);
        break;
      case "updateLobbySettings":
        this.updateSettings(code, playerId, payload.settings);
        break;
      case "startGame":
        this.startGame(code, playerId);
        break;
      case "kickPlayer":
        this.kickPlayer(code, playerId, payload.targetId);
        break;
      case "submitAnswer":
        this.submitAnswer(code, playerId, payload.answer, ws);
        break;
      case "voiceSignal":
        // NEW: Forward WebRTC handshake signals
        this.handleVoiceSignal(code, playerId, payload);
        break;
    }
  }

  // --- ACTIONS ---

  handleVoiceSignal(code, senderId, payload) {
    const lobby = this.lobbies[code];
    if (!lobby) return;
    const { targetId, signal } = payload;
    
    // Find target socket
    for (const [ws, sess] of this.sessions.entries()) {
      if (sess.lobbyCode === code && sess.playerId === targetId) {
        ws.send(JSON.stringify({ 
          event: "voiceSignal", 
          payload: { senderId, signal } 
        }));
        break;
      }
    }
  }

  createLobby(ws, playerId, payload) {
    const type = payload.type || 'private';
    let code = Math.floor(1000 + Math.random() * 9000).toString();
    while(this.lobbies[code]) code = Math.floor(1000 + Math.random() * 9000).toString();

    const namePool = lobbyNamesRaw;
    const name = namePool[Math.floor(Math.random() * namePool.length)];

    this.lobbies[code] = {
      code, name, type,
      hostId: playerId,
      players: {},
      readyState: {},
      gameInProgress: false,
      settings: { 
        continents: [], 
        questions: 10, 
        timeLimit: 10,
        gameType: 'mixed' 
      }
    };

    this.joinLobbyInternal(ws, playerId, code, payload.username || "Host");
    ws.send(JSON.stringify({ 
      event: "lobbyCreated", 
      payload: { lobbyCode: code, lobbyName: name, type, stats: data.continentCounts } 
    }));
    this.broadcastLobbyList();
  }

  joinLobby(ws, playerId, payload) {
    const code = payload.lobbyCode;
    if (!this.lobbies[code]) return; 
    this.joinLobbyInternal(ws, playerId, code, payload.username || "Guest");
    ws.send(JSON.stringify({ event: "initStats", payload: data.continentCounts }));
  }

  requestPublicGame(ws, playerId, payload) {
    const existing = Object.values(this.lobbies).find(l => 
      l.type === 'public' && !l.gameInProgress && Object.keys(l.players).length < 2
    );

    if (existing) {
      this.joinLobbyInternal(ws, playerId, existing.code, payload.username || "Player 2");
      if (Object.keys(existing.players).length === 2) {
        this.startGame(existing.code, existing.hostId, true); 
      }
    } else {
      this.createLobby(ws, playerId, { username: payload.username, type: 'public' });
    }
  }

  joinLobbyInternal(ws, playerId, code, username) {
    const lobby = this.lobbies[code];
    if (!lobby) return;

    const sess = this.sessions.get(ws);
    if (sess) sess.lobbyCode = code;

    lobby.players[playerId] = { id: playerId, username };
    lobby.readyState[playerId] = false;
    
    this.broadcastToLobby(code, "lobbyUpdate", lobby);
    this.broadcastLobbyList();
  }

  leaveLobby(ws, code, playerId) {
    const lobby = this.lobbies[code];
    if (!lobby) return;

    delete lobby.players[playerId];
    delete lobby.readyState[playerId];

    const sess = this.sessions.get(ws);
    if (sess) sess.lobbyCode = null;

    if (Object.keys(lobby.players).length === 0) {
      delete this.lobbies[code];
    } else {
      if (lobby.hostId === playerId) {
        lobby.hostId = Object.keys(lobby.players)[0];
      }
      this.broadcastToLobby(code, "lobbyUpdate", lobby);
    }
    this.broadcastLobbyList();
  }

  setReady(code, playerId, ready) {
    const lobby = this.lobbies[code];
    if (lobby) {
      lobby.readyState[playerId] = ready;
      this.broadcastToLobby(code, "lobbyUpdate", lobby);
    }
  }

  updateSettings(code, playerId, settings) {
    const lobby = this.lobbies[code];
    if (lobby && lobby.hostId === playerId) {
      lobby.settings = { ...lobby.settings, ...settings };
      this.broadcastToLobby(code, "lobbyUpdate", lobby);
    }
  }

  startGame(code, playerId, force = false) {
    const lobby = this.lobbies[code];
    if (!lobby) return;
    if (!force && lobby.hostId !== playerId) return;

    lobby.gameInProgress = true;
    this.broadcastToLobby(code, "gameStarting", lobby.settings);
    
    const broadcastFn = (evt, payload) => this.broadcastToLobby(code, evt, payload);

    startGameEngine(broadcastFn, lobby, { config, data });
    this.broadcastLobbyList();
  }

  submitAnswer(code, playerId, answer, ws) {
    const lobby = this.lobbies[code];
    if (lobby && lobby.currentAnswerHandler) {
      const isCorrect = lobby.currentAnswerHandler(playerId, answer);
      ws.send(JSON.stringify({ event: "answerResult", payload: { correct: isCorrect } }));
    }
  }

  kickPlayer(code, hostId, targetId) {
    const lobby = this.lobbies[code];
    if (lobby && lobby.hostId === hostId) {
        for (const [ws, sess] of this.sessions.entries()) {
            if (sess.playerId === targetId) {
                this.leaveLobby(ws, code, targetId);
                break;
            }
        }
    }
  }

  broadcastToLobby(code, event, payload) {
    const msg = JSON.stringify({ event, payload });
    for (const [ws, sess] of this.sessions.entries()) {
      if (sess.lobbyCode === code) {
        try { ws.send(msg); } catch(e) {}
      }
    }
  }

  broadcastLobbyList() {
    const list = Object.values(this.lobbies)
      .filter(l => !l.gameInProgress && l.type === 'private')
      .map(l => ({ code: l.code, name: l.name, count: Object.keys(l.players).length }));
    
    const msg = JSON.stringify({ event: "lobbyList", payload: list });
    for (const [ws, sess] of this.sessions.entries()) {
        try { ws.send(msg); } catch(e) {}
    }
  }
}