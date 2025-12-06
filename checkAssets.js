const fs = require('fs');
const path = require('path');

// --- CONFIGURATION ---
// Adjust these if your folder structure is slightly different
const PATHS = {
    countriesJson: path.join(__dirname, 'src', 'data', 'country.json'),
    languagesJson: path.join(__dirname, 'src', 'data', 'languages.json'),
    flagsDir: path.join(__dirname, 'public', 'flags', '4x3'),
    mapsDir: path.join(__dirname, 'public', 'maps'),
    languagesDir: path.join(__dirname, 'public', 'languages')
};

// Colors for Console Output
const RESET = "\x1b[0m";
const RED = "\x1b[31m";
const GREEN = "\x1b[32m";
const YELLOW = "\x1b[33m";
const BOLD = "\x1b[1m";

function checkFileExists(filePath) {
    return fs.existsSync(filePath);
}

function runCheck() {
    console.log(`${BOLD}🔍 STARTING ASSET SCAN...${RESET}\n`);
    
    let missingCount = 0;
    
    // 1. CHECK COUNTRIES (Flags & Maps)
    if (fs.existsSync(PATHS.countriesJson)) {
        const countries = JSON.parse(fs.readFileSync(PATHS.countriesJson, 'utf8'));
        console.log(`Loaded ${countries.length} countries.`);

        countries.forEach(c => {
            // Check Flag
            // Note: Assuming standard naming convention: code.svg
            const flagName = `${c.code}.svg`; 
            const flagPath = path.join(PATHS.flagsDir, flagName);
            
            if (!checkFileExists(flagPath)) {
                console.log(`${RED}[MISSING FLAG]${RESET} ${c.name} (${c.code}) -> Expected: ${flagName}`);
                missingCount++;
            }

            // Check Map
            const mapName = `${c.code}.svg`;
            const mapPath = path.join(PATHS.mapsDir, mapName);
            
            if (!checkFileExists(mapPath)) {
                console.log(`${RED}[MISSING MAP ]${RESET} ${c.name} (${c.code}) -> Expected: ${mapName}`);
                missingCount++;
            }
        });
    } else {
        console.log(`${RED}ERROR: Could not find country.json at ${PATHS.countriesJson}${RESET}`);
    }

    console.log("-".repeat(30));

    // 2. CHECK LANGUAGES
    if (fs.existsSync(PATHS.languagesJson)) {
        const languages = JSON.parse(fs.readFileSync(PATHS.languagesJson, 'utf8'));
        console.log(`Loaded ${languages.length} languages.`);

        languages.forEach(l => {
            // Check 3 variants for each language
            for (let i = 1; i <= 3; i++) {
                const imgName = `${l.id}_${i}.png`;
                const imgPath = path.join(PATHS.languagesDir, imgName);

                if (!checkFileExists(imgPath)) {
                    console.log(`${RED}[MISSING LANG]${RESET} ${l.name} -> Expected: ${imgName}`);
                    missingCount++;
                }
            }
        });
    } else {
        console.log(`${RED}ERROR: Could not find languages.json at ${PATHS.languagesJson}${RESET}`);
    }

    console.log("\n" + "=".repeat(30));
    if (missingCount === 0) {
        console.log(`${GREEN}${BOLD}✅ ALL ASSETS FOUND! Game is safe.${RESET}`);
    } else {
        console.log(`${YELLOW}${BOLD}⚠️  FOUND ${missingCount} MISSING ASSETS.${RESET}`);
        console.log("Tip: You can either add these files to 'public/' OR remove the entry from the JSON.");
    }
}

runCheck();