const fs = require('fs');
const PDFParser = require("pdf2json");

async function run() {
  const file = 'tobeprocessed/pdf/nycda/GOOD-baltimore_25-26-Baltimore-Competition-Results.pdf';
  const dataBuffer = fs.readFileSync(file);
  const pdfParser = new PDFParser();
  
  const parsedData = await new Promise((resolve, reject) => {
    pdfParser.on("pdfParser_dataError", errData => reject(errData.parserError));
    pdfParser.on("pdfParser_dataReady", resolve);
    pdfParser.parseBuffer(dataBuffer);
  });

  let currentCategory = 'Unknown';
  parsedData.Pages.forEach(page => {
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
      const textJoined = row.cols.map(c => `[x:${c.x.toFixed(2)}] ${c.text}`).join(' || ');
      if (textJoined.includes("Class Act") || textJoined.includes("Good Sport") || textJoined.includes("Critics'") || textJoined.includes("Judges'")) {
        console.log(`--- MATCH: ${textJoined}`);
        // Log next 3 rows
        const idx = rows.indexOf(row);
        for(let i=1; i<=3; i++) {
            if(rows[idx+i]) {
                console.log(`   +${i}: ${rows[idx+i].cols.map(c => `[x:${c.x.toFixed(2)}] ${c.text}`).join(' || ')}`);
            }
        }
      }
    });
  });
}

run().catch(console.error);
