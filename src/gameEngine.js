const { evaluateAnswer } = require("./fuzzy");

function pickQuestions(data, settings) {
  const { countries, languages } = data;
  const { continents, modes, questions: count } = settings;
  
  // Default to all modes if none selected (safety check)
  const activeModes = modes && modes.length > 0 ? modes : ['flags', 'maps', 'languages'];
  const pool = [];

  // 1. Process Countries (Flags & Maps)
  // We only filter countries by continent if we are actually using Flags or Maps
  if (activeModes.includes('flags') || activeModes.includes('maps')) {
    const countryList = Object.values(countries);
    const filteredCountries = continents && continents.length > 0
        ? countryList.filter((c) => continents.includes(c.continent))
        : countryList;

    filteredCountries.forEach(c => {
      if (activeModes.includes('flags')) {
        pool.push({ ...c, type: 'flag', targetName: c.name });
      }
      if (activeModes.includes('maps')) {
        pool.push({ ...c, type: 'map', targetName: c.name });
      }
    });
  }

  // 2. Process Languages
  // Languages are NEVER filtered by continent
  if (activeModes.includes('languages') && languages) {
    languages.forEach(l => {
      // Randomly pick variant 1, 2, or 3
      const variant = Math.floor(Math.random() * 3) + 1;
      pool.push({
        ...l,
        type: 'language',
        targetName: l.name,
        code: l.id, // Use ID for filename construction
        variant: variant
      });
    });
  }

  // 3. Shuffle Pool
  for (let i = pool.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [pool[i], pool[j]] = [pool[j], pool[i]];
  }

  // 4. Slice to desired count
  return pool.slice(0, count);
}

function start(broadcast, lobby, { config, data }) {
  const players = lobby.players || {};
  const gameStats = {};
  Object.keys(players).forEach(pid => {
    gameStats[pid] = { points: 0, totalTime: 0, username: players[pid].username || "Guest" };
  });

  const questions = pickQuestions(data, lobby.settings);
  let currentIndex = 0;
  let currentTimer = null;
  let isRoundActive = false;
  
  // Initialize Game State for Snapshots
  lobby.gameState = {
    active: true,
    questionIndex: 0,
    totalQuestions: questions.length,
    currentQuestion: null,
    startTime: 0,
    timeLimit: lobby.settings.timeLimit
  };

  function getImagePath(q) {
    if (q.type === 'map') return `maps/${q.code}.svg`;
    if (q.type === 'language') return `languages/${q.code}_${q.variant}.png`;
    // Default to flag
    return q.flag_4x3 || `flags/4x3/${q.code}.svg`;
  }

  function sendQuestion() {
    if (currentIndex >= questions.length) {
      endGame();
      return;
    }

    const q = questions[currentIndex];
    const answersThisRound = new Set(); 
    isRoundActive = true;
    
    const imagePath = getImagePath(q);
    const relevantSynonyms = Object.keys(data.synonyms).filter(key => data.synonyms[key] === q.targetName);

    // [SNAPSHOT] Update Lobby State
    lobby.gameState.currentQuestion = {
      index: currentIndex + 1,
      total: questions.length,
      flagPath: imagePath,
      imageType: q.type, // 'flag', 'map', or 'language'
      target: q.targetName,
      synonyms: relevantSynonyms
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
      if (currentIndex + 1 < questions.length) {
        const nextQ = questions[currentIndex + 1];
        preloadData = { url: getImagePath(nextQ) };
      }

      broadcast("questionEnd", { 
        correctCountry: q.targetName,
        preload: preloadData 
      });

      currentIndex++;
      setTimeout(() => { if (lobby.gameInProgress) sendQuestion(); }, 2000);
    }

    lobby.currentAnswerHandler = (pid, answer) => {
        if (!isRoundActive) return false;
        if (answersThisRound.has(pid)) return false;

        const timeTaken = Date.now() - startTime;
        
        // Construct a temporary object compatible with evaluateAnswer
        const evalObj = { name: q.targetName, tokens: q.tokens }; // tokens might need generation if not present for languages
        const isCorrect = evaluateAnswer(answer, evalObj, data.synonyms, config);

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
  if (questions.length > 0) {
    const firstQ = questions[0];
    broadcast("gamePreload", { url: getImagePath(firstQ) });
    setTimeout(() => {
        if (lobby.gameInProgress) sendQuestion();
    }, 1500);
  } else {
    endGame();
  }
}

module.exports = { start };