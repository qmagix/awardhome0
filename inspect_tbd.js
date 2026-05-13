const fs = require('fs');
const path = require('path');
const PDFParser = require("pdf2json");

async function run() {
  const file = path.join(__dirname, 'tobeprocessed', 'pdf', 'nycda', 'TBD-houston_Houston-results.pdf');
  const dataBuffer = fs.readFileSync(file);
  const pdfParser = new PDFParser();
  
  const parsedData = await new Promise((resolve, reject) => {
    pdfParser.on("pdfParser_dataError", errData => reject(errData.parserError));
    pdfParser.on("pdfParser_dataReady", resolve);
    pdfParser.parseBuffer(dataBuffer);
  });

  let out = '';
  parsedData.Pages.forEach((page, i) => {
    out += `\n--- PAGE ${i+1} ---\n`;
    page.Texts.forEach(textObj => {
      const text = decodeURIComponent(textObj.R[0].T).trim();
      out += `[Y: ${textObj.y.toFixed(2)}] [X: ${textObj.x.toFixed(2)}] ${text}\n`;
    });
  });
  fs.writeFileSync('tbd_inspect_output.txt', out);
}

run().catch(console.error);
