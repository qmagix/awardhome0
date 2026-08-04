const axios = require('axios');
const cheerio = require('cheerio');
const fs = require('fs');
const path = require('path');

const TARGET_DIR = path.join(__dirname, 'tobeprocessed', 'pdf', 'starquest');

// Ensure base directory exists
if (!fs.existsSync(TARGET_DIR)) {
  fs.mkdirSync(TARGET_DIR, { recursive: true });
}

function sanitizeFilename(str) {
  return str.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
}

async function downloadFile(url, filepath) {
  try {
    const response = await axios({
      method: 'GET',
      url: url,
      responseType: 'stream'
    });

    return new Promise((resolve, reject) => {
      const writer = fs.createWriteStream(filepath);
      response.data.pipe(writer);
      let error = null;
      writer.on('error', err => {
        error = err;
        writer.close();
        reject(err);
      });
      writer.on('close', () => {
        if (!error) resolve(true);
      });
    });
  } catch (err) {
    console.error(`Failed to download ${url}: ${err.message}`);
    return false;
  }
}

async function scrapeStarquestYear(url, year) {
  console.log(`Fetching ${url} ...`);
  try {
    const res = await axios.get(url);
    const $ = cheerio.load(res.data);
    
    const linksFound = [];

    $('a').each((i, el) => {
      const href = $(el).attr('href');
      const linkText = $(el).text().trim();
      
      if (href && href.toLowerCase().endsWith('.pdf') && href.toLowerCase().includes('results')) {
        const isDuplicate = linksFound.some(l => l.url === href);
        if (!isDuplicate) {
          linksFound.push({
            url: href,
            location: linkText || 'Unknown Location'
          });
        }
      }
    });

    if (linksFound.length > 0) {
      console.log(`Found ${linksFound.length} PDF results for Starquest ${year}. Downloading...`);
      
      for (const item of linksFound) {
        const baseFilename = `${sanitizeFilename(item.location)}-${year}`;
        let pdfPath = path.join(TARGET_DIR, `${baseFilename}.pdf`);
        let jsonPath = path.join(TARGET_DIR, `${baseFilename}.json`);
        
        // Handle duplicate filenames
        let counter = 1;
        while (fs.existsSync(pdfPath)) {
          pdfPath = path.join(TARGET_DIR, `${baseFilename}-${counter}.pdf`);
          jsonPath = path.join(TARGET_DIR, `${baseFilename}-${counter}.json`);
          counter++;
        }

        console.log(`  Downloading: ${baseFilename}.pdf`);
        const success = await downloadFile(item.url, pdfPath);
        
        if (success) {
          const metadata = {
            organization: 'Starquest',
            organization_slug: 'starquest',
            year: parseInt(year),
            location: item.location,
            event_name: `Starquest - ${item.location} ${year}`,
            source_url: item.url,
            downloaded_at: new Date().toISOString()
          };
          fs.writeFileSync(jsonPath, JSON.stringify(metadata, null, 2));
        }
      }
    } else {
      console.log(`No PDF results found for Starquest ${year}.`);
    }
  } catch (err) {
    console.error(`Error scraping Starquest ${year}: ${err.message}`);
  }
}

async function run() {
  console.log('Starting Starquest PDF Results Downloader...');
  console.log(`Output Directory: ${TARGET_DIR}\n`);

  const urls = [
    { url: 'https://www.starquestdance.com/2026results/', year: 2026 },
    { url: 'https://www.starquestdance.com/2025results/', year: 2025 }
  ];

  for (const item of urls) {
    await scrapeStarquestYear(item.url, item.year);
  }

  console.log(`\nFinished downloading Starquest results.`);
}

run();
