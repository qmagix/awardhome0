const fs = require('fs');
const path = require('path');
const PDFParser = require("pdf2json");

const baseDir = path.join(__dirname, 'tobeprocessed', 'pdf', 'showstopper');
const txtDir = path.join(baseDir, 'txt');

if (!fs.existsSync(txtDir)) {
  fs.mkdirSync(txtDir, { recursive: true });
}

function extractAwards(pdfData) {
  const awards = [];
  let currentAgeDivCat = 'Unknown Category';
  let currentLevel = 'Unknown Level';
  let lastAward = null;
  let inOveralls = true;

  pdfData.Pages.forEach(page => {
    let rows = [];
    page.Texts.forEach(textObj => {
      let text = '';
      try {
        text = decodeURIComponent(textObj.R[0].T).trim();
      } catch(e) {
        text = unescape(textObj.R[0].T).trim(); // fallback
      }
      if (!text) return;

      const y = textObj.y;
      const x = textObj.x;
      
      let row = rows.find(r => Math.abs(r.y - y) < 0.4); // Tolerance for Showstopper rows
      if (!row) {
        row = { y: y, cols: [] };
        rows.push(row);
      }
      
      row.cols.push({ x: x, text: text });
    });

    rows.sort((a, b) => a.y - b.y);

    rows.forEach(row => {
      row.cols.sort((a, b) => a.x - b.x);
      
      if (row.cols.length > 0) {
        const firstText = row.cols[0].text;
        
        // Handle section headers
        if (row.cols.length === 1) {
          if (firstText.includes('Overall Score Reports')) {
            inOveralls = true;
            return;
          }
          if (firstText.toLowerCase().includes('program') || firstText.includes('Rising Star') || firstText.includes('Shining Star') || firstText.includes('Crystal Award')) {
            inOveralls = false;
            return;
          }
        }

        if (!inOveralls) return;

        if (row.cols.length === 1 && !isNaN(parseInt(firstText)) && firstText.length < 3) return; // likely a page number

        const upperFirst = firstText.toUpperCase();
        
        // Check if it's a Level
        if (upperFirst === 'PERFORMANCE' || upperFirst === 'ADVANCED' || upperFirst === 'COMPETITIVE' || upperFirst.includes('-STAR')) {
          currentLevel = firstText;
          return;
        }

        // Check if it's an Age Division (e.g. "Mini (8 yrs. & Under) Solo")
        if (upperFirst.includes('YRS.') || upperFirst.includes('SOLO') || upperFirst.includes('DUET') || upperFirst.includes('SMALL') || upperFirst.includes('LARGE') || upperFirst.includes('SUPER') || upperFirst.includes('PRODUCTION')) {
          currentAgeDivCat = firstText;
          // Clear lastAward when changing categories so continuation lines don't leak
          lastAward = null;
          return;
        }

        // Check if it's an award row (starts with Place number)
        const possiblePlace = parseInt(firstText);
        // An award row must start with a number and have at least routine info (Place, Entry, Routine)
        if (!isNaN(possiblePlace) && row.cols.length >= 3) {
          let place = firstText;
          
          // Sometimes Entry is merged or Score is missing, let's reliably find the routine string
          // Routine string typically contains ' - ' (Routine - Studio - City)
          let routineColIndex = -1;
          for (let i = 1; i < Math.min(row.cols.length, 4); i++) {
             if (row.cols[i].text.includes(' - ')) {
                routineColIndex = i;
                break;
             }
          }
          
          // If we can't find ' - ', maybe we just take index 2
          if (routineColIndex === -1 && row.cols.length >= 3) {
             routineColIndex = 2;
          }

          let routineStr = row.cols[routineColIndex].text;
          
          // Dancers are everything after the score (which is usually the column right after routine)
          // E.g., cols: 0:Place, 1:Entry, 2:Routine, 3:Score, 4+:Dancers
          let dancerIndex = routineColIndex + 2; 
          
          let dancers = [];
          for (let i = dancerIndex; i < row.cols.length; i++) {
            dancers.push(row.cols[i].text);
          }
          let dancerStr = dancers.join(', ');

          // Split routine string "Routine - Studio - Location"
          let performance_name = routineStr;
          let studio = 'Unknown Studio';
          const parts = routineStr.split(' - ');
          if (parts.length >= 2) {
             performance_name = parts[0].trim();
             studio = parts[1].trim();
          }

          let award = {
             category: currentAgeDivCat,
             award_class: 'overall',
             award_type: 'High Score',
             place: place,
             performance_name: performance_name,
             dancer_name: dancerStr,
             studio: studio,
             level: currentLevel
          };
          
          awards.push(award);
          lastAward = award;
          return;
        }
        
        // If it doesn't start with a number, and isn't a header, it's likely a dancer continuation line
        if (isNaN(possiblePlace) && lastAward) {
           const continuation = row.cols.map(c => c.text).join(', ');
           lastAward.dancer_name += (lastAward.dancer_name ? ', ' : '') + continuation;
        }
      }
    });
  });

  return awards;
}

async function processPdf(file, year) {
  const filePath = path.join(baseDir, year, file);
  console.log(`Processing ${year}/${file}...`);
  try {
    const dataBuffer = fs.readFileSync(filePath);
    const pdfParser = new PDFParser();
    
    const parsedData = await new Promise((resolve, reject) => {
      pdfParser.on("pdfParser_dataError", errData => reject(errData.parserError));
      pdfParser.on("pdfParser_dataReady", resolve);
      pdfParser.parseBuffer(dataBuffer);
    });

    const awards = extractAwards(parsedData);
    if (awards.length > 0) {
      let output = `=== ${file} ===\n\n`;
      awards.forEach(a => {
        output += `Cat: ${a.category} | Level: ${a.level} | Place: ${a.place} | Routine: ${a.performance_name} | Dancer: ${a.dancer_name || 'N/A'} | Studio: ${a.studio}\n`;
      });
      
      const txtPath = path.join(txtDir, year);
      if (!fs.existsSync(txtPath)) fs.mkdirSync(txtPath, { recursive: true });
      fs.writeFileSync(path.join(txtPath, `${file.replace('.pdf', '')}.txt`), output);
      console.log(`  -> SUCCESS (${awards.length} awards)`);
    } else {
      console.log(`  -> FAILED (0 awards)`);
    }
  } catch (e) {
    console.log(`  -> ERROR -> ${e.message}`);
  }
}

async function run() {
  const years = ['2023', '2024', '2025'];
  for (const year of years) {
    const yearDir = path.join(baseDir, year);
    if (fs.existsSync(yearDir)) {
      const files = fs.readdirSync(yearDir).filter(f => f.endsWith('.pdf'));
      for (const file of files) {
        await processPdf(file, year);
      }
    }
  }
  console.log(`\nExtraction complete.`);
}

run();
