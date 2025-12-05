// server/fuzzy.js

// Helper to clean strings locally (Self-contained)
function clean(str) {
  if (!str || typeof str !== 'string') return "";
  return str
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "") // Remove accents
    .replace(/[^a-z0-9]+/g, " ")     // Remove punctuation
    .replace(/\s+/g, " ")            // Collapse spaces
    .trim();
}

function getTokens(str) {
  return clean(str).split(" ").filter(t => t.length > 0);
}

function levenshtein(a, b) {
  if (!a) return b ? b.length : 0;
  if (!b) return a ? a.length : 0;
  const m = a.length;
  const n = b.length;
  const dp = Array(m + 1).fill(0).map(() => Array(n + 1).fill(0));

  for (let i = 0; i <= m; i++) dp[i][0] = i;
  for (let j = 0; j <= n; j++) dp[0][j] = j;

  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      dp[i][j] = Math.min(dp[i - 1][j] + 1, dp[i][j - 1] + 1, dp[i - 1][j - 1] + cost);
    }
  }
  return dp[m][n];
}

module.exports.evaluateAnswer = function (inputRaw, countryObj, synonyms, config) {
  try {
    if (!countryObj || !countryObj.name) return false;

    const input = clean(inputRaw);
    if (!input) return false;

    const targetName = clean(countryObj.name);
    
    // 1. Direct Match
    if (input === targetName) return true;

    // 2. Synonym Match
    if (synonyms && synonyms[input]) {
      const mapped = clean(synonyms[input]);
      if (mapped === targetName) return true;
    }

    // 3. Fuzzy / Levenshtein
    // If country object doesn't have pre-calc tokens, make them now
    const targetTokens = countryObj.tokens || getTokens(targetName);
    const inputTokens = getTokens(input);

    // Levenshtein Score
    const dist = levenshtein(input, targetName);
    const maxLen = Math.max(input.length, targetName.length);
    const levScore = (1 - dist / maxLen) * 100;

    // Token Set Ratio (e.g. "Republic of Congo" vs "Congo")
    let intersect = 0;
    const targetSet = new Set(targetTokens);
    inputTokens.forEach(t => { if(targetSet.has(t)) intersect++; });
    const tokenScore = (intersect / targetSet.size) * 100;

    // Config Thresholds (Safe fallback)
    const THRESHOLD = (config && config.FUZZY && config.FUZZY.THRESHOLD_DEFAULT) || 85;
    
    // Special case: Short names (e.g. "Chad", "Fiji") need strict matching
    if (targetName.length <= 4) {
      return levScore > 95; 
    }

    return levScore >= THRESHOLD || tokenScore >= 100;

  } catch (err) {
    console.error("Fuzzy Check Error:", err);
    return false; // Fail safe
  }
};