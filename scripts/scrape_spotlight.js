const axios = require('axios');
const cheerio = require('cheerio');
const fs = require('fs');
const path = require('path');

const TARGET_URLS = [
  'https://www.spotlightevents.com/results',
  'https://www.spotlightevents.com/results/archive'
];

const OUTPUT_DIR = path.join(__dirname, 'tobeprocessed', 'pdf', 'spotlight');

if (!fs.existsSync(OUTPUT_DIR)) {
  fs.mkdirSync(OUTPUT_DIR, { recursive: true });
}

async function downloadFile(url, filepath) {
  try {
    const response = await axios({
      method: 'GET',
      url: url,
      responseType: 'stream',
      timeout: 30000 // 30 seconds timeout
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
  } catch (error) {
    console.error(`Error downloading ${url}:`, error.message);
    return false;
  }
}

async function run() {
  let pdfLinks = new Set();

  for (const url of TARGET_URLS) {
    console.log(`Fetching ${url}...`);
    try {
      const { data } = await axios.get(url);
      const $ = cheerio.load(data);
      $('a').each((i, el) => {
        let href = $(el).attr('href');
        if (href && href.toLowerCase().endsWith('.pdf')) {
          if (href.startsWith('/s/')) {
            href = `https://www.spotlightevents.com${href}`;
          } else if (href.startsWith('/')) {
            href = `https://www.spotlightevents.com${href}`;
          }
          pdfLinks.add(href);
        }
      });
    } catch (error) {
      console.error(`Error fetching ${url}:`, error.message);
    }
  }

  console.log(`Found ${pdfLinks.size} unique PDF links.`);
  let newDownloads = 0;
  let skipped = 0;

  for (const link of pdfLinks) {
    let urlObj;
    try {
      urlObj = new URL(link);
    } catch(e) {
      console.error("Invalid URL:", link);
      continue;
    }
    
    let originalFilename = urlObj.pathname.split('/').pop();
    if (!originalFilename) continue;

    // Standardize filename
    originalFilename = decodeURIComponent(originalFilename);
    const filename = `spotlightevents_${originalFilename}`;
    const filepath = path.join(OUTPUT_DIR, filename);

    if (fs.existsSync(filepath)) {
      skipped++;
      process.stdout.write(`Skipping (already exists): ${filename}\r`);
      continue;
    }

    console.log(`Downloading: ${filename} ...`);
    const success = await downloadFile(link, filepath);
    if (success) {
      newDownloads++;
    } else {
      // Clean up incomplete file if exists
      if (fs.existsSync(filepath)) {
         fs.unlinkSync(filepath);
      }
    }
  }

  console.log(`\n\nFinished! Downloaded: ${newDownloads}, Skipped: ${skipped}`);
}

run();
