// src/gameEngine.js
const { evaluateAnswer } = require("./fuzzy");

function pickQuestions(data, settings) {
  const { countries, languages } = data;
  const { continents, modes, questions: totalCount } = settings;

  // Default to all modes if none selected (Safety fallback)
  const activeModes = modes && modes.length > 0 ? modes : ['flags', 'maps', 'languages'];
  
  // 1. Calculate Quotas (Fair Split)
  const modeCount = activeModes.length;
  const baseQuota = Math.floor(totalCount / modeCount);
  const remainder = totalCount % modeCount;

  // Shuffle modes to randomly assign the remainder questions
  const shuffledModes = [...activeModes];
  for (let i = shuffledModes.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [shuffledModes[i], shuffledModes[j]] = [shuffledModes[j], shuffledModes[i]];
  }

  const finalQuestions = [];

  // 2. Process each mode with its specific quota
  shuffledModes.forEach((mode, index) => {
    // Determine exact number of questions for this mode
    // The first 'remainder' number of modes get +1 question
    let countForThisMode = baseQuota;
    if (index < remainder) {
      countForThisMode++;
    }

    if (countForThisMode === 0) return;

    const modePool = [];

    if (mode === 'flags' || mode === 'maps') {
      // Filter Countries by Continent
      const countryList = Object.values(countries);
      const filtered = continents && continents.length > 0
          ? countryList.filter((c) => continents.includes(c.continent))
          : countryList;

      filtered.forEach(c => {
        // [NEW] Safety Check: Skip countries marked with noMap only in Maps mode
        if (mode === 'maps' && c.noMap) return;

        modePool.push({
          ...c,
          type: mode === 'flags' ? 'flag' : 'map',
          targetName: c.name
        });
      });
    } 
    else if (mode === 'languages') {
      // Use All Languages (Languages ignore continent filters)
      languages.forEach(l => {
        const variant = Math.floor(Math.random() * 3) + 1; // Pick 1, 2, or 3
        modePool.push({
          ...l,
          type: 'language',
          targetName: l.name,
          code: l.id,
          variant: variant
        });
      });
    }

    // Shuffle the specific mode pool
    for (let i = modePool.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [modePool[i], modePool[j]] = [modePool[j], modePool[i]];
    }

    // Take the calculated quota
    finalQuestions.push(...modePool.slice(0, countForThisMode));
  });

  // 3. Final Shuffle (Mix the types together so they aren't grouped)
  for (let i = finalQuestions.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [finalQuestions[i], finalQuestions[j]] = [finalQuestions[j], finalQuestions[i]];
  }

  return finalQuestions;
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
        // Languages might not have pre-calculated tokens, so we rely on simple evaluation
        const evalObj = { name: q.targetName, tokens: q.tokens }; 
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