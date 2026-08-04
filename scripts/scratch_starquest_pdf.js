const fs = require('fs');
const path = require('path');
const PDFParser = require("pdf2json");

const file = process.argv[2] || path.join(__dirname, 'tobeprocessed', 'pdf', 'starquest', 'orlando-fl-2026.pdf');

async function testPdf() {
  const dataBuffer = fs.readFileSync(file);
  const pdfParser = new PDFParser();
  
  const parsedData = await new Promise((resolve, reject) => {
    pdfParser.on("pdfParser_dataError", errData => reject(errData.parserError));
    pdfParser.on("pdfParser_dataReady", resolve);
    pdfParser.parseBuffer(dataBuffer);
  });

  let output = '';
  
  parsedData.Pages.forEach((page, pageNum) => {
    output += `\n--- PAGE ${pageNum + 1} ---\n`;
    let rows = [];
    page.Texts.forEach(textObj => {
      const text = decodeURIComponent(textObj.R[0].T).trim();
      if (!text) return;

      const y = textObj.y;
      const x = textObj.x;
      
      let row = rows.find(r => Math.abs(r.y - y) < 0.2);
      if (!row) {
        row = { y: y, cols: [] };
        rows.push(row);
      }
      row.cols.push({ x: x, text: text });
    });

    rows.sort((a, b) => a.y - b.y);

    rows.forEach(row => {
      row.cols.sort((a, b) => a.x - b.x);
      output += `[Y: ${row.y.toFixed(2)}] ` + row.cols.map(c => `[X:${c.x.toFixed(1)}] ${c.text}`).join(' | ') + '\n';
    });
  });

  const outPath = 'starquest_inspection.txt';
  fs.writeFileSync(outPath, output);
  console.log(`Saved inspection to ${outPath}`);
}

testPdf();
