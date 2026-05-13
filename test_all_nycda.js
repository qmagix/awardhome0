const fs = require('fs');
const path = require('path');
const PDFParser = require("pdf2json");

const dir = path.join(__dirname, 'tobeprocessed', 'pdf', 'nycda');
const files = fs.readdirSync(dir).filter(f => f.endsWith('.pdf') && !f.startsWith('NOT-'));

function extractAwards(pdfData) {
  const awards = [];
  let currentCategory = 'Unknown Category';

  pdfData.Pages.forEach(page => {
    let rows = [];
    page.Texts.forEach(textObj => {
      const text = decodeURIComponent(textObj.R[0].T).trim();
      if (!text) return;

      const y = textObj.y;
      const x = textObj.x;
      
      let row = rows.find(r => Math.abs(r.y - y) < 0.2); // slight increase in tolerance
      if (!row) {
        row = { y: y, cols: [] };
        rows.push(row);
      }
      
      row.cols.push({ x: x, text: text });
    });

    rows.sort((a, b) => a.y - b.y);

    rows.forEach(row => {
      row.cols.sort((a, b) => a.x - b.x);
      
      // Determine if row is a header
      if (row.cols.length <= 2 && row.cols[0].x > 10) {
        currentCategory = row.cols.map(c => c.text).join(' ');
        return;
      }

      if (row.cols.length >= 2 && row.cols[0].x < 10) {
        // Just extract count for now
        awards.push(row.cols.map(c => c.text).join(' | '));
      }
    });
  });

  return awards;
}

async function run() {
  console.log(`Found ${files.length} PDFs to test.`);
  let successCount = 0;
  let failCount = 0;

  for (const file of files.slice(0, 10)) { // test first 10
    console.log(`Testing ${file}...`);
    try {
      const dataBuffer = fs.readFileSync(path.join(dir, file));
      const pdfParser = new PDFParser();
      
      const parsedData = await new Promise((resolve, reject) => {
        pdfParser.on("pdfParser_dataError", errData => reject(errData.parserError));
        pdfParser.on("pdfParser_dataReady", resolve);
        pdfParser.parseBuffer(dataBuffer);
      });

      const awards = extractAwards(parsedData);
      if (awards.length > 0) {
        successCount++;
        console.log(`  -> SUCCESS (${awards.length} awards)`);
      } else {
        failCount++;
        console.log(`  -> FAILED (0 awards)`);
      }
    } catch (e) {
      failCount++;
      console.log(`  -> ERROR: ${e.message}`);
    }
  }
  
  console.log(`\nTest completed: ${successCount} Success, ${failCount} Fail`);
}

run();
