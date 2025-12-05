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
  // Pool A: Countries (Filtered by Continent)
  const countryList = Object.values(data.countries);
  const filteredCountries = (settings.continents && settings.continents.length > 0)
      ? countryList.filter((c) => settings.continents.includes(c.continent))
      : countryList;
  
  // Pool B: Languages (Global)
  const languageList = Object.values(data.languages || {});

  // Shuffle pools once
  shuffle(filteredCountries);
  shuffle(languageList);

  let cIndex = 0;
  let lIndex = 0;

  for (let i = 0; i < count; i++) {
    // 2. Determine Type
    let type = 'flag'; // Default
    const mode = settings.gameType || 'mixed';

    if (mode === 'flags') type = 'flag';
    else if (mode === 'maps') type = 'map';
    else if (mode === 'capitals') type = 'capital';
    else if (mode === 'languages') type = 'language';
    else {
      // Mixed Mode: 25% chance each
      const roll = Math.random();
      if (roll < 0.25) type = 'flag';
      else if (roll < 0.50) type = 'map';
      else if (roll < 0.75) type = 'capital';
      else type = 'language';
    }

    // 3. Pick Data based on Type
    if (type === 'language') {
      if (languageList.length === 0) { type = 'flag'; } // Fallback
      else {
        const item = languageList[lIndex % languageList.length];
        lIndex++;
        rounds.push({ type, item });
        continue;
      }
    }

    // Flag/Map/Capital
    if (filteredCountries.length === 0) break; // Emergency exit
    const item = filteredCountries[cIndex % filteredCountries.length];
    cIndex++;
    
    // Skip Capitals if data missing
    if (type === 'capital' && !item.capital) type = 'flag';

    rounds.push({ type, item });
  }

  return rounds;
}

function start(broadcast, lobby, { config, data }) {
  const players = lobby.players || {};
  const gameStats = {};
  Object.keys(players).forEach(pid => {
    gameStats[pid] = { points: 0, totalTime: 0, username: players[pid].username || "Guest" };
  });

  const rounds = generateRoundList(lobby.settings, data);
  let currentIndex = 0;
  let currentTimer = null;
  let isRoundActive = false;

  // Initialize Game State
  lobby.gameState = {
    active: true,
    questionIndex: 0,
    totalQuestions: rounds.length,
    currentQuestion: null,
    startTime: 0,
    timeLimit: lobby.settings.timeLimit
  };

  // Helper to construct round payload
  function getRoundPayload(roundObj) {
    const { type, item } = roundObj;
    let payload = {
      imageType: type,
      flagPath: null, // Default null for Capital
      target: "",
      synonyms: [],
      questionText: "" // New field
    };

    if (type === 'language') {
      // Pick random image 1-3
      const num = Math.floor(Math.random() * 3) + 1;
      payload.flagPath = `languages/${item.id}_${num}.png`;
      payload.target = item.name;
      payload.synonyms = item.synonyms || [];
      payload.questionText = "Guess the Language";
    } else if (type === 'capital') {
      payload.target = item.capital;
      payload.questionText = `What is the capital of ${item.name}?`;
      // No synonyms for capitals in this version, or strict match
      payload.synonyms = []; 
    } else {
      // Flag or Map
      payload.flagPath = (type === 'map') 
        ? `maps/${item.code}.svg` 
        : (item.flag_4x3 || `flags/4x3/${item.code}.svg`);
      
      payload.target = item.name;
      
      // Filter synonyms for this specific country from the big map
      const relevant = Object.keys(data.synonyms).filter(k => data.synonyms[k] === item.name);
      payload.synonyms = relevant;
      payload.questionText = "Guess the Country";
    }

    return payload;
  }

  function sendQuestion() {
    if (currentIndex >= rounds.length) {
      endGame();
      return;
    }

    const round = rounds[currentIndex];
    const answersThisRound = new Set(); 
    isRoundActive = true;

    const payload = getRoundPayload(round);

    // [SNAPSHOT] Update Lobby State
    lobby.gameState.currentQuestion = {
      index: currentIndex + 1,
      total: rounds.length,
      ...payload
    };
    lobby.gameState.startTime = Date.now();
    lobby.gameState.isRoundActive = true;

    broadcast("questionStart", {
      ...lobby.gameState.currentQuestion,
      timeLimit: lobby.settings.timeLimit,
      playerCount: Object.keys(lobby.players).length
    });

    const startTime = Date.now();

    function finishQuestion() {
      if (!isRoundActive) return;
      isRoundActive = false;
      lobby.gameState.isRoundActive = false;
      
      clearTimeout(currentTimer);

      let preloadData = null;
      if (currentIndex + 1 < rounds.length) {
        const nextRound = rounds[currentIndex + 1];
        const nextPayload = getRoundPayload(nextRound);
        // Only preload if there is an image (Flag/Map/Language)
        if (nextPayload.flagPath) {
           preloadData = { url: nextPayload.flagPath };
        }
      }

      broadcast("questionEnd", { 
        correctCountry: payload.target, // Reusing field name for compatibility
        preload: preloadData 
      });

      currentIndex++;
      setTimeout(() => { if (lobby.gameInProgress) sendQuestion(); }, 2000);
    }

    lobby.currentAnswerHandler = (pid, answer) => {
        if (!isRoundActive) return false;
        if (answersThisRound.has(pid)) return false;

        const timeTaken = Date.now() - startTime;
        
        // Pass specific target string to fuzzy
        const isCorrect = evaluateAnswer(answer, payload.target, payload.synonyms, config);

        answersThisRound.add(pid);
        if (isCorrect) {
          gameStats[pid].points += 1;
          gameStats[pid].totalTime += timeTaken;
        }

        broadcast("playerUpdate", {
          username: gameStats[pid].username,
          isCorrect: isCorrect,
          answeredCount: answersThisRound.size,
          totalPlayers: Object.keys(lobby.players).length
        });
        
        if (answersThisRound.size >= Object.keys(lobby.players).length) {
            setTimeout(finishQuestion, 500); 
        }
        
        return isCorrect;
    };

    currentTimer = setTimeout(() => { finishQuestion(); }, lobby.settings.timeLimit * 1000);
  }

  function endGame() {
    lobby.gameInProgress = false;
    lobby.gameState = null;
    lobby.currentAnswerHandler = null;
    Object.keys(lobby.players).forEach(pid => lobby.readyState[pid] = false);
    
    const leaderboard = Object.values(gameStats).sort((a, b) => {
      if (b.points !== a.points) return b.points - a.points;
      return a.totalTime - b.totalTime;
    });
    
    broadcast("gameOver", { leaderboard });
    broadcast("lobbyUpdate", lobby);
  }

  // Preload Q1 Logic
  if (rounds.length > 0) {
    const firstRound = rounds[0];
    const firstPayload = getRoundPayload(firstRound);
    
    // 1. If there's an image, tell client to download it now.
    if (firstPayload.flagPath) {
        broadcast("gamePreload", { url: firstPayload.flagPath });
    }
    
    // 2. [FIXED] ALWAYS wait 1.5 seconds so the 3-2-1 countdown finishes visibly.
    setTimeout(() => {
        if (lobby.gameInProgress) sendQuestion();
    }, 1500);

  } else {
    endGame();
  }
}

module.exports = { start };