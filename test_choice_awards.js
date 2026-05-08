const fs = require('fs');
const cheerio = require('cheerio');
const html = fs.readFileSync('awards_sample.html', 'utf8');
const $ = cheerio.load(html);

const tbl = $('table').eq(235);
console.log('thead rows:', $(tbl).children('thead').children('tr').length);
console.log('thead row 0:', $(tbl).children('thead').children('tr').eq(0).text().trim());
console.log('thead row 1:', $(tbl).children('thead').children('tr').eq(1).text().trim());
console.log('tbody rows:', $(tbl).children('tbody').children('tr').length);
