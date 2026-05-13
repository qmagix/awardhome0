const fs = require('fs');
const path = require('path');
const PDFParser = require("pdf2json");

const dir = path.join(__dirname, 'tobeprocessed', 'pdf', 'nycda');
const txtDir = path.join(dir, 'txt');

if (!fs.existsSync(txtDir)) {
  fs.mkdirSync(txtDir);
}

const files = fs.readdirSync(dir).filter(f => f.endsWith('.pdf') && !f.startsWith('NOT-') && !f.startsWith('IGNORE-'));

function isPre2022(filename) {
  const lower = filename.toLowerCase();
  if (lower.includes('2018') || lower.includes('2019') || lower.includes('2020') || lower.includes('2021')) return true;
  // look for -18-, -19-, -20-, -21-
  if (lower.match(/-18-|-19-|-20-|-21-|_18_|_19_|_20_|_21_/)) return true;
  if (lower.startsWith('18-') || lower.startsWith('19-') || lower.startsWith('20-') || lower.startsWith('21-')) return true;
  return false;
}

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
      
      let row = rows.find(r => Math.abs(r.y - y) < 0.2); // tolerance
      if (!row) {
        row = { y: y, cols: [] };
        rows.push(row);
      }
      
      row.cols.push({ x: x, text: text });
    });

    rows.sort((a, b) => a.y - b.y);

    rows.forEach(row => {
      row.cols.sort((a, b) => a.x - b.x);
      
      // Category header typically centered
      if (row.cols.length <= 2 && row.cols[0].x > 10) {
        // If the previous category was a studio award and this is a single centered string, it's actually the studio name!
        if (row.cols.length === 1 && (currentCategory.includes('Class Act') || currentCategory.includes('Good Sport') || currentCategory.includes('Versatility') || currentCategory.includes('Sportsmanship'))) {
          awards.push({
            category: currentCategory,
            award_class: 'studio',
            award_type: currentCategory,
            place: null,
            performance_name: null,
            dancer_name: null,
            studio: row.cols[0].text
          });
          // Reset category to prevent capturing the next line as another studio
          currentCategory = 'Unknown Category';
          return;
        }

        currentCategory = row.cols.map(c => c.text).join(' ');
        return;
      }

      // Award row typically starts < 10
      if (row.cols[0].x < 10) {
        // Semantic overrides
        const isCriticsChoice = currentCategory.includes("Critics' Choice") || currentCategory.includes("Judges' Pick");
        
        // Convention Format (Dancer | Studio) OR Critics Choice Format (Routine | Studio)
        if (row.cols.length === 2 && row.cols[0].x < 10 && row.cols[1].x > 10) {
          if (isCriticsChoice) {
             awards.push({
              category: currentCategory,
              award_class: 'special',
              award_type: currentCategory.includes("Judges'") ? "Judges' Pick" : "Critics' Choice Winner",
              place: null,
              performance_name: row.cols[0].text,
              dancer_name: null,
              studio: row.cols[1].text
            });
          } else {
             awards.push({
              category: currentCategory,
              award_class: 'scholarship',
              award_type: currentCategory.toLowerCase().includes('runner') ? 'Runner-Up' : 'Outstanding Dancer',
              place: null,
              performance_name: null,
              dancer_name: row.cols[0].text,
              studio: row.cols[1].text
            });
          }
        } 
        // Competition Format (Place | Routine | Dancer | Studio) OR (Place | Routine | Studio)
        else if (row.cols.length >= 3) {
          const place = row.cols[0].text;
          const routine = row.cols[1].text;
          let dancer = null;
          let studio = '';
          
          if (row.cols.length >= 4) {
            dancer = row.cols[2].text;
            studio = row.cols[row.cols.length - 1].text;
          } else {
            studio = row.cols[2].text;
          }
          
          let aClass = 'overall';
          if (currentCategory.toLowerCase().includes('outstanding') || currentCategory.toLowerCase().includes('scholarship')) aClass = 'scholarship';
          
          awards.push({
            category: currentCategory,
            award_class: aClass,
            award_type: currentCategory.toLowerCase().includes('overall') ? 'Overall' : 'High Score',
            place: place,
            performance_name: routine,
            dancer_name: dancer,
            studio: studio
          });
        }
      }
    });
  });

  return awards;
}

async function processPdf(file) {
  const isPre = isPre2022(file);
  if (isPre) {
    fs.renameSync(path.join(dir, file), path.join(dir, `IGNORE-${file.replace('TBD-', '')}`));
    console.log(`Ignored pre-2022: ${file}`);
    return;
  }

  console.log(`Processing ${file}...`);
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
      // Save text file
      let output = `=== ${file} ===\n\n`;
      awards.forEach(a => {
        output += `Cat: ${a.category} | Class: ${a.award_class} | Award: ${a.award_type} | Place: ${a.place || 'N/A'} | Routine: ${a.performance_name || 'N/A'} | Dancer: ${a.dancer_name || 'N/A'} | Studio: ${a.studio}\n`;
      });
      fs.writeFileSync(path.join(txtDir, `${file}.txt`), output);
      
      // Rename to GOOD-
      const newName = `GOOD-${file.replace('TBD-', '')}`;
      fs.renameSync(path.join(dir, file), path.join(dir, newName));
      console.log(`  -> SUCCESS (${awards.length} awards) -> ${newName}`);
    } else {
      // Rename to TBD-
      if (!file.startsWith('TBD-')) {
        const newName = `TBD-${file}`;
        fs.renameSync(path.join(dir, file), path.join(dir, newName));
        console.log(`  -> FAILED (0 awards) -> ${newName}`);
      } else {
        console.log(`  -> FAILED (0 awards) -> Still TBD`);
      }
    }
  } catch (e) {
    if (!file.startsWith('TBD-')) {
      const newName = `TBD-${file}`;
      fs.renameSync(path.join(dir, file), path.join(dir, newName));
      console.log(`  -> ERROR -> ${newName}`);
    } else {
      console.log(`  -> ERROR -> Still TBD`);
    }
  }
}

async function run() {
  console.log(`Found ${files.length} PDFs to process.`);
  for (const file of files) {
    await processPdf(file);
  }
  console.log(`\nInitial categorization complete.`);
}

run();
