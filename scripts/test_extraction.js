const axios = require('axios');
const cheerio = require('cheerio');
axios.get('https://db-all-prod-p.s3.us-east-2.amazonaws.com/comps/327/117933/results-all-results--1-.html').then(({data}) => {
  const $ = cheerio.load(data);
  $('script').remove();
  $('style').remove();
  
  const tables = $('table');
  console.log('Total tables:', tables.length);
  for (let i = 0; i < tables.length; i++) {
    const tbl = tables[i];
    if ($(tbl).find('table').length > 5) {
       console.log('Skipping wrapper table...');
       continue;
    }
    const directRows = [];
    $(tbl).children('thead').children('tr').each((i, el) => directRows.push(el));
    $(tbl).children('tbody').children('tr').each((i, el) => directRows.push(el));
    $(tbl).children('tr').each((i, el) => directRows.push(el));
    
    if (directRows.length >= 2) {
      const categoryTitle = $(directRows[0]).text().trim().replace(/\s+/g, ' ');
      const nestedTable = $(directRows[1]).find('table');
      if (categoryTitle && nestedTable.length > 0) {
         console.log('Valid Category (Nested):', categoryTitle);
      }
    } else if (directRows.length >= 3) {
      const categoryTitle = $(directRows[0]).text().trim().replace(/\s+/g, ' ');
      console.log('Valid Category (Flat):', categoryTitle);
    }
  }
});
