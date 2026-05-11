const axios = require('axios');
const fs = require('fs');
const path = require('path');

const TARGET_APIS = [
  'https://www.starbound.net/wp-json/acf/v3/posts/113/?per_page=1000', // Regionals
  'https://www.starbound.net/wp-json/acf/v3/posts/79/?per_page=1000'    // Nationals
];

const OUTPUT_DIR = path.join(__dirname, 'tobeprocessed', 'pdf', 'starbound');

if (!fs.existsSync(OUTPUT_DIR)) {
  fs.mkdirSync(OUTPUT_DIR, { recursive: true });
}

// Helper to sanitize the location title for a filename
function sanitizeTitle(title) {
  if (!title) return 'unknown_location';
  // Replace anything that is not alphanumeric with an underscore, collapse multiple underscores, and trim
  return title.replace(/[^a-zA-Z0-9]+/g, '_').replace(/^_+|_+$/g, '');
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
  let allTiles = [];

  for (const url of TARGET_APIS) {
    console.log(`Fetching API: ${url}...`);
    try {
      const { data } = await axios.get(url);
      if (data && data.acf && data.acf.winner_tile) {
        allTiles = allTiles.concat(data.acf.winner_tile);
      }
    } catch (error) {
      console.error(`Error fetching API ${url}:`, error.message);
    }
  }

  console.log(`Found ${allTiles.length} total result entries.`);
  let newDownloads = 0;
  let skipped = 0;
  let invalid = 0;

  for (const tile of allTiles) {
    const pdfUrl = tile.pdf;
    if (!pdfUrl || typeof pdfUrl !== 'string' || !pdfUrl.toLowerCase().endsWith('.pdf')) {
      invalid++;
      continue;
    }

    // Extract Year (e.g. "01/02/2018" -> "2018")
    let year = "UnknownYear";
    if (tile.winning_year && typeof tile.winning_year === 'string') {
      const parts = tile.winning_year.split('/');
      if (parts.length === 3) {
        year = parts[2].trim();
      } else {
        year = tile.winning_year.slice(-4);
      }
    }

    // Extract Title for Location
    const sanitizedTitle = sanitizeTitle(tile.card_title);

    // Format: starbound_2024_Anaheim_CA_Winners.pdf
    const filename = `starbound_${year}_${sanitizedTitle}.pdf`;
    const filepath = path.join(OUTPUT_DIR, filename);

    if (fs.existsSync(filepath)) {
      skipped++;
      process.stdout.write(`Skipping (already exists): ${filename}\r`);
      continue;
    }

    console.log(`Downloading: ${filename} ...`);
    // Ensure the URL is fully qualified
    let downloadUrl = pdfUrl;
    if (downloadUrl.startsWith('/')) {
        downloadUrl = `https://www.starbound.net${downloadUrl}`;
    }

    const success = await downloadFile(downloadUrl, filepath);
    if (success) {
      newDownloads++;
    } else {
      if (fs.existsSync(filepath)) {
         fs.unlinkSync(filepath);
      }
    }
  }

  console.log(`\n\nFinished! Downloaded: ${newDownloads}, Skipped: ${skipped}, Invalid/No-PDF: ${invalid}`);
}

run();
