const fs = require('fs');
const path = require('path');
const axios = require('axios');
const PDFParser = require("pdf2json");

async function downloadAndParse(url) {
  console.log(`Downloading ${url}...`);
  const response = await axios({ url, method: 'GET', responseType: 'arraybuffer' });
  
  return new Promise((resolve, reject) => {
    const pdfParser = new PDFParser();
    pdfParser.on("pdfParser_dataError", errData => reject(errData.parserError));
    pdfParser.on("pdfParser_dataReady", pdfData => resolve(pdfData));
    pdfParser.parseBuffer(response.data);
  });
}

function extractAwards(pdfData, isConvention) {
  const awards = [];
  let currentCategory = 'Unknown Category';

  pdfData.Pages.forEach(page => {
    let rows = [];
    page.Texts.forEach(textObj => {
      const text = decodeURIComponent(textObj.R[0].T).trim();
      if (!text) return;

      const y = textObj.y;
      const x = textObj.x;
      
      let row = rows.find(r => Math.abs(r.y - y) < 0.1);
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
        // NYCDA headers are usually centered (x > 10)
        currentCategory = row.cols.map(c => c.text).join(' ');
        return;
      }

      // If it's an award row
      if (row.cols[0].x < 10) { // Usually placement or dancer name starts around x=4
        if (isConvention) {
          // Convention Format: Dancer Name (x~4) | Studio (x~13)
          if (row.cols.length >= 2) {
            awards.push({
              category: currentCategory,
              award_type: currentCategory.toLowerCase().includes('runner') ? 'Runner-Up' : 'Outstanding Dancer',
              place: null,
              performance_name: '(Convention)',
              dancer_name: row.cols[0].text,
              studio: row.cols[row.cols.length - 1].text // The last column is usually the studio
            });
          }
        } else {
          // Competition Format: Placement (x~4) | Routine (x~6) | Dancer (x~19) | Studio (x~31)
          if (row.cols.length >= 3) {
            const place = row.cols[0].text;
            const routine = row.cols[1].text;
            let dancer = null;
            let studio = '';
            
            if (row.cols.length === 4) {
              dancer = row.cols[2].text;
              studio = row.cols[3].text;
            } else {
              // Usually groups (no dancer name)
              studio = row.cols[2].text;
            }
            
            awards.push({
              category: currentCategory,
              award_type: currentCategory.toLowerCase().includes('overall') ? 'Overall' : 'High Score',
              place: place,
              performance_name: routine,
              dancer_name: dancer,
              studio: studio
            });
          }
        }
      }
    });
  });

  return awards;
}

async function run() {
  const compUrl = 'https://cdn2.assets-servd.host/nyc-dance/production/assets/images/Houston-Competition-24-25.pdf?dm=1731962643';
  const convUrl = 'https://cdn2.assets-servd.host/nyc-dance/production/assets/images/Houston-Convention-24-25.pdf?dm=1731962646';

  try {
    const compData = await downloadAndParse(compUrl);
    const compAwards = extractAwards(compData, false);

    const convData = await downloadAndParse(convUrl);
    const convAwards = extractAwards(convData, true);

    const allAwards = [...compAwards, ...convAwards];

    let output = '=== NYCDA HOUSTON 2024-2025 RESULTS ===\n\n';
    
    output += '--- COMPETITION RESULTS ---\n';
    compAwards.forEach(a => {
      output += `Cat: ${a.category} | Place: ${a.place} | Routine: ${a.performance_name} | Dancer: ${a.dancer_name || 'N/A'} | Studio: ${a.studio}\n`;
    });

    output += '\n--- CONVENTION RESULTS ---\n';
    convAwards.forEach(a => {
      output += `Cat: ${a.category} | Award: ${a.award_type} | Dancer: ${a.dancer_name} | Studio: ${a.studio}\n`;
    });

    fs.writeFileSync('nycda_results_inspection.txt', output);
    console.log('Results saved to nycda_results_inspection.txt');
  } catch (e) {
    console.error('Error:', e);
  }
}

run();
