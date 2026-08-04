const fs = require('fs');
const path = require('path');
const axios = require('axios');

async function testParse() {
  const url = 'https://cdn2.assets-servd.host/nyc-dance/production/assets/images/Houston-Convention-24-25.pdf?dm=1731962646';
  const outPath = path.join(__dirname, 'nycda_convention_raw.json');
  
  console.log('Downloading PDF...');
  const response = await axios({
    url,
    method: 'GET',
    responseType: 'arraybuffer'
  });
  
  console.log('Parsing PDF using pdf2json...');
  const PDFParser = require("pdf2json");
  const pdfParser = new PDFParser();
  
  pdfParser.on("pdfParser_dataError", errData => console.error(errData.parserError) );
  pdfParser.on("pdfParser_dataReady", pdfData => {
    let output = '';
    pdfData.Pages.forEach((page, pageIdx) => {
      let rows = [];
      page.Texts.forEach(textObj => {
        const text = decodeURIComponent(textObj.R[0].T);
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

      output += `\n=== PAGE ${pageIdx + 1} ===\n`;
      rows.forEach(row => {
        row.cols.sort((a, b) => a.x - b.x);
        const line = row.cols.map(c => `[x:${c.x.toFixed(1)}] ${c.text}`).join(' | ');
        output += `[Y: ${row.y.toFixed(2)}] ${line}\n`;
      });
    });
    fs.writeFileSync('nycda_convention_parsed.txt', output);
    console.log('Saved to nycda_convention_parsed.txt');
  });
  
  pdfParser.parseBuffer(response.data);
}

testParse().catch(console.error);
