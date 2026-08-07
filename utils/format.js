// Display formatting for scraped competition data.
//
// Event names arrive from scrapers with embedded org names, locations,
// dates, and artifacts ("Believe Talent Competition - Pittsburgh,, PA - May
// 01 - 03,"). Templates were prepending the org and appending dates again.
// This normalizes at display time — stored data is never modified.
function formatEventTitle(eventName, orgName, extra) {
  let name = (eventName || '').trim();
  const org = (orgName || '').trim();

  // Drop the org prefix if the scraped name already starts with it
  if (org && name.toLowerCase().startsWith(org.toLowerCase())) {
    name = name.slice(org.length).replace(/^[\s\-–—:,]+/, '');
  }

  // Scraping artifacts: duplicated commas, double spaces, dangling separators
  name = name
    .replace(/,\s*,+/g, ',')
    .replace(/\s{2,}/g, ' ')
    .replace(/[\s,\-–—]+$/g, '')
    .trim();

  let title = [org, name].filter(Boolean).join(' — ');
  if (extra !== undefined && extra !== null && String(extra).trim() !== '') {
    title += ` (${String(extra).trim()})`;
  }
  return title;
}

module.exports = { formatEventTitle };
