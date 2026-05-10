const axios = require('axios');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

/**
 * Fetches a URL and caches the raw HTML to ./raw/<orgSlug>/<year>/
 * @param {string} url - The URL to fetch.
 * @param {string} orgSlug - The organization slug (e.g., 'kar', 'yagp').
 * @param {string|number} year - The event year.
 * @param {string} extraFilename - Optional manual filename override.
 * @returns {Promise<{data: string}>} - An object matching the axios response signature.
 */
async function fetchWithCache(url, orgSlug, year, extraFilename = null) {
  const rawDir = path.join(__dirname, 'raw', orgSlug, String(year));
  
  if (!fs.existsSync(rawDir)) {
    fs.mkdirSync(rawDir, { recursive: true });
  }

  let filename;
  if (extraFilename) {
    filename = extraFilename.replace(/[^a-z0-9]/gi, '_').toLowerCase() + '.html';
  } else {
    try {
      const parsedUrl = new URL(url);
      let base = path.basename(parsedUrl.pathname);
      if (!base || base === '/' || base === '') {
        base = crypto.createHash('md5').update(url).digest('hex');
      }
      filename = base.endsWith('.html') ? base : `${base}.html`;
    } catch(e) {
      filename = crypto.createHash('md5').update(url).digest('hex') + '.html';
    }
  }

  const filepath = path.join(rawDir, filename);

  const forceRefetch = process.env.REFETCH === 'true';

  if (!forceRefetch && fs.existsSync(filepath)) {
    console.log(`[Cache Hit] Loading from ${filepath}`);
    const data = fs.readFileSync(filepath, 'utf8');
    return { data };
  } else {
    if (forceRefetch) {
      console.log(`[Force Refetch] Fetching ${url}`);
    } else {
      console.log(`[Cache Miss] Fetching ${url}`);
    }
    const res = await axios.get(url, { timeout: 15000 });
    fs.writeFileSync(filepath, res.data, 'utf8');
    return { data: res.data };
  }
}

module.exports = { fetchWithCache };
