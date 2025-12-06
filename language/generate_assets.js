const fs = require('fs');
const path = require('path');
const puppeteer = require('puppeteer');
const data = require('./font_data.json');

// Output Directory
const outputDir = path.join(__dirname, 'fonts');
if (!fs.existsSync(outputDir)) {
  fs.mkdirSync(outputDir, { recursive: true });
}

// RTL Languages
const rtlLanguages = new Set(["Arabic", "Hebrew", "Urdu", "Persian", "Maldivian"]);

function updateProgress(current, total, currentLang) {
    const width = 30;
    const percentage = Math.round((current / total) * 100);
    const filled = Math.floor((width * current) / total);
    const empty = width - filled;
    const bar = '█'.repeat(filled) + '░'.repeat(empty);
    process.stdout.write(`\r\x1b[36m[${bar}] ${percentage}% | ${current}/${total} | Processing: ${currentLang.padEnd(10)}\x1b[0m`);
}

(async () => {
  console.log("\n🚀 Starting Asset Generation (With Headers)...");
  
  const browser = await puppeteer.launch({
    headless: "new",
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  });

  const page = await browser.newPage();
  
  // Disable timeout
  await page.setDefaultNavigationTimeout(0); 
  await page.setViewport({ width: 600, height: 400, deviceScaleFactor: 2 });

  const keys = Object.keys(data);
  const totalImages = keys.length * 3;
  let count = 0;

  for (const langName of keys) {
    const sentences = data[langName];
    const isRtl = rtlLanguages.has(langName);

    for (let i = 0; i < sentences.length; i++) {
      const text = sentences[i];
      // Filename: hindi_1.png
      const filename = `${langName.toLowerCase()}_${i + 1}.png`; 
      
      const htmlContent = `
        <html>
          <head>
            <style>
              body {
                margin: 0;
                display: flex;
                flex-direction: column; /* Stack items vertically */
                justify-content: center;
                align-items: center;
                height: 100vh;
                background: white; 
                text-align: center;
                padding: 40px;
                box-sizing: border-box;
                font-family: "Segoe UI", "Arial", sans-serif; /* Base font for header */
              }

              /* The New Header */
              .header {
                font-size: 14px;
                text-transform: uppercase;
                letter-spacing: 2px;
                color: #888;
                font-weight: 600;
                margin-bottom: 25px; /* Space between header and text */
                font-family: "Verdana", sans-serif;
              }

              /* The Puzzle Text */
              .text-box {
                font-size: 32px;
                line-height: 1.6;
                font-weight: bold;
                color: #222;
                word-break: break-word;
                direction: ${isRtl ? 'rtl' : 'ltr'};
                
                /* Massive Font Stack to catch all scripts from local system */
                font-family: 
                    "Noto Sans", "Noto Sans JP", "Noto Sans KR", "Noto Sans SC", 
                    "Noto Sans Devanagari", "Noto Sans Bengali", "Noto Sans Tamil", "Noto Sans Telugu",
                    "Noto Sans Gurmukhi", "Noto Sans Gujarati", "Noto Sans Malayalam", "Noto Sans Oriya", "Noto Sans Kannada",
                    "Noto Sans Arabic", "Noto Sans Hebrew", "Noto Sans Thai", "Noto Sans Lao", "Noto Sans Khmer", "Noto Sans Myanmar",
                    "Noto Sans Ethiopic", "Noto Sans Georgian", "Noto Sans Armenian", "Noto Sans Sinhala",
                    "Noto Sans Tibetan", "Noto Sans Javanese", "Noto Sans Thaana",
                    "Microsoft JhengHei", "Segoe UI", "Arial Unicode MS", "Calibri", sans-serif;
              }
            </style>
          </head>
          <body>
            <div class="header">Identify the Language</div>
            <div class="text-box">${text}</div>
          </body>
        </html>
      `;

      await page.setContent(htmlContent, { waitUntil: 'load' });
      
      await page.screenshot({
        path: path.join(outputDir, filename),
        fullPage: true
      });

      count++;
      updateProgress(count, totalImages, langName);
    }
  }

  await browser.close();
  console.log(`\n\n✅ Success! ${count} images generated in: ${outputDir}`);
})();