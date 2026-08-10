// Tracks which source URLs a PDF downloader already fetched, so re-runs skip
// known results. Without this, the "-1.pdf" collision loop in the downloaders
// re-downloads every PDF under a new suffixed name on every run. Seeds itself
// from the metadata JSONs of past downloads (their source_url field).
const fs = require('fs');
const path = require('path');

function loadManifest(dir) {
  const file = path.join(dir, 'downloaded_urls.json');
  let urls = [];
  if (fs.existsSync(file)) {
    urls = JSON.parse(fs.readFileSync(file, 'utf8'));
  } else if (fs.existsSync(dir)) {
    const walk = (d) => fs.readdirSync(d, { withFileTypes: true }).flatMap((ent) => {
      const p = path.join(d, ent.name);
      if (ent.isDirectory()) return walk(p);
      if (ent.name.endsWith('.json') && ent.name !== 'downloaded_urls.json') {
        try {
          const m = JSON.parse(fs.readFileSync(p, 'utf8'));
          return m.source_url ? [m.source_url] : [];
        } catch (e) { return []; }
      }
      return [];
    });
    urls = walk(dir);
  }
  const set = new Set(urls);
  const save = () => fs.writeFileSync(file, JSON.stringify([...set], null, 1));
  if (!fs.existsSync(file)) save();
  return {
    has: (u) => set.has(u),
    add: (u) => { set.add(u); save(); },
    size: () => set.size
  };
}

module.exports = { loadManifest };
