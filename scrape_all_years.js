const { scrapeKarYear } = require('./scrape_kar_year');
const { scrapeRainbowYear } = require('./scrape_rainbow_year');

async function scrapeAll() {
  const years = [2024, 2023, 2022, 2021, 2020, 2019, 2018, 2017, 2016];
  
  for (const year of years) {
    console.log(`\n\n--- STARTING YEAR ${year} ---`);
    try {
      console.log(`Starting KAR for ${year}...`);
      await scrapeKarYear(year);
    } catch (e) {
      console.error(`Error scraping KAR ${year}:`, e);
    }
    
    try {
      console.log(`Starting Rainbow for ${year}...`);
      await scrapeRainbowYear(year);
    } catch (e) {
      console.error(`Error scraping Rainbow ${year}:`, e);
    }
  }
  
  console.log("\n\n--- MASS SCRAPING COMPLETED ---");
}

if (require.main === module) {
  scrapeAll().then(() => {
    process.exit(0);
  }).catch(err => {
    console.error(err);
    process.exit(1);
  });
}
