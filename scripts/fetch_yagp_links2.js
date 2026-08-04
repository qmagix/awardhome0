const axios = require('axios');
const cheerio = require('cheerio');

async function check() {
  const r = await axios.get('https://yagp.org/winners/');
  const $ = cheerio.load(r.data);
  $('a').each((i, el) => {
     console.log($(el).text().trim() + ' | ' + $(el).attr('href'));
  });
}
check();
