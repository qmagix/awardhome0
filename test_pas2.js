const axios = require('axios');
const cheerio = require('cheerio');
axios.get('https://yagp.org/yagp-2025-tampa-fl-finals-winners').then(r=>{
  const $ = cheerio.load(r.data);
  $('table tr').each((i, row) => {
    const text = $(row).text().replace(/\s+/g, ' ').trim();
    if(text.toUpperCase().includes('PAS DE DEUX') && text.toUpperCase().includes('TOP')) {
      console.log('Row ' + i + ': ' + text);
    }
  });
});
