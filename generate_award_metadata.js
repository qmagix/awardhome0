const sqlite3 = require('sqlite3').verbose();
const path = require('path');

const dbPath = path.join(__dirname, 'database.sqlite');
const db = new sqlite3.Database(dbPath);

const defaultMetadata = {
  classes: {
    adjudication: [],
    overall: [],
    title: [],
    special: [],
    scholarship: [],
    studio: []
  }
};

db.serialize(() => {
  db.all(`
    SELECT o.id as org_id, o.name as org_name, a.award_type, a.category, COUNT(*) as count 
    FROM awards a 
    JOIN events e ON a.event_id = e.id 
    JOIN organizations o ON e.org_id = o.id 
    GROUP BY o.id, a.award_type, a.category
  `, (err, rows) => {
    if (err) throw err;

    const orgs = {};
    rows.forEach(row => {
      if (!orgs[row.org_id]) {
        orgs[row.org_id] = { name: row.org_name, types: new Set() };
      }
      if (row.award_type) orgs[row.org_id].types.add(row.award_type);
    });

    // Populate initial JSON metadata
    Object.keys(orgs).forEach(orgId => {
      const metadata = JSON.parse(JSON.stringify(defaultMetadata));
      const types = Array.from(orgs[orgId].types);
      
      types.forEach(t => {
        const tLower = t.toLowerCase();
        if (tLower.includes('high score') || tLower.includes('overall') || tLower.includes('champion') || tLower.includes('place')) {
          metadata.classes.overall.push(t);
        } else if (tLower.includes('outstanding dancer') || tLower.includes('scholarship') || tLower.includes('runner-up')) {
          metadata.classes.scholarship.push(t);
        } else if (tLower.includes('title') || tLower.includes('miss') || tLower.includes('mr.')) {
          metadata.classes.title.push(t);
        } else if (tLower.includes('class act') || tLower.includes('sportsmanship') || tLower.includes('versatility')) {
          metadata.classes.studio.push(t);
        } else if (tLower.includes('judges') || tLower.includes('critics') || tLower.includes('entertaining') || tLower.includes('costume')) {
          metadata.classes.special.push(t);
        } else {
          // Default to adjudication or special
          metadata.classes.adjudication.push(t);
        }
      });

      // Special handling for NYCDA explicit awards
      if (orgs[orgId].name === 'NYCDA') {
         metadata.classes.studio.push("Class Act Award", "Backstage Good Sport Award", "Versatility Award");
         metadata.classes.special.push("Critics' Choice Winner", "Judges' Pick");
      }

      db.run('UPDATE organizations SET award_metadata = ? WHERE id = ?', [JSON.stringify(metadata), orgId], (updateErr) => {
        if (updateErr) console.error(updateErr);
        else console.log(`Updated metadata for ${orgs[orgId].name}`);
      });
    });
  });
});
