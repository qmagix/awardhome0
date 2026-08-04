const axios = require('axios');
const cheerio = require('cheerio');

async function testFetch() {
  const url = 'https://yagp.org/yagp-2024-austin-tx-winners/';
  console.log(`Fetching ${url}...`);
  try {
    const { data } = await axios.get(url);
    const $ = cheerio.load(data);
    
    const table = $('table').first();
    const rows = table.find('tr');
    let pasDeDeuxStarted = false;
    let count = 0;

    rows.each((i, row) => {
      const text = $(row).text().toUpperCase();
      if (text.includes('OUTSTANDING CHOREOGRAPHER')) {
        pasDeDeuxStarted = true;
      }

      if (pasDeDeuxStarted && count < 25) {
        const bg = $(row).find('td').first().attr('style') || '';
        const cols = [];
        $(row).find('td, th').each((j, col) => {
          cols.push($(col).text().trim().replace(/\s+/g, ' '));
        });
        console.log(`Row ${i} | BG: ${bg} | Cols: ${cols.join(' || ')}`);
        count++;
      }
    });
  } catch (err) {
    console.error(err.message);
  }
}

testFetch();
