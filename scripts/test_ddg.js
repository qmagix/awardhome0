require('dotenv').config();
const axios = require('axios');
const cheerio = require('cheerio');

async function searchDuckDuckGo(query) {
  try {
    const response = await axios.get(`https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
      }
    });
    const $ = cheerio.load(response.data);
    const results = [];
    $('.result__url').each((i, elem) => {
      let urlText = $(elem).text().trim();
      if (urlText) {
        if (!urlText.startsWith('http')) urlText = 'https://' + urlText;
        results.push(urlText);
      }
    });
    return results.length > 0 ? results[0] : null;
  } catch (err) {
    return null;
  }
}

async function test() {
  const url = await searchDuckDuckGo("Yoko's Dance and Performing Arts Academy dance studio website");
  console.log("DDG returned:", url);
}

test();
