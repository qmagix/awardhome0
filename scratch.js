const axios = require('axios');
const cheerio = require('cheerio');
async function run() {
  const res = await axios.get('https://www.dancebug.com/rf/events_list.php?ifid=146&d_year=2053');
  const $ = cheerio.load(res.data);
  $('table th').each((idx, el) => {
    console.log(idx, $(el).text().trim().toLowerCase());
  });
}
run();
