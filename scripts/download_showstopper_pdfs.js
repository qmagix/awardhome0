const axios = require('axios');
const cheerio = require('cheerio');
const fs = require('fs');
const path = require('path');

const TARGET_DIR = path.join(__dirname, '..', 'tobeprocessed', 'pdf', 'showstopper');
const SOURCE_URL = 'https://www.goshowstopper.com/competitions/results/';

// Ensure base directory exists
if (!fs.existsSync(TARGET_DIR)) {
  fs.mkdirSync(TARGET_DIR, { recursive: true });
}

// Skip PDFs fetched in past runs (otherwise the filename-collision loop
// below re-downloads everything under "-1.pdf" suffixed names every run).
const { loadManifest } = require('../utils/pdf_manifest');
const manifest = loadManifest(TARGET_DIR);

function sanitizeFilename(str) {
  return str.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
}

async function downloadFile(url, filepath) {
  try {
    const response = await axios({
      method: 'GET',
      url: url,
      responseType: 'stream',
      // Some servers might block requests without a User-Agent
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
      }
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

async function run() {
  console.log('Starting Showstopper PDF Results Downloader...');
  console.log(`Fetching links from ${SOURCE_URL}...`);
  
  try {
    const response = await axios.get(SOURCE_URL);
    const $ = cheerio.load(response.data);
    
    const validYears = [2022, 2023, 2024, 2025, 2026];
    const pdfLinks = [];

    // Find all links
    $('a').each((i, el) => {
      const href = $(el).attr('href');
      if (href && href.toLowerCase().endsWith('.pdf')) {
        // Extract year from URL, e.g., /results_2025/
        const yearMatch = href.match(/results_(\d{4})/i);
        if (yearMatch) {
          const year = parseInt(yearMatch[1], 10);
          if (validYears.includes(year)) {
            // Extract location from the filename
            const filename = href.substring(href.lastIndexOf('/') + 1);
            const rawLocation = filename.replace('.pdf', '').replace(/-/g, ' ');
            
            // Clean up Location string (e.g. "anaheimIII" -> "Anaheim III")
            const location = rawLocation.replace(/([a-z])([A-Z])/g, '$1 $2').trim();

            pdfLinks.push({
              year: year,
              location: location,
              url: href
            });
          }
        }
      }
    });

    console.log(`Found ${pdfLinks.length} total PDF results for years 2022-2026.\n`);

    // Group by year to process cleanly
    for (const year of validYears) {
      const linksForYear = pdfLinks.filter(l => l.year === year);
      if (linksForYear.length === 0) continue;

      console.log(`=========================================`);
      console.log(`Processing Showstopper ${year} (${linksForYear.length} files)`);
      console.log(`=========================================`);

      const yearDir = path.join(TARGET_DIR, year.toString());
      if (!fs.existsSync(yearDir)) {
        fs.mkdirSync(yearDir, { recursive: true });
      }

      for (const item of linksForYear) {
        if (manifest.has(item.url)) continue;
        const baseFilename = sanitizeFilename(item.location);
        let pdfPath = path.join(yearDir, `${baseFilename}.pdf`);
        let jsonPath = path.join(yearDir, `${baseFilename}.json`);

        // Handle duplicates
        let counter = 1;
        while (fs.existsSync(pdfPath)) {
          pdfPath = path.join(yearDir, `${baseFilename}-${counter}.pdf`);
          jsonPath = path.join(yearDir, `${baseFilename}-${counter}.json`);
          counter++;
        }

        console.log(`  Downloading: ${baseFilename}.pdf`);
        const success = await downloadFile(item.url, pdfPath);

        if (success) {
          const metadata = {
            organization: 'Showstopper',
            organization_slug: 'showstopper',
            year: item.year,
            location: item.location,
            event_name: `Showstopper - ${item.location} ${item.year}`,
            source_url: item.url,
            downloaded_at: new Date().toISOString()
          };
          fs.writeFileSync(jsonPath, JSON.stringify(metadata, null, 2));
          manifest.add(item.url);
        }
      }
    }

    console.log(`\nFinished all downloads. Files saved to ${TARGET_DIR}`);

  } catch (error) {
    console.error(`Error processing Showstopper:`, error.message);
  }
}

run();
