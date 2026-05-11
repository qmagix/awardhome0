const fs = require('fs');
const PDFParser = require('pdf2json');
const path = require('path');

const targetPdf = path.join(__dirname, 'tobeprocessed', 'pdf', 'spotlight', 'spotlightevents_ABQ-Results-2026-UPDATE.pdf');

function extract() {
  let pdfParser = new PDFParser(this, 1);

  pdfParser.on("pdfParser_dataError", errData => console.error(errData.parserError));
  pdfParser.on("pdfParser_dataReady", pdfData => {
      let allLines = [];

      for (const page of pdfData.Pages) {
          const texts = page.Texts;
          // Sort texts by y coordinate, then x coordinate
          texts.sort((a, b) => {
              // If y difference is very small, treat as same line
              if (Math.abs(a.y - b.y) < 0.2) {
                  return a.x - b.x;
              }
              return a.y - b.y;
          });

          // Group into lines
          let lines = [];
          let currentLine = [];
          let currentY = -1000;

          for (const t of texts) {
              if (Math.abs(t.y - currentY) > 0.3) {
                  if (currentLine.length > 0) {
                      lines.push(currentLine);
                  }
                  currentLine = [t];
                  currentY = t.y;
              } else {
                  currentLine.push(t);
              }
          }
          if (currentLine.length > 0) lines.push(currentLine);

          // Decode text
          for (const lineTexts of lines) {
              // lineTexts is already sorted by X because we sorted texts by X within the same Y initially
              const lineStr = lineTexts.map(t => decodeURIComponent(t.R[0].T)).join('   ');
              allLines.push(lineStr);
          }
      }

      fs.writeFileSync('abq_ysorted.txt', allLines.join('\n'));
      console.log("Wrote y-sorted text to abq_ysorted.txt");
  });

  pdfParser.loadPDF(targetPdf);
}

extract();
