import { start as startGameEngine } from "./gameEngine.js";
import countriesRaw from "./data/country.json";
import languagesRaw from "./data/languages.json";
import synonymsRaw from "./data/synonyms.json";
import lobbyNamesRaw from "./data/lobbyNames.json";

const data = {
  countries: {},
  languages: [],
  synonyms: {},
  countryNames: [],  // NEW: specific list for countries
  languageNames: [], // NEW: specific list for languages
  continentCounts: { "all": 0 }
};

function normalize(str) {
  return str ? str.trim().toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]+/gi, " ").trim() : "";
}

(function initData() {
  for (const [key, val] of Object.entries(synonymsRaw)) {
    data.synonyms[normalize(key)] = val;
  }
  
  // Process Countries
  countriesRaw.forEach(c => {
    const normName = normalize(c.name);
    const tokens = normName.split(" ").filter(Boolean);
    const cont = c.continent || "Other";
    data.continentCounts[cont] = (data.continentCounts[cont] || 0) + 1;
    data.continentCounts["all"]++;
    data.countries[c.code] = { ...c, displayName: c.name, normalizedName: normName, tokens: tokens };
    data.countryNames.push(c.name); // Add to specific list
  });

  // Process Languages
  languagesRaw.forEach(l => {
    data.languages.push(l);
    data.languageNames.push(l.name); // Add to specific list
  });
})();

const config = {
  GAME: { DEFAULT_QUESTIONS_PER_GAME: 10, DEFAULT_TIME_LIMIT_SECONDS: 10, MIN_PLAYERS_TO_START: 2 },
  FUZZY: { THRESHOLD_DEFAULT: 85 },
  LOBBY: { LOBBY_EXPIRY_MINUTES: 30 }
};

export class GameLobby {
  constructor(state, env) {
    this.state = state;
    this.lobbies = {}; 
    this.sessions = new Map(); 
    this.disconnections = new Map(); 
    
    setInterval(() => this.cleanupZombies(), 10000);
  }

  async fetch(request) {
    const url = new URL(request.url);
    const existingSessionId = url.searchParams.get("sessionId");

    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);
    this.handleSession(server, existingSessionId);
    return new Response(null, { status: 101, webSocket: client });
  }

  handleSession(ws, existingSessionId) {
    ws.accept();
    
    const playerId = existingSessionId || crypto.randomUUID().slice(0, 8);
    const sessionId = playerId; 

    if (this.disconnections.has(sessionId)) {
      const recovery = this.disconnections.get(sessionId);
      clearTimeout(recovery.timer); 
      this.disconnections.delete(sessionId);
      
      this.sessions.set(ws, { 
        playerId, sessionId, 
        lobbyCode: recovery.lobbyCode, 
        lastSeen: Date.now() 
      });
      
      this.broadcastToLobby(recovery.lobbyCode, "playerRejoined", { playerId });

    } else {
      this.sessions.set(ws, { 
        playerId, sessionId, 
        lobbyCode: null, 
        lastSeen: Date.now() 
      });
    }

    ws.send(JSON.stringify({ event: "init", id: playerId, sessionId }));
    
    // SEND SEPARATE LISTS FOR AUTOCOMPLETE
    ws.send(JSON.stringify({ 
      event: "staticData", 
      payload: { 
        countries: data.countryNames,
        languages: data.languageNames,
        synonyms: synonymsRaw 
      } 
    }));
    
    const list = this.getLobbyListPayload();
    ws.send(JSON.stringify({ event: "lobbyList", payload: list }));

    const sess = this.sessions.get(ws);
    if (sess.lobbyCode) {
      const lobby = this.lobbies[sess.lobbyCode];
      if (lobby) {
        ws.send(JSON.stringify({ event: "lobbyUpdate", payload: lobby }));
        
        if (lobby.gameInProgress && lobby.gameState && lobby.gameState.isRoundActive) {
          const elapsed = (Date.now() - lobby.gameState.startTime) / 1000;
          const remaining = Math.max(0, lobby.settings.timeLimit - elapsed);
          
          ws.send(JSON.stringify({ 
            event: "questionStart", 
            payload: {
              ...lobby.gameState.currentQuestion,
              timeLimit: lobby.settings.timeLimit,
              remainingTime: remaining,
              playerCount: Object.keys(lobby.players).length
            }
          }));
        }
      }
    }

    ws.addEventListener("message", msg => {
      try {
        const { event, payload } = JSON.parse(msg.data);
        const s = this.sessions.get(ws);
        if (s) s.lastSeen = Date.now();
        if (event === "pong") return;
        this.handleEvent(ws, playerId, event, payload);
      } catch (e) { console.error(e); }
    });

    ws.addEventListener("close", () => {
      const s = this.sessions.get(ws);
      if (s) {
        if (s.lobbyCode) {
           const timer = setTimeout(() => {
             this.leaveLobby(ws, s.lobbyCode, s.playerId);
             this.disconnections.delete(s.sessionId);
           }, 5000); 
           
           this.disconnections.set(s.sessionId, { 
             timer, 
             lobbyCode: s.lobbyCode 
           });
        }
        this.sessions.delete(ws);
      }
    });
  }

  cleanupZombies() {
    const now = Date.now();
    for (const [ws, sess] of this.sessions.entries()) {
      try { ws.send(JSON.stringify({ event: "ping" })); } catch(e) {}
      if (now - sess.lastSeen > 35000) {
        if (sess.lobbyCode) this.leaveLobby(ws, sess.lobbyCode, sess.playerId);
        ws.close();
        this.sessions.delete(ws);
      }
    }
  }

  getLobbyListPayload() {
    return Object.values(this.lobbies)
      .filter(l => !l.gameInProgress && l.type === 'private')
      .map(l => ({ code: l.code, name: l.name, count: Object.keys(l.players).length }));
  }

  broadcastLobbyList() {
    const list = this.getLobbyListPayload();
    const msg = JSON.stringify({ event: "lobbyList", payload: list });
    for (const [ws, sess] of this.sessions.entries()) {
        try { ws.send(msg); } catch(e) {}
    }
  }

  handleEvent(ws, playerId, event, payload) {
    const session = this.sessions.get(ws);
    const code = (payload && payload.lobbyCode) ? payload.lobbyCode : (session ? session.lobbyCode : null);

    switch (event) {
      case "createLobby": this.createLobby(ws, playerId, payload); break;
      case "joinLobby": this.joinLobby(ws, playerId, payload); break;
      case "requestPublicGame": this.requestPublicGame(ws, playerId, payload); break;
      case "leaveLobby": this.leaveLobby(ws, code, playerId); break;
      case "setReady": this.setReady(code, playerId, payload.ready); break;
      case "updateLobbySettings": this.updateSettings(code, playerId, payload.settings); break;
      case "startGame": this.startGame(code, playerId); break;
      case "kickPlayer": this.kickPlayer(code, playerId, payload.targetId); break;
      case "submitAnswer": this.submitAnswer(code, playerId, payload.answer, ws); break;
      case "voiceSignal": this.handleVoiceSignal(code, playerId, payload); break;
    }
  }

  handleVoiceSignal(code, senderId, payload) {
    const lobby = this.lobbies[code];
    if (!lobby) return;
    const { targetId, signal } = payload;
    for (const [ws, sess] of this.sessions.entries()) {
      if (sess.lobbyCode === code && sess.playerId === targetId) {
        ws.send(JSON.stringify({ event: "voiceSignal", payload: { senderId, signal } }));
        break;
      }
    }
  }

  createLobby(ws, playerId, payload) {
    const type = payload.type || 'private';
    let code = Math.floor(1000 + Math.random() * 9000).toString();
    while(this.lobbies[code]) code = Math.floor(1000 + Math.random() * 9000).toString();
    const name = lobbyNamesRaw[Math.floor(Math.random() * lobbyNamesRaw.length)];

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
        modes: ['flags', 'maps', 'languages'],
        hints: true // Default ON
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
      if (Object.keys(existing.players).length === 2) this.startGame(existing.code, existing.hostId, true); 
    } else {
      this.createLobby(ws, playerId, { username: payload.username, type: 'public' });
    }
  }

  joinLobbyInternal(ws, playerId, code, username) {
    const lobby = this.lobbies[code];
    if (!lobby) return;

    const sess = this.sessions.get(ws);
    if (sess) sess.lobbyCode = code;

    if (!lobby.players[playerId]) {
      lobby.players[playerId] = { id: playerId, username };
      lobby.readyState[playerId] = false;
    }
    
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
    
    const sessionId = sess ? sess.sessionId : playerId;
    if (this.disconnections.has(sessionId)) {
        clearTimeout(this.disconnections.get(sessionId).timer);
        this.disconnections.delete(sessionId);
    }

    if (Object.keys(lobby.players).length === 0) {
      delete this.lobbies[code];
    } else {
      if (lobby.hostId === playerId) lobby.hostId = Object.keys(lobby.players)[0];
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

    if (lobby.type === 'private' || lobby.type === 'public') {
      const allReady = Object.keys(lobby.players).every(pid => {
        return (pid === lobby.hostId) || lobby.readyState[pid];
      });

      if (!allReady) {
        return; 
      }
    }

    lobby.gameInProgress = true;
    this.broadcastToLobby(code, "gameStarting", lobby.settings);
    
    const broadcastFn = (evt, payload) => {
      this.broadcastToLobby(code, evt, payload);
      if (evt === "gameOver") this.broadcastLobbyList();
    };

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
                ws.send(JSON.stringify({ event: "kicked" }));
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
}