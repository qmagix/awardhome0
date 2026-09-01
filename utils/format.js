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


// Placement as a reader should see it. Extracted from server.js app.locals so
// the web pages and the mobile API cannot drift — the app was rendering raw
// values ("1" instead of "1st") and, worse, a literal placeholder word where
// there was no data.
//
// The empty-place case is the interesting one: 240,833 of 1.5M awards carry no
// placement, because a scholarship, a title or a special award has no rank. For
// those the honest word is "Winner"; for everything else it is "N/A".
function formatPlacement(award) {
  let place = award;
  let awardClass = null;
  if (award && typeof award === 'object') {
    place = award.place;
    awardClass = award.award_class;
  }

  if (!place || place === 'N/A' || place === 'null') {
    if (awardClass === 'scholarship' || awardClass === 'title' || awardClass === 'special' || awardClass === 'studio') {
      return 'Winner';
    }
    return 'N/A';
  }
  const strPlace = String(place).trim();
  const num = parseInt(strPlace, 10);
  if (!isNaN(num) && num.toString() === strPlace) {
    const j = num % 10, k = num % 100;
    if (j === 1 && k !== 11) return num + 'st';
    if (j === 2 && k !== 12) return num + 'nd';
    if (j === 3 && k !== 13) return num + 'rd';
    return num + 'th';
  }
  return String(place);
}

module.exports = { formatEventTitle, formatPlacement };
