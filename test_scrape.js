const axios = require('axios');
const cheerio = require('cheerio');

async function testScrape() {
  const url = 'https://dancekar.com/competition/results/2026/1900';
  const { data } = await axios.get(url);
  const $ = cheerio.load(data);
  
  const firstTable = $('table').first();
  console.log("Table prev element html:", firstTable.prev().html());
  console.log("Table prev prev element html:", firstTable.prev().prev().html());
  console.log("Table parent prev html:", firstTable.parent().prev().html());
}

testScrape();
