const axios = require('axios');
const cheerio = require('cheerio');

async function testScrape() {
  const url = 'https://rainbowdance.com/results/2026/824';
  const { data } = await axios.get(url);
  const $ = cheerio.load(data);
  const tables = $('table');
  console.log('Found tables:', tables.length);
  if (tables.length > 0) {
    const firstTable = tables.first();
    console.log('First table class:', firstTable.attr('class'));
    console.log('Prev tag:', firstTable.prev().prop('tagName'));
    console.log('Prev text:', firstTable.prev().text().trim());
    console.log('Parent prev tag:', firstTable.parent().prev().prop('tagName'));
    console.log('Parent prev text:', firstTable.parent().prev().text().trim());
  } else {
    console.log('No tables found. Looking for other structures like .row or .grid.');
    console.log($('body').html().substring(0, 1000));
  }
}

testScrape().catch(console.error);
