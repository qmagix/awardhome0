const axios = require('axios');
const cheerio = require('cheerio');
axios.get('https://yagp.org/yagp-2025-tampa-fl-finals-winners').then(r=>{
  const $ = cheerio.load(r.data);
  let special = false;
  $('table tr').each((i, row) => {
    const text = $(row).text().replace(/\s+/g, ' ').trim();
    if(text === 'SPECIAL AWARDS') special = true;
    if(special) {
      const cols = [];
      $(row).find('td, th').each((j, col) => {
        cols.push($(col).text().trim().replace(/\s+/g, ' '));
      });
      console.log('Row ' + i + ': ' + JSON.stringify(cols));
    }
  });
});
