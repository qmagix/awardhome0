const axios = require('axios');
const cheerio = require('cheerio');
const { scrapeRainbow } = require('./scrape_rainbow');

// Add a simple sleep function to prevent rate-limiting
const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

async function scrapeRainbowYear(year) {
  const baseUrl = `https://rainbowdance.com/results/${year}`;
  console.log(`Fetching events list from ${baseUrl}...`);
  const { data: listData } = await axios.get(baseUrl);
  const $list = cheerio.load(listData);

  const eventUrls = new Set();

  $list('a').each((i, el) => {
    const href = $list(el).attr('href');
    // Ensure it matches results path and is not a generic photogenic or top level link
    if (href && href.includes(`/results/${year}/`) && !href.includes('photogenic') && !href.includes('title')) {
      const match = href.match(new RegExp(`/results/${year}/(\\d+)`));
      if (match) {
        eventUrls.add(`https://rainbowdance.com/results/${year}/${match[1]}`);
      }
    }
  });

  const urlsToScrape = Array.from(eventUrls);
  console.log(`Found ${urlsToScrape.length} events to scrape for Rainbow ${year}.`);

  for (let i = 0; i < urlsToScrape.length; i++) {
    const url = urlsToScrape[i];
    console.log(`[${i + 1}/${urlsToScrape.length}] Scraping ${url}...`);

    try {
      await scrapeRainbow(url, year);
    } catch (e) {
      console.error(`  -> Failed to scrape ${url}: ${e.message}`);
    }

    // Sleep to be polite to the server
    await sleep(1000);
  }

  console.log(`Finished scraping all Rainbow ${year} events.`);
}

if (require.main === module) {
  scrapeRainbowYear(2026).then(() => {
    process.exit(0);
  }).catch(err => {
    console.error(err);
    process.exit(1);
  });
}

module.exports = { scrapeRainbowYear };
