const fs = require('fs');
const path = require('path');
const puppeteer = require('puppeteer');

// LOAD TURKISH DATA ONLY
const data = require('./turkish.json');

// Output Directory
const outputDir = path.join(__dirname, 'fonts');
if (!fs.existsSync(outputDir)) {
  fs.mkdirSync(outputDir, { recursive: true });
}

function updateProgress(current, total, currentLang) {
    const width = 30;
    const percentage = Math.round((current / total) * 100);
    const filled = Math.floor((width * current) / total);
    const empty = width - filled;
    const bar = '█'.repeat(filled) + '░'.repeat(empty);
    process.stdout.write(`\r\x1b[36m[${bar}] ${percentage}% | ${current}/${total} | Processing: ${currentLang.padEnd(10)}\x1b[0m`);
}

(async () => {
  console.log("\n🚀 Starting Turkish Asset Generation...");
  
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

    for (let i = 0; i < sentences.length; i++) {
      const text = sentences[i];
      // Filename: turkish_1.png
      const filename = `${langName.toLowerCase()}_${i + 1}.png`; 
      
      const htmlContent = `
        <html>
          <head>
            <style>
              body {
                margin: 0;
                display: flex;
                flex-direction: column; 
                justify-content: center;
                align-items: center;
                height: 100vh;
                background: white; 
                text-align: center;
                padding: 40px;
                box-sizing: border-box;
                font-family: "Segoe UI", "Arial", sans-serif;
              }

              .header {
                font-size: 14px;
                text-transform: uppercase;
                letter-spacing: 2px;
                color: #888;
                font-weight: 600;
                margin-bottom: 25px;
                font-family: "Verdana", sans-serif;
              }

              .text-box {
                font-size: 32px;
                line-height: 1.6;
                font-weight: bold;
                color: #222;
                word-break: break-word;
                /* Standard fonts are enough for Turkish */
                font-family: "Segoe UI", "Helvetica", "Arial", sans-serif;
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