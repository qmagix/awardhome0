const axios = require('axios');
const cheerio = require('cheerio');

async function testSitemap() {
  try {
    const r = await axios.get('https://yagp.org/page-sitemap.xml');
    const $ = cheerio.load(r.data, { xmlMode: true });
    
    let yearMap = {};
    
    $('loc').each((i, el) => {
      const url = $(el).text();
      const match = url.match(/yagp-(\d{4})-(.+)-winners/i);
      if (match) {
        const year = match[1];
        if (!yearMap[year]) yearMap[year] = [];
        yearMap[year].push(url);
      }
    });
    
    for (const year in yearMap) {
       console.log(`Year ${year}: ${yearMap[year].length} events found.`);
       // console.log(yearMap[year].slice(0, 3)); // show first 3
    }
  } catch (e) {
    console.error("Error fetching sitemap:", e.message);
  }
}
testSitemap();
