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

// A field separator is any dash-like glyph on its own. The original test was
// `col.text === '-'`, which missed the en dash, em dash, figure dash, minus
// sign and the non-breaking hyphen -- all of which appear in these PDFs.
const IS_SEPARATOR = (t) => /^[-‐-―−]+$/.test(String(t).trim());

function extractAwards(pdfData) {
  const awards = [];
  let currentCategory = 'Unknown Category';
  let unparsedRows = 0;

  pdfData.Pages.forEach(page => {
    let rows = [];
    page.Texts.forEach(textObj => {
      const rawText = decodeURIComponent(textObj.R[0].T);
      const text = rawText.trim();
      if (!text) return;

      const y = textObj.y;
      const x = textObj.x;
      
      let row = rows.find(r => Math.abs(r.y - y) < 0.2); // tolerance
      if (!row) {
        row = { y: y, cols: [] };
        rows.push(row);
      }
      // `w` is required by the gap-based field splitter below: without it a
      // fragment's span collapses to its start x, so every gap looks like a
      // field boundary and single fields get torn apart.
      //
      // `raw` keeps the UNTRIMMED fragment, because these PDFs encode word
      // breaks inside a field as trailing tabs -- "Lisa\t" + "Pilato\tDanc" +
      // "e\tCenter\t". Trimming destroys that, and joining the trimmed pieces
      // with ' ' then produces "Lisa Pilato Danc e Center". Joining the raw
      // pieces with NOTHING reconstructs the field exactly, using the
      // document's own word breaks instead of guessing at them.
      row.cols.push({ x: x, w: textObj.w, text: text, raw: rawText });
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
        // Split the row into fields on TWO signals, because StarQuest's PDFs
        // use both and relying on the first alone was the bug:
        //
        //  1. a separator fragment -- and not just ASCII '-'. En/em dashes and
        //     the minus sign all appear, and `col.text === '-'` missed them.
        //  2. a horizontal GAP. Many rows (every "Viral Video of the Event"
        //     row, and the special-award tables) carry NO separator at all and
        //     are laid out by position only:
        //       [3.86]"Roar" [6.11]"LaPierre School Of Dance" [15.11]"Susan Marroni"
        //     Those used to collapse into a single part and fall into the
        //     "very crude fallback" below, which assigned the WHOLE row string
        //     as the dancer's name -- 186 profiles like "Roar LaPierre School
        //     Of Dance Susan Marroni".
        //
        // Threshold calibrated against the real PDFs, where the two
        // populations separate cleanly: fragments inside one field sit at
        // <= 0.17 (including mid-word splits such as "Pilato Danc" + "e
        // Center", which measure 0.00), while genuine field boundaries start
        // at 0.34. 0.25 sits in the empty band between them. Fragment span is
        // x + w*0.75 -- verified against rows whose separator begins exactly
        // where the preceding field ends.
        const FIELD_GAP = 0.25;
        const spanEnd = (c) => c.x + (c.w || 0) * 0.75;
        let parts = [];
        let currentPart = [];
        let prev = null;

        // Fragments of one field are joined with '' so the document's own tab
        // word-breaks survive; whitespace is collapsed once at the end.
        const flush = () => {
          if (!currentPart.length) return;
          // Join raw so the document's own trailing-tab word breaks survive.
          // Where a fragment does NOT end in whitespace, the break has to be
          // inferred: a following UPPERCASE letter starts a new word
          // ("Lydia'lee" + "Bryant"), while a lowercase one continues the
          // previous ("Pilato Danc" + "e Center"). Joining blindly glued the
          // former into "Lydia'leeBryant".
          let joined = '';
          for (const frag of currentPart) {
            if (joined && !/\s$/.test(joined) && /^[A-Z]/.test(frag)) joined += ' ';
            joined += frag;
          }
          joined = joined.replace(/\s+/g, ' ').trim();
          if (joined) parts.push(joined);
          currentPart = [];
        };

        row.cols.forEach(col => {
          if (IS_SEPARATOR(col.text)) {
            flush();
            prev = col;
            return;
          }
          if (prev && !IS_SEPARATOR(prev.text) && currentPart.length > 0
              && (col.x - spanEnd(prev)) > FIELD_GAP) {
            flush();
          }
          currentPart.push(col.raw);
          prev = col;
        });
        flush();

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

        // A "special" table is one whose rows are Routine - Studio -
        // Choreographer rather than a ranked placement. Matching only
        // award/costume/photogenic missed "Viral Video of the Event"
        // entirely, so those rows reached the crude fallback below. Decide by
        // what a PLACEMENT category looks like instead of trying to enumerate
        // every special one: placements always name a routine size.
        const catLower = currentCategory.toLowerCase();
        const isPlacementCategory = /\b(solo|duet|trio|group|line|production|ensemble)\b/.test(catLower);
        const isSpecial = catLower.includes('award') || catLower.includes('costume')
          || catLower.includes('photogenic') || catLower.includes('video')
          || (!isPlacementCategory && !catLower.includes('dancer') && !catLower.includes('artist'));

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
        // Format 3 is tested BEFORE the ranked-placement format on purpose.
        // Costume/photogenic/video tables are never ranked -- every row is a
        // single winner -- but their first field starts with "1", so the
        // placement branch claimed them and mapped Studio into the routine and
        // the Choreographer into the studio.
        else if (isSpecial) {
           // These tables print the rank and the routine as ONE field
           // ("1 Stupid Cupid"): no separator sits between them and the gap is
           // within a field's width. Peel the rank off so it does not swallow
           // the routine name.
           // The rank may abut the routine with no space at all ("1Without
           // You"), since the rank fragment carries no trailing tab. Require a
           // LETTER after the digits so a routine that legitimately starts
           // with a number keeps it: "29,032 Ft" is a routine, not rank 29.
           // The negative lookahead protects ordinals: without it "1st Runner
           // Up" peels to place "1" + routine "st Runner Up".
           const ranked = parts[0].match(/^(\d{1,3})\s*(?!(?:st|nd|rd|th)\b)(?=[A-Za-z])(.+)$/i);
           if (ranked) { place = ranked[1]; parts = [ranked[2], ...parts.slice(1)]; }

           // "Choreography Awards" tables are Studio - Choreographer: they
           // honour the person, not a routine, so there is no routine column.
           if (catLower.includes('choreograph') && parts.length === 2) {
             studio = parts[0];
             choreographer = parts[1];
           } else if (parts.length >= 2) {
             // Routine - Studio - Choreographer
             routine = parts[0];
             studio = parts[1];
             if (parts.length >= 3) choreographer = parts[2];
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
        // Nothing above matched. Do NOT guess: the previous "very crude
        // fallback" here assigned the entire row string as the dancer's name
        // and joined the remaining columns as the studio, which is how 186
        // people ended up named "Roar LaPierre School Of Dance Susan Marroni".
        // With gap-splitting above, a row that still yields a single part is
        // genuinely ambiguous -- there is no second field to attribute. Count
        // it and move on, so it surfaces in the run summary for review rather
        // than entering the database as a fabricated person.
        else if (parts.length === 1) {
           unparsedRows++;
           return;
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

  if (unparsedRows) {
    // Surfaced rather than silently dropped: a row we cannot split is a
    // layout this extractor has not seen, and it should be looked at.
    console.warn(`  ⚠ ${unparsedRows} row(s) could not be split into fields — skipped (previously these became fabricated dancer names)`);
  }
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
