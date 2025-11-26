// src/gameEngine.js
const { evaluateAnswer } = require("./fuzzy");

function pickQuestions(countries, continents, count) {
  const list = Object.values(countries);
  const filtered = continents && continents.length > 0
      ? list.filter((c) => continents.includes(c.continent))
      : list;

  for (let i = filtered.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [filtered[i], filtered[j]] = [filtered[j], filtered[i]];
  }
  return filtered.slice(0, count);
}

function start(broadcast, lobby, { config, data }) {
  const players = lobby.players || {};
  const gameStats = {};
  Object.keys(players).forEach(pid => {
    gameStats[pid] = { points: 0, totalTime: 0, username: players[pid].username || "Guest" };
  });

  const questions = pickQuestions(data.countries, lobby.settings.continents, lobby.settings.questions);
  let currentIndex = 0;
  let currentTimer = null;
  let isRoundActive = false;

  // Store decision for the next round (or the first round)
  let nextRoundInfo = null;

  function determineQuestionType() {
    const type = lobby.settings.gameType || 'mixed';
    if (type === 'maps') return true; 
    if (type === 'flags') return false; 
    return Math.random() > 0.5; 
  }

  function sendQuestion() {
    if (currentIndex >= questions.length) {
      endGame();
      return;
    }

    const q = questions[currentIndex];
    const answersThisRound = new Set(); 
    isRoundActive = true;

    // Use pre-calculated type if available, otherwise calculate now
    const useMap = nextRoundInfo ? nextRoundInfo.useMap : determineQuestionType();
    nextRoundInfo = null; 
    
    const imagePath = useMap ? `maps/${q.code}.svg` : (q.flag_4x3 || `flags/4x3/${q.code}.svg`);

    // --- PREPARE CLIENT PREDICTION DATA ---
    // Find all synonyms that point to this specific country name
    // e.g. If q.name is "United States", find ["usa", "america", ...]
    const relevantSynonyms = Object.keys(data.synonyms).filter(key => data.synonyms[key] === q.name);

    broadcast("questionStart", {
      index: currentIndex + 1,
      total: questions.length,
      flagPath: imagePath,
      imageType: useMap ? 'map' : 'flag',
      timeLimit: lobby.settings.timeLimit,
      playerCount: Object.keys(lobby.players).length,
      target: q.name,          // For client prediction
      synonyms: relevantSynonyms // For client prediction (to avoid false reds)
    });

    const startTime = Date.now();

    function finishQuestion() {
      if (!isRoundActive) return;
      isRoundActive = false;
      clearTimeout(currentTimer);

      // --- PRELOAD LOGIC (Next Question) ---
      let preloadData = null;
      if (currentIndex + 1 < questions.length) {
        const nextQ = questions[currentIndex + 1];
        const nextUseMap = determineQuestionType();
        
        // Store this decision
        nextRoundInfo = { useMap: nextUseMap };

        const nextPath = nextUseMap ? `maps/${nextQ.code}.svg` : (nextQ.flag_4x3 || `flags/4x3/${nextQ.code}.svg`);
        preloadData = { url: nextPath };
      }

      broadcast("questionEnd", { 
        correctCountry: q.name,
        preload: preloadData 
      });

      currentIndex++;
      setTimeout(() => { if (lobby.gameInProgress) sendQuestion(); }, 2000);
    }

    lobby.currentAnswerHandler = (pid, answer) => {
        if (!isRoundActive) return false;
        if (answersThisRound.has(pid)) return false;

        const timeTaken = Date.now() - startTime;
        const isCorrect = evaluateAnswer(answer, q, data.synonyms, config);

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
    lobby.currentAnswerHandler = null;
    Object.keys(lobby.players).forEach(pid => lobby.readyState[pid] = false);
    
    const leaderboard = Object.values(gameStats).sort((a, b) => {
      if (b.points !== a.points) return b.points - a.points;
      return a.totalTime - b.totalTime;
    });
    
    broadcast("gameOver", { leaderboard });
    broadcast("lobbyUpdate", lobby);
  }

  // --- PRELOAD QUESTION 1 ---
  if (questions.length > 0) {
    const firstQ = questions[0];
    const firstUseMap = determineQuestionType();
    
    // Lock in the decision for Q1
    nextRoundInfo = { useMap: firstUseMap };
    
    const firstPath = firstUseMap ? `maps/${firstQ.code}.svg` : (firstQ.flag_4x3 || `flags/4x3/${firstQ.code}.svg`);
    
    // Tell client to download NOW
    broadcast("gamePreload", { url: firstPath });
    
    // Wait 1.5s before starting Q1 to give time for download
    setTimeout(() => {
        if (lobby.gameInProgress) sendQuestion();
    }, 1500);
  } else {
    // Edge case: 0 questions
    endGame();
  }
}

module.exports = { start };