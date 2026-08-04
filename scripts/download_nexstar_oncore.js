const axios = require('axios');
const cheerio = require('cheerio');
const fs = require('fs');
const path = require('path');

const COMPETITIONS = [
  { name: 'Nexstar', slug: 'nexstar', ifid: 148 },
  { name: 'Oncore', slug: 'oncore', ifid: 289 }
];

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

const BASE_URL = 'https://www.dancebug.com/rf/events_list.php';
const TARGET_DIR = path.join(__dirname, 'tobeprocessed', 'pdf');

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

async function processCompetitionYear(comp, year, yearId) {
  const compDir = path.join(TARGET_DIR, comp.slug);
  if (!fs.existsSync(compDir)) {
    fs.mkdirSync(compDir, { recursive: true });
  }

  const listUrl = `${BASE_URL}?ifid=${comp.ifid}&d_year=${yearId}`;
  try {
    const res = await axios.get(listUrl);
    const $ = cheerio.load(res.data);
    
    // We parse all rows because some rows contain links and some are mobile titles
    const linksFound = [];

    $('a').each((i, el) => {
      const href = $(el).attr('href');
      const linkText = $(el).text().trim().toLowerCase();
      
      // Look for PDF links that contain 'results' either in URL or text
      if (href && href.toLowerCase().endsWith('.pdf') && (href.toLowerCase().includes('results') || linkText.includes('results'))) {
        
        const tr = $(el).closest('tr');
        let dateStr = tr.find('td').eq(0).text().trim();
        let locStr = tr.find('td').eq(1).text().trim();
        
        // Handle mobile layout fallback
        if (!locStr) {
          const divLoc = $(el).closest('.row').find('.col-md-12').eq(1).text().trim();
          if (divLoc) locStr = divLoc;
        }
        
        if (!dateStr) {
           const divDate = $(el).closest('.row').find('.col-md-12').eq(0).text().trim();
           if (divDate) dateStr = divDate;
        }

        const locationDateStr = (locStr ? `${year} - ${locStr} - ${dateStr}` : `Unknown Location - ${year}`).trim();
        
        // Ensure uniqueness for the download queue
        const isDuplicate = linksFound.some(l => l.url === href);
        if (!isDuplicate) {
          linksFound.push({
            url: href,
            location: locStr || 'Unknown Location',
            date: dateStr || `Unknown Date ${year}`,
            locationDateStr: locationDateStr
          });
        }
      }
    });

    if (linksFound.length > 0) {
      console.log(`Found ${linksFound.length} PDF results for ${comp.name} in ${year}. Downloading...`);
      
      for (const item of linksFound) {
        const baseFilename = `${sanitizeFilename(item.locationDateStr)}`;
        let pdfPath = path.join(compDir, `${baseFilename}.pdf`);
        let jsonPath = path.join(compDir, `${baseFilename}.json`);
        
        // Handle duplicate filenames in the same folder by appending a counter
        let counter = 1;
        while (fs.existsSync(pdfPath)) {
          pdfPath = path.join(compDir, `${baseFilename}-${counter}.pdf`);
          jsonPath = path.join(compDir, `${baseFilename}-${counter}.json`);
          counter++;
        }

        console.log(`  Downloading: ${path.basename(pdfPath)}`);
        const success = await downloadFile(item.url, pdfPath);
        
        if (success) {
          const metadata = {
            organization: comp.name,
            organization_slug: comp.slug,
            year: parseInt(year),
            location: item.location,
            date: item.date,
            event_name: `${comp.name} - ${item.locationDateStr}`,
            source_url: item.url,
            downloaded_at: new Date().toISOString()
          };
          fs.writeFileSync(jsonPath, JSON.stringify(metadata, null, 2));
        }
      }
    } else {
      console.log(`No PDF results found for ${comp.name} in ${year}.`);
    }

  } catch (error) {
    console.error(`Error processing ${comp.name} for year ${year}:`, error.message);
  }
}

async function run() {
  console.log('Starting Nexstar/Oncore PDF Results Downloader...');
  console.log(`Output Directory: ${TARGET_DIR}\n`);

  for (const comp of COMPETITIONS) {
    console.log(`=========================================`);
    console.log(`Processing ${comp.name}`);
    console.log(`=========================================`);
    
    // Sort years descending
    const years = Object.keys(YEARS_MAP).sort((a, b) => b - a);
    
    for (const year of years) {
      await processCompetitionYear(comp, year, YEARS_MAP[year]);
    }
  }
  
  console.log(`\nFinished all downloads. Files saved to /tobeprocessed/pdf/nexstar and /tobeprocessed/pdf/oncore`);
}

run();
