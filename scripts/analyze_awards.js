const fs = require('fs');
const cheerio = require('cheerio');
const html = fs.readFileSync('awards_sample.html', 'utf8');
const $ = cheerio.load(html);

// Find elements containing 'Choice Awards Report'
const choiceAwards = $('*:contains("Choice Awards Report")').last(); // Get the innermost element or look for the text
console.log('Found:', choiceAwards.length > 0 ? 'Yes' : 'No');

// If there are different sections, let's dump the text or structure of the last few tables.
// My previous script found 116 categories by looking for tables with >=2 rows where the second row has a nested table.
// What about tables that didn't match that? Let's see the structure near the bottom.

const allTables = $('table');
console.log(`Total tables: ${allTables.length}`);

// Print the text of the last 15 tables to see what we missed
allTables.slice(-15).each((i, tbl) => {
  console.log(`\n--- Last Table -${15 - i} ---`);
  $(tbl).find('tr').slice(0, 5).each((j, row) => {
    const cols = $(row).find('th, td').map((k, col) => $(col).text().trim().replace(/\s+/g, ' ')).get();
    console.log(`Row ${j}:`, cols.join(' | '));
  });
});
