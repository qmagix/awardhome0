const axios = require('axios');
const cheerio = require('cheerio');
const { scrapeYagp } = require('./scrape_yagp_year');

async function scrapeYagpByYear(targetYear) {
  if (!targetYear) {
    console.error("Please provide a target year, e.g., 'node scrape_all_yagp.js 2025'");
    process.exit(1);
  }

  console.log(`Fetching YAGP sitemap to find events for ${targetYear}...`);
  try {
    const r = await axios.get('https://yagp.org/page-sitemap.xml');
    const $ = cheerio.load(r.data, { xmlMode: true });
    
    let eventUrls = [];
    
    $('loc').each((i, el) => {
      const url = $(el).text();
      // YAGP result URLs usually follow the pattern yagp-YYYY-Location-winners
      const match = url.match(/yagp-(\d{4})-(.+)-winners/i);
      if (match && match[1] === targetYear) {
        eventUrls.push(url);
      }
    });

    if (eventUrls.length === 0) {
      console.log(`No YAGP events found for year ${targetYear} in the sitemap.`);
      return;
    }

    console.log(`Found ${eventUrls.length} events for ${targetYear}. Starting batch import...`);
    
    for (let i = 0; i < eventUrls.length; i++) {
      const url = eventUrls[i];
      console.log(`\n[${i + 1}/${eventUrls.length}] Processing: ${url}`);
      try {
        await scrapeYagp(url, false);
      } catch (err) {
        console.error(`Failed to process ${url}:`, err.message);
      }
    }
    
    console.log(`\n\n--- MASS YAGP SCRAPING COMPLETED FOR ${targetYear} ---`);

  } catch (e) {
    console.error("Error fetching or parsing YAGP sitemap:", e.message);
  }
}

// CLI handler
if (require.main === module) {
  const args = process.argv.slice(2);
  const targetYear = args[0];
  
  scrapeYagpByYear(targetYear).then(() => {
    process.exit(0);
  });
}
