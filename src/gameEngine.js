const { evaluateAnswer } = require("./fuzzy");

// Helper to pick items securely
function shuffle(array) {
  for (let i = array.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [array[i], array[j]] = [array[j], array[i]];
  }
  return array;
}

function generateRoundList(settings, data) {
  const rounds = [];
  const count = settings.questions || 10;
  
  // 1. Prepare Pools
  const countryList = Object.values(data.countries);
  const filteredCountries = (settings.continents && settings.continents.length > 0)
      ? countryList.filter((c) => settings.continents.includes(c.continent))
      : countryList;
  
  const languageList = Object.values(data.languages || {});

  // Shuffle pools once
  shuffle(filteredCountries);
  shuffle(languageList);

  let cIndex = 0;
  let lIndex = 0;

  for (let i = 0; i < count; i++) {
    // 2. Determine Type
    let type = 'flag'; 
    const mode = settings.gameType || 'mixed';

    if (mode === 'flags') type = 'flag';
    else if (mode === 'maps') type = 'map';
    else if (mode === 'capitals') type = 'capital';
    else if (mode === 'languages') type = 'language';
    else {
      // Mixed Mode
      const roll = Math.random();
      if (roll < 0.25) type = 'flag';
      else if (roll < 0.50) type = 'map';
      else if (roll < 0.75) type = 'capital';
      else type = 'language';
    }

    // 3. Pick Data
    if (type === 'language') {
      if (languageList.length === 0) { type = 'flag'; }
      else {
        const item = languageList[lIndex % languageList.length];
        lIndex++;
        rounds.push({ type, item });
        continue;
      }
    }

    if (filteredCountries.length === 0) break;
    const item = filteredCountries[cIndex % filteredCountries.length];
    cIndex++;
    
    if (type === 'capital' && !item.capital) type = 'flag';

    rounds.push({ type, item });
  }

  return rounds;
}

function start(broadcast, lobby, { config, data }) {
  const players = lobby.players || {};
  const playerCount = Object.keys(players).length;
  const isMultiplayer = playerCount > 1;

  const gameStats = {};
  Object.keys(players).forEach(pid => {
    gameStats[pid] = { points: 0, totalTime: 0, username: players[pid].username || "Guest" };
  });

  const rounds = generateRoundList(lobby.settings, data);
  
  // Initialize Game State
  lobby.gameState = {
    active: true,
    startTime: Date.now(),
    timeLimit: lobby.settings.timeLimit,
    currentRoundIndex: 0,
    finishedPlayers: new Set() // For Multiplayer Sync
  };

  // 1. Build Manifest
  const manifest = rounds.map((round, index) => {
    const { type, item } = round;
    let payload = {
      index: index + 1,
      imageType: type,
      flagPath: null,
      target: "",
      synonyms: [],
      questionText: "" 
    };

    if (type === 'language') {
      const num = Math.floor(Math.random() * 3) + 1;
      payload.flagPath = `languages/${item.id}_${num}.png`;
      payload.target = item.name;
      payload.synonyms = item.synonyms || [];
      payload.questionText = "Guess the Language";
    } else if (type === 'capital') {
      payload.target = item.capital;
      payload.questionText = `What is the capital of ${item.name}?`;
      payload.synonyms = []; 
    } else {
      payload.flagPath = (type === 'map') 
        ? `maps/${item.code}.svg` 
        : (item.flag_4x3 || `flags/4x3/${item.code}.svg`);
      
      payload.target = item.name;
      const relevant = Object.keys(data.synonyms).filter(k => data.synonyms[k] === item.name);
      payload.synonyms = relevant;
      payload.questionText = "Guess the Country";
    }
    return payload;
  });

  // 2. Broadcast Manifest
  broadcast("gameManifest", {
    questions: manifest,
    timeLimit: lobby.settings.timeLimit,
    totalQuestions: rounds.length,
    isMultiplayer: isMultiplayer
  });

  // 3. Score Handler (Trusted Client Logic)
  lobby.scoreHandler = (pid, { questionIndex, timeTaken }) => {
    if (!gameStats[pid]) return;
    // Basic de-duplication could go here if needed
    gameStats[pid].points += 1;
    gameStats[pid].totalTime += timeTaken;

    broadcast("playerUpdate", {
      username: gameStats[pid].username,
      isCorrect: true,
      totalPlayers: playerCount
    });
  };

  // --- MULTIPLAYER SYNCHRONIZATION LOGIC ---

  let roundTimer = null;

  function endMultiplayerRound() {
    clearTimeout(roundTimer);
    const rIdx = lobby.gameState.currentRoundIndex;
    const currentQuestion = manifest[rIdx];
    
    // Broadcast Round End (Clears toasts, shows answer)
    broadcast("roundEnd", {
      correctTarget: currentQuestion.target
    });

    // Intermission (2s) -> Next Round
    setTimeout(() => {
      if (!lobby.gameInProgress) return;
      lobby.gameState.currentRoundIndex++;
      startMultiplayerRound();
    }, 2000);
  }

  function startMultiplayerRound() {
    if (lobby.gameState.currentRoundIndex >= rounds.length) {
      endGame();
      return;
    }

    lobby.gameState.finishedPlayers.clear();
    
    // Signal clients to start their local engines
    broadcast("roundStart", {
      roundIndex: lobby.gameState.currentRoundIndex
    });

    // Server side safety timer (Time Limit + 1s buffer)
    roundTimer = setTimeout(() => {
      endMultiplayerRound();
    }, (lobby.settings.timeLimit + 1) * 1000);
  }

  // Handle "I'm Done" signal
  lobby.finishHandler = (pid) => {
    if (!lobby.gameInProgress) return;
    
    // Single Player: Ending Logic handled by client triggering 'playerFinished' at end of manifest
    if (!isMultiplayer) {
       endGame();
       return;
    }

    // Multiplayer: Checkpoint Logic
    lobby.gameState.finishedPlayers.add(pid);
    if (lobby.gameState.finishedPlayers.size >= playerCount) {
      // Everyone finished this round? End it immediately.
      endMultiplayerRound();
    }
  };

  // --- START LOGIC ---

  if (isMultiplayer) {
    // Wait a moment for clients to do their 3-2-1 countdown, then sync start Q1
    setTimeout(() => {
      if (lobby.gameInProgress) startMultiplayerRound();
    }, 3000); 
  } else {
    // Single Player: Just set a max timeout for cleanup
    const totalDurationSeconds = (lobby.settings.timeLimit + 2) * rounds.length + 10;
    setTimeout(() => { if (lobby.gameInProgress) endGame(); }, totalDurationSeconds * 1000);
  }

  function endGame() {
    lobby.gameInProgress = false;
    lobby.gameState = null;
    lobby.scoreHandler = null;
    lobby.finishHandler = null;
    clearTimeout(roundTimer);
    Object.keys(lobby.players).forEach(pid => lobby.readyState[pid] = false);
    
    const leaderboard = Object.values(gameStats).sort((a, b) => {
      if (b.points !== a.points) return b.points - a.points;
      return a.totalTime - b.totalTime;
    });
    
    broadcast("gameOver", { leaderboard });
    broadcast("lobbyUpdate", lobby);
  }
}

module.exports = { start };