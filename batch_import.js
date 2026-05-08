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


const COMPETITIONS = {
  starpower: { name: 'Starpower Talent Competition', ifid: 161 },
  revolution: { name: 'Revolution Talent Competition', ifid: 154 },
  believe: { name: 'Believe Talent Competition', ifid: 152 },
  imagine: { name: 'Imagine Dance Challenge', ifid: 150 },
  dreammaker: { name: 'DreamMaker Dance Competition', ifid: 146 }
};

const BASE_URL = 'https://www.dancebug.com/rf/events_list.php?ifid=';

async function fetchLinksForYear(yearValue, ifid, retries = 3) {
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      const res = await axios.get(`${BASE_URL}${ifid}&d_year=${yearValue}`, { timeout: 15000 });
      const $ = cheerio.load(res.data);
      
      let dateIdx = 0;
      let locIdx = 1;
      
      // DanceBug uses <tr class="table_title"><td> instead of <th> sometimes
      const headerElements = $('table th').length > 0 ? $('table th') : $('tr.table_title td');
      
      headerElements.each((idx, el) => {
        const text = $(el).text().trim().toLowerCase();
        if (text === 'location') locIdx = idx;
        if (text.includes('event date') || text === 'date') dateIdx = idx;
      });

      const links = [];
      $('a').each((i, el) => {
        const href = $(el).attr('href');
        // Only get amazonaws links that are actually results and are HTML files
        if (href && href.includes('amazonaws.com') && href.includes('results') && href.includes('.html')) {
          const isDuplicate = links.some(l => l.url === href);
          if (!isDuplicate) {
             const tr = $(el).closest('tr');
             let dateStr = tr.find('td').eq(dateIdx).text().trim();
             let locStr = tr.find('td').eq(locIdx).text().trim();
             
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
      console.error(`Attempt ${attempt} - Error fetching links for year value ${yearValue}:`, error.message);
      if (attempt === retries) {
        console.error(`Failed after ${retries} attempts for year ${yearValue}.`);
        return [];
      }
      await new Promise(r => setTimeout(r, 2000 * attempt)); // Exponential backoff
    }
  }
  return [];
}

async function run() {
  const args = process.argv.slice(2);
  const targetCompKey = args[0];
  
  if (!targetCompKey || !COMPETITIONS[targetCompKey]) {
    console.error("Usage: node batch_import.js <competition_slug> [years...]");
    console.error(`Available slugs: ${Object.keys(COMPETITIONS).join(', ')}`);
    process.exit(1);
  }
  
  const comp = COMPETITIONS[targetCompKey];
  const yearArgs = args.slice(1);
  
  let yearsToRun = Object.keys(YEARS_MAP).sort((a, b) => b - a); // 2026 down to 2016
  
  if (yearArgs.length > 0) {
    yearsToRun = yearArgs; // run specific year if provided
  }

  let totalBatchAwards = 0;

  for (const year of yearsToRun) {
    if (!YEARS_MAP[year]) {
      console.warn(`Year ${year} not supported.`);
      continue;
    }
    
    console.log(`\n========================================`);
    console.log(`🚀 Starting batch import for ${comp.name} ${year} (Value: ${YEARS_MAP[year]})`);
    console.log(`========================================\n`);
    
    const links = await fetchLinksForYear(YEARS_MAP[year], comp.ifid);
    console.log(`Found ${links.length} result URLs for ${year}.\n`);
    
    for (let i = 0; i < links.length; i++) {
      const { url, locationDateStr } = links[i];
      console.log(`[${i + 1}/${links.length}] Processing URL: ${url}`);
      
      try {
        // Capture stdout to parse the total new awards added
        const result = spawnSync('node', ['import_dancebug_awards.js', url, locationDateStr, comp.name, year], { encoding: 'utf8' });
        
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
