const fs = require('fs');
const path = require('path');
const axios = require('axios');
const cheerio = require('cheerio');

const BASE_URL = 'https://www.nycdance.com';
const OUTPUT_DIR = path.join(__dirname, 'tobeprocessed', 'pdf', 'nycda');

// Ensure output directory exists
if (!fs.existsSync(OUTPUT_DIR)) {
  fs.mkdirSync(OUTPUT_DIR, { recursive: true });
}

async function fetchHtml(url) {
  try {
    const response = await axios.get(url);
    return response.data;
  } catch (error) {
    console.error(`Error fetching ${url}:`, error.message);
    return null;
  }
}

async function downloadPdf(url, filename) {
  const filePath = path.join(OUTPUT_DIR, filename);
  if (fs.existsSync(filePath)) {
    console.log(`Skipping (already exists): ${filename}`);
    return;
  }

  try {
    console.log(`Downloading: ${filename}...`);
    const response = await axios({
      url,
      method: 'GET',
      responseType: 'stream'
    });

    const writer = fs.createWriteStream(filePath);
    response.data.pipe(writer);

    return new Promise((resolve, reject) => {
      writer.on('finish', resolve);
      writer.on('error', reject);
    });
  } catch (error) {
    console.error(`Failed to download ${url}:`, error.message);
  }
}

async function scrapePdfsFromPage(url, pageContext) {
  const html = await fetchHtml(url);
  if (!html) return;

  const $ = cheerio.load(html);
  const pdfLinks = [];

  $('a').each((_, el) => {
    let href = $(el).attr('href');
    if (href && href.toLowerCase().includes('.pdf')) {
      if (!href.startsWith('http')) {
        href = href.startsWith('/') ? BASE_URL + href : `${BASE_URL}/${href}`;
      }
      
      // Clean up the filename
      const urlObj = new URL(href);
      let filename = path.basename(urlObj.pathname);
      
      // Sometimes the PDF name alone is generic, let's prefix with context
      filename = `${pageContext}_${filename}`.replace(/[^a-zA-Z0-9.-]/g, '_');
      
      pdfLinks.push({ url: href, filename });
    }
  });

  // Remove duplicates
  const uniqueLinks = Array.from(new Set(pdfLinks.map(l => l.url)))
    .map(url => pdfLinks.find(l => l.url === url));

  for (const pdf of uniqueLinks) {
    // Download all PDFs from results pages
    await downloadPdf(pdf.url, pdf.filename);
  }
}

async function run() {
  console.log('Starting NYCDA PDF Scraper...');

  // 1. Scrape Nationals Winners
  console.log('Scraping Nationals...');
  await scrapePdfsFromPage(`${BASE_URL}/nationals/winners`, 'Nationals');

  // 2. Find all Regional Cities
  console.log('Fetching Regional Cities index...');
  const citiesHtml = await fetchHtml(`${BASE_URL}/regionals/cities`);
  if (citiesHtml) {
    const $ = cheerio.load(citiesHtml);
    const cityUrls = new Set();
    
    $('a').each((_, el) => {
      const href = $(el).attr('href');
      if (href && href.includes('/cities/')) {
        const fullUrl = href.startsWith('http') ? href : `${BASE_URL}${href}`;
        cityUrls.add(fullUrl);
      }
    });

    console.log(`Found ${cityUrls.size} city pages.`);

    // 3. Scrape PDFs from each city
    for (const url of cityUrls) {
      const citySlug = url.split('/cities/')[1];
      console.log(`\nScraping City: ${citySlug}`);
      await scrapePdfsFromPage(url, citySlug);
    }
  }

  console.log('\nAll downloads completed!');
}

run();
