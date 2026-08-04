const fs = require('fs');

const rawData = JSON.parse(fs.readFileSync('nycda_raw.txt', 'utf8'));

let rows = [];

rawData.Pages.forEach((page, pageIdx) => {
  let rows = [];
  page.Texts.forEach(textObj => {
    const text = decodeURIComponent(textObj.R[0].T);
    const y = textObj.y;
    const x = textObj.x;
    
    // Find an existing row with a similar Y coordinate
    let row = rows.find(r => Math.abs(r.y - y) < 0.1);
    if (!row) {
      row = { y: y, cols: [] };
      rows.push(row);
    }
    
    row.cols.push({ x: x, text: text });
  });

  // Sort rows by Y
  rows.sort((a, b) => a.y - b.y);

  console.log(`\n=== PAGE ${pageIdx + 1} ===`);
  // For each row, sort columns by X and print
  rows.forEach(row => {
    row.cols.sort((a, b) => a.x - b.x);
    const line = row.cols.map(c => `[x:${c.x.toFixed(1)}] ${c.text}`).join(' | ');
    console.log(`[Y: ${row.y.toFixed(2)}] ${line}`);
  });
});
