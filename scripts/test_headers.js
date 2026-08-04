const axios = require('axios');
const cheerio = require('cheerio');

async function getHeaders() {
  const { data } = await axios.get('https://dancekar.com/competition/results/2026/1900');
  const $ = cheerio.load(data);
  const thCombos = new Set();
  $('table').each((i, t) => {
    const headers = $(t).find('th').map((i, el) => $(el).text().trim()).get().join(' | ');
    thCombos.add(headers);
  });
  console.log([...thCombos]);
}
getHeaders();
