const sqlite3 = require('sqlite3').verbose();
const db = new sqlite3.Database('./database.sqlite');

const studioId = 842;
const orgId = 5;

db.all(`SELECT name FROM organizations WHERE id = ?`, [orgId], (err, orgs) => {
  if (err || orgs.length === 0) return console.log("No org");
  const orgName = orgs[0].name;

  db.all(`
    SELECT a.*, e.name as event_name, e.year as event_year
    FROM awards a
    JOIN events e ON a.event_id = e.id
    WHERE a.studio_id = ? AND e.org_id = ?
    ORDER BY e.year ASC, a.age_division ASC, a.place ASC
  `, [studioId, orgId], (err, awards) => {
    if (err) return console.log(err);
    
    const groups = {};
    const isYagp = true;

    for (const award of awards) {
      let groupKey = String(award.event_year);
      if (award.event_name.toLowerCase().includes('final')) {
        groupKey = `${award.event_year} Final`;
      }
      if (!groups[groupKey]) groups[groupKey] = {};
      let ageDiv = award.age_division || 'Others';
      ageDiv = ageDiv.replace(/ AGE DIVISION/i, '').trim();
      ageDiv = ageDiv.toLowerCase().replace(/\b\w/g, c => c.toUpperCase());
      if (ageDiv === 'Others' && isYagp && (award.category || '').toLowerCase().includes('ensemble')) {
         ageDiv = 'Ensembles';
      }
      if (!groups[groupKey][ageDiv]) groups[groupKey][ageDiv] = [];
      const placeLower = String(award.place || '').toLowerCase();
      let emoji = '';
      if (placeLower.includes('hope') || placeLower.includes('youth grand prix') || placeLower.includes('grand prix')) emoji = '👑 ';
      else if (placeLower.includes('1st')) emoji = '🥇';
      else if (placeLower.includes('2nd')) emoji = '🥈';
      else if (placeLower.includes('3rd')) emoji = '🥉';
      else if (placeLower.includes('top')) emoji = '🎖';
      let cleanedCategory = award.category || award.award_type || '';
      cleanedCategory = cleanedCategory.replace(/DANCE CATEGORY - /i, '').trim();
      cleanedCategory = cleanedCategory.toLowerCase().replace(/\b\w/g, c => c.toUpperCase());
      let suffix = award.event_name.toLowerCase().includes('final') ? '' : ', Regional';
      let formattedPlace = award.place ? award.place : 'Award';
      let agePrefix = (ageDiv !== 'Others' && ageDiv !== 'Ensembles') ? `${ageDiv} ` : '';
      let lineStr = `${emoji}${formattedPlace}, ${agePrefix}${cleanedCategory}`;
      if (award.performance_name) lineStr += ` [${award.performance_name}]`;
      if (suffix) lineStr += suffix;
      groups[groupKey][ageDiv].push(lineStr);
    }

    let summaryText = orgName + " awards history\n\n";
    const sortedYears = Object.keys(groups).sort();
    for (const year of sortedYears) {
      summaryText += `${year}\n\n`;
      const divKeys = Object.keys(groups[year]).sort();
      for (const div of divKeys) {
        if (div !== 'Others' && div !== 'Ensembles') summaryText += `${div}\n`;
        groups[year][div].forEach(line => {
          summaryText += `${line}\n`;
        });
        summaryText += `\n`;
      }
    }
    console.log(summaryText.trim());
  });
});
