const axios = require('axios');
const cheerio = require('cheerio');
const { spawnSync } = require('child_process');

const YEARS_MAP = {
  2026: 2054,
  2025: 2053,
  2024: 2052,
  2023: 2051,
  2022: 2050,
  2021: 2049,
  2020: 2048,
  2019: 2047,
  2018: 2021,
  2017: 2020,
  2016: 4
};

const BASE_URL = 'https://www.dancebug.com/rf/events_list.php?ifid=154';

async function fetchLinksForYear(yearValue) {
  try {
    const res = await axios.get(`${BASE_URL}&d_year=${yearValue}`);
    const $ = cheerio.load(res.data);
    const links = [];
    $('a').each((i, el) => {
      const href = $(el).attr('href');
      // Only get amazonaws links that are actually results
      if (href && href.includes('amazonaws.com') && href.includes('results')) {
        const isDuplicate = links.some(l => l.url === href);
        if (!isDuplicate) {
           const tr = $(el).closest('tr');
           let dateStr = tr.find('td').eq(0).text().trim();
           let locStr = tr.find('td').eq(1).text().trim();
           
           // Handle mobile layout fallback if regular table structure is missing
           if (!locStr) {
              const divLoc = $(el).closest('.row').find('.col-md-12').eq(1).text().trim();
              if (divLoc) locStr = divLoc;
           }

           links.push({
             url: href,
             locationDateStr: locStr ? `${locStr} - ${dateStr}` : 'Unknown Location'
           });
        }
      }
    });
    return links;
  } catch (error) {
    console.error(`Error fetching links for year value ${yearValue}:`, error.message);
    return [];
  }
}

async function run() {
  const args = process.argv.slice(2);
  let yearsToRun = Object.keys(YEARS_MAP).sort((a, b) => b - a); // 2026 down to 2016
  
  if (args.length > 0) {
    yearsToRun = args; // run specific year if provided
  }

  let totalBatchAwards = 0;

  for (const year of yearsToRun) {
    if (!YEARS_MAP[year]) {
      console.warn(`Year ${year} not supported.`);
      continue;
    }
    
    console.log(`\n========================================`);
    console.log(`🚀 Starting batch import for ${year} (Value: ${YEARS_MAP[year]})`);
    console.log(`========================================\n`);
    
    const links = await fetchLinksForYear(YEARS_MAP[year]);
    console.log(`Found ${links.length} result URLs for ${year}.\n`);
    
    for (let i = 0; i < links.length; i++) {
      const { url, locationDateStr } = links[i];
      console.log(`[${i + 1}/${links.length}] Processing URL: ${url}`);
      
      try {
        // Capture stdout to parse the total new awards added
        const result = spawnSync('node', ['import_revolution_awards.js', url, locationDateStr], { encoding: 'utf8' });
        
        if (result.stdout) {
          console.log(result.stdout);
          const match = result.stdout.match(/Inserted (\d+) awards successfully!/);
          if (match && match[1]) {
            totalBatchAwards += parseInt(match[1]);
          }
        }

        if (result.stderr && result.stderr.length > 0) {
          console.error(result.stderr);
        }

        if (result.status !== 0) {
          console.error(`❌ Importer failed with exit code ${result.status} for URL: ${url}`);
        } else {
          console.log(`✅ Completed ${url}\n`);
        }
      } catch (err) {
        console.error(`❌ Failed to execute importer: ${err.message}`);
      }
    }
  }
  
  console.log(`\n🎉 All requested batch imports finished!`);
  console.log(`📈 Grand Total: Successfully appended ${totalBatchAwards} NEW awards across all processed events!`);
}

run();
