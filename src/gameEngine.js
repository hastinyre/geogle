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
  let nextRoundInfo = null;

  // Initialize Game State for Snapshots
  lobby.gameState = {
    active: true,
    questionIndex: 0,
    totalQuestions: questions.length,
    currentQuestion: null,
    startTime: 0,
    timeLimit: lobby.settings.timeLimit
  };

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

    const useMap = nextRoundInfo ? nextRoundInfo.useMap : determineQuestionType();
    nextRoundInfo = null; 
    
    const imagePath = useMap ? `maps/${q.code}.svg` : (q.flag_4x3 || `flags/4x3/${q.code}.svg`);
    const relevantSynonyms = Object.keys(data.synonyms).filter(key => data.synonyms[key] === q.name);

    // [SNAPSHOT] Update Lobby State
    lobby.gameState.currentQuestion = {
      index: currentIndex + 1,
      total: questions.length,
      flagPath: imagePath,
      imageType: useMap ? 'map' : 'flag',
      target: q.name,
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
      lobby.gameState.isRoundActive = false; // Mark round as done in state
      
      clearTimeout(currentTimer);

      let preloadData = null;
      if (currentIndex + 1 < questions.length) {
        const nextQ = questions[currentIndex + 1];
        const nextUseMap = determineQuestionType();
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
    lobby.gameState = null; // Clear state
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
    const firstUseMap = determineQuestionType();
    nextRoundInfo = { useMap: firstUseMap };
    const firstPath = firstUseMap ? `maps/${firstQ.code}.svg` : (firstQ.flag_4x3 || `flags/4x3/${firstQ.code}.svg`);
    
    broadcast("gamePreload", { url: firstPath });
    setTimeout(() => {
        if (lobby.gameInProgress) sendQuestion();
    }, 1500);
  } else {
    endGame();
  }
}

module.exports = { start };