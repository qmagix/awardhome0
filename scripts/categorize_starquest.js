const fs = require('fs');
const path = require('path');
const PDFParser = require("pdf2json");
const { normalizeName } = require('../utils/normalize_names');

const dir = path.join(__dirname, '..', 'tobeprocessed', 'pdf', 'starquest');
const txtDir = path.join(dir, 'txt');

if (!fs.existsSync(txtDir)) {
  fs.mkdirSync(txtDir);
}

const files = fs.readdirSync(dir).filter(f => f.endsWith('.pdf') && !f.startsWith('NOT-') && !f.startsWith('IGNORE-'));

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

    rows.forEach((row, rowIndex) => {
      row.cols.sort((a, b) => a.x - b.x);
      if (row.cols.length === 0) return;

      const firstColX = row.cols[0].x;

      // Header row. PDF text comes in fragments split mid-word; joining with
      // ' ' scatters spaces ("Adult S ol o Award") — normalizeName repairs
      // the spacing from content.
      if (firstColX < 3.0) {
        currentCategory = normalizeName(row.cols.map(c => c.text).join(' '));
        return;
      }

      // Placement/Winner row
      if (firstColX >= 3.0 && firstColX < 5.0) {
        // Find separators '-' to split fields
        const parts = [];
        let currentPart = [];
        
        row.cols.forEach(col => {
          if (col.text === '-') {
            if (currentPart.length > 0) {
              parts.push(currentPart.join(' '));
              currentPart = [];
            }
          } else {
            currentPart.push(col.text);
          }
        });
        if (currentPart.length > 0) parts.push(currentPart.join(' '));

        let place = null;
        let routine = null;
        let dancer = null;
        let studio = null;
        let choreographer = null;
        let isRunnerUp = false;

        let aClass = 'overall';
        let aType = 'Overall';
        
        if (currentCategory.toLowerCase().includes('dancer') || currentCategory.toLowerCase().includes('artist')) {
           aType = 'Title';
        }

        const isSpecial = currentCategory.toLowerCase().includes('award') || currentCategory.toLowerCase().includes('costume') || currentCategory.toLowerCase().includes('photogenic');

        if (isSpecial) {
           aClass = 'special';
           aType = currentCategory;
        }

        // Format 1: Dancer Placement (e.g., Gabi Lynn - Beautiful Swan - Blake Stanley Techniques)
        if (currentCategory.toLowerCase().includes('dancer') || currentCategory.toLowerCase().includes('artist')) {
          if (parts.length >= 3 && !parts[0].toLowerCase().includes('runner')) {
            place = '1';
            dancer = parts[0];
            routine = parts[1];
            studio = parts[2];
          } else if (parts.length >= 4 && parts[0].toLowerCase().includes('runner')) {
            // e.g., 1st Runner - Up - Skylar - Fight For Me - Studio G
            place = parts[0] + ' Up';
            dancer = parts[2]; // after Up
            routine = parts[3];
            studio = parts[4];
            if (parts.length > 5) choreographer = parts[5];
          }
        }
        // Format 2: Routine Placement
        else if (parts.length >= 3 && !isNaN(parseInt(parts[0]))) {
          place = parts[0];
          if (currentCategory.toLowerCase().includes('solo')) {
             // 1 - Dancer - Routine - Studio
             if (parts.length >= 4) {
               dancer = parts[1];
               routine = parts[2];
               studio = parts[3];
             } else {
               routine = parts[1];
               studio = parts[2];
             }
          } else {
             // 1 - Routine - Studio - Choreographer
             routine = parts[1];
             studio = parts[2];
             if (parts.length >= 4) choreographer = parts[3];
          }
        }
        // Format 3: Special Awards
        else if (isSpecial) {
           // Routine - Studio - Choreographer
           if (parts.length >= 2) {
             routine = parts[0];
             studio = parts[1];
             if (parts.length >= 3) choreographer = parts[2];
           }
        }
        // Fallback for simple rows (e.g. Photogenic: Dancer Studio)
        else if (parts.length === 1 && row.cols.length >= 2) {
           // Example: Cameron Belvedere The Dance Collective
           place = '1';
           dancer = parts[0];
           studio = row.cols.slice(1).map(c=>c.text).join(' '); // very crude fallback
        }

        if (studio) {
          awards.push({
            category: currentCategory,
            award_class: aClass,
            award_type: aType,
            place: place || '1',
            performance_name: routine || null,
            dancer_name: dancer || null,
            studio: studio,
            choreographer: choreographer || null
          });
        }
      }

      // Format 4: Studio Superlatives (Award type is at X ~3.9, next row is Studio at X ~6.1)
      if (firstColX >= 3.0 && firstColX < 5.0 && row.cols.length === 1 && currentCategory.toLowerCase().includes('superlative')) {
        const awardType = normalizeName(row.cols[0].text);
        if (rowIndex + 1 < rows.length) {
          const nextRow = rows[rowIndex + 1];
          if (nextRow.cols.length > 0 && nextRow.cols[0].x > 5.0) {
             // Format: Studio - Choreographer
             const parts = [];
             let currentPart = [];
             nextRow.cols.forEach(col => {
               if (col.text === '-') {
                 if (currentPart.length > 0) parts.push(currentPart.join(' '));
                 currentPart = [];
               } else {
                 currentPart.push(col.text);
               }
             });
             if (currentPart.length > 0) parts.push(currentPart.join(' '));

             if (parts.length >= 1) {
               awards.push({
                 category: currentCategory,
                 award_class: 'studio',
                 award_type: awardType,
                 place: '1',
                 performance_name: null,
                 dancer_name: null,
                 studio: parts[0],
                 choreographer: parts.length >= 2 ? parts[1] : null
               });
             }
          }
        }
      }

      // Format 5: Studio of Excellence
      if (firstColX >= 3.0 && firstColX < 5.0 && row.cols.length === 1 && currentCategory.toLowerCase().includes('excellence')) {
         awards.push({
           category: currentCategory,
           award_class: 'studio',
           award_type: 'Studio of Excellence',
           place: '1',
           performance_name: null,
           dancer_name: null,
           studio: row.cols[0].text,
           choreographer: null
         });
      }

    });
  });

  return awards;
}

async function processPdf(file) {
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
      // Save text file (strip GOOD- from the output filename so they remain consistent)
      let output = `=== ${file} ===\n\n`;
      awards.forEach(a => {
        let noteStr = a.choreographer ? ` | Notes: [Choreographer: ${a.choreographer}]` : '';
        output += `Cat: ${a.category} | Class: ${a.award_class} | Award: ${a.award_type} | Place: ${a.place || 'N/A'} | Routine: ${a.performance_name || 'N/A'} | Dancer: ${a.dancer_name || 'N/A'} | Studio: ${a.studio}${noteStr}\n`;
      });
      const cleanFileName = file.replace(/^GOOD-/, '');
      fs.writeFileSync(path.join(txtDir, `${cleanFileName}.txt`), output);
      
      // Rename to GOOD-
      const newName = file.startsWith('GOOD-') ? file : `GOOD-${file}`;
      if (file !== newName) fs.renameSync(path.join(dir, file), path.join(dir, newName));
      console.log(`  -> SUCCESS (${awards.length} awards) -> ${newName}`);
    } else {
      const newName = `TBD-${file}`;
      fs.renameSync(path.join(dir, file), path.join(dir, newName));
      console.log(`  -> FAILED (0 awards) -> ${newName}`);
    }
  } catch (e) {
    const newName = `TBD-${file}`;
    fs.renameSync(path.join(dir, file), path.join(dir, newName));
    console.log(`  -> ERROR -> ${newName}`);
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
